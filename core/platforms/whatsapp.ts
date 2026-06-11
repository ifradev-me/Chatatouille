import { Boom } from "@hapi/boom";
import NodeCache from "@cacheable/node-cache";
import qrcode from "qrcode-terminal";
import path from "path";
import fs from "fs/promises";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  downloadMediaMessage,
  type WAMessage,
  type WASocket,
  type AnyMessageContent,
  type GroupMetadata,
  type GroupParticipant,
  type CacheStore,
} from "@whiskeysockets/baileys";

import type { Ctx, KeywordIndexEntry, LoadedPlugin, Msg, MsgEvent } from "../types.js";
import { config } from "../config.js";
import { logger, rawLogger } from "../logger.js";
import { db } from "../db/index.js";
import * as helpers from "../helpers/index.js";
import { route } from "../router.js";

// ─── LID utilities ───────────────────────────────────────────────────────────
// Baileys v7 mengenal dua format addressing:
//   - LID: "xxxxxxx@lid"           (anonim, dipakai default di grup besar)
//   - PN : "62812xxxx@s.whatsapp.net" (nomor HP / legacy)
// Plugin pakai `msg.from` (string opaque, prefer LID). Adapter yang
// menerjemahkan ke remoteJid asli saat balas.

function isLid(jid?: string | null): boolean {
  return !!jid && jid.endsWith("@lid");
}

function isPn(jid?: string | null): boolean {
  return !!jid && jid.endsWith("@s.whatsapp.net");
}

function isGroupJid(jid?: string | null): boolean {
  return !!jid && jid.endsWith("@g.us");
}

function stripDomain(jid: string): string {
  const at = jid.indexOf("@");
  return at === -1 ? jid : jid.slice(0, at);
}

// ─── socket lifecycle ────────────────────────────────────────────────────────

interface StartOpts {
  plugins: LoadedPlugin[];
  keywordIndex: KeywordIndexEntry[];
}

const msgRetryCounterCache = new NodeCache() as unknown as CacheStore;
const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });

export async function startWhatsApp({ plugins, keywordIndex }: StartOpts): Promise<void> {
  await fs.mkdir(config.WA_SESSION_PATH, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(config.WA_SESSION_PATH);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info({ version: version.join("."), isLatest }, "[wa] using WA version");

  const sock = makeWASocket({
    version,
    logger: rawLogger,
    auth: {
      creds: state.creds,
      // Caching key store — penting untuk performa enkripsi.
      keys: makeCacheableSignalKeyStore(state.keys, rawLogger),
    },
    msgRetryCounterCache,
    cachedGroupMetadata: async (jid) => groupCache.get(jid) as GroupMetadata | undefined,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    shouldSyncHistoryMessage: ({ syncType }) => {
    return syncType !== 2 // skip FULL only
  },
    // markOnlineOnConnect false agar mode "offline" — pesan keep delivered tanpa
    // tampak online; bikin lebih aman dari deteksi.
    markOnlineOnConnect: false,
  });

  // Pairing code (opsional). Lebih disukai daripada QR di sebagian device.
  if (config.WA_USE_PAIRING_CODE && !sock.authState.creds.registered) {
    if (!config.WA_PHONE_NUMBER) {
      logger.error("[wa] WA_USE_PAIRING_CODE=true tetapi WA_PHONE_NUMBER kosong");
    } else {
      // Beri Baileys waktu inisialisasi koneksi sebelum request pairing code.
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(config.WA_PHONE_NUMBER);
          logger.info({ code }, "[wa] PAIRING CODE — masukkan di WhatsApp → Linked Devices");
        } catch (err) {
          logger.error({ err: (err as Error).message }, "[wa] gagal request pairing code");
        }
      }, 3000);
    }
  }

  sock.ev.process(async (events) => {
    if (events["creds.update"]) {
      await saveCreds();
    }

    if (events["connection.update"]) {
      const u = events["connection.update"];
      const { connection, lastDisconnect, qr } = u;

      if (qr && !config.WA_USE_PAIRING_CODE) {
        logger.info("[wa] scan QR berikut dari aplikasi WhatsApp:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        logger.info(
          { id: sock.user?.id, lid: sock.user?.lid, name: sock.user?.name },
          "[wa] connected",
        );
      }

      if (connection === "close") {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        logger.warn({ code, loggedOut }, "[wa] disconnected");
        if (!loggedOut) {
          scheduleReconnect({ plugins, keywordIndex });
        }
      }
    }

    // Update mapping LID↔PN — auto-tersimpan di signal repository.
    if (events["lid-mapping.update"]) {
      logger.debug("[wa] lid mapping updated");
    }

    if (events["group-participants.update"]) {
      await handleGroupParticipants(sock, events["group-participants.update"], plugins, keywordIndex);
    }

    if (events["messages.upsert"]) {
      const upsert = events["messages.upsert"];
      // HANYA "notify" = pesan baru realtime. "append" termasuk replay history
      // saat sync (penyebab bot membalas pesan lama saat startup) DAN pesan bot
      // sendiri saat dia kirim — keduanya tidak boleh dibalas.
      if (upsert.type === "notify") {
        for (const raw of upsert.messages) {
          try {
            await handleMessage(sock, raw, plugins, keywordIndex);
          } catch (err) {
            logger.error({ err: (err as Error).message }, "[wa] handleMessage error");
          }
        }
      }
    }
  });
}

// Reconnect dengan backoff. startWhatsApp async — tanpa catch, error transient
// (network/fs) saat reconnect jadi unhandled rejection dan mematikan proses.
function scheduleReconnect(opts: StartOpts, delayMs = 2000): void {
  setTimeout(() => {
    startWhatsApp(opts).catch((err) => {
      const nextDelay = Math.min(delayMs * 2, 60_000);
      logger.error(
        { err: (err as Error).message, nextDelayMs: nextDelay },
        "[wa] reconnect gagal — coba lagi",
      );
      scheduleReconnect(opts, nextDelay);
    });
  }, delayMs);
}

// ─── group participants → join/leave events ──────────────────────────────────

async function handleGroupParticipants(
  sock: WASocket,
  ev: { id: string; participants: GroupParticipant[]; action: string },
  plugins: LoadedPlugin[],
  keywordIndex: KeywordIndexEntry[],
): Promise<void> {
  const event: MsgEvent | null =
    ev.action === "add"
      ? "join"
      : ev.action === "remove" || ev.action === "leave"
      ? "leave"
      : null;
  if (!event) return;

  for (const p of ev.participants) {
    const participantJid = p.id;
    const ids = await resolveIdentities(sock, participantJid);
    const msg: Msg = {
      id: `${ev.id}:${participantJid}:${Date.now()}`,
      platform: "whatsapp",
      from: ids.preferred,
      phoneNumber: ids.phoneNumber,
      lid: ids.lid,
      remoteJid: ev.id,
      groupId: ev.id,
      isGroup: true,
      fromMe: false,
      text: "",
      media: null,
      event,
      timestamp: Date.now(),
      raw: ev,
    };
    const ctx = makeCtx(sock, msg);
    await route(msg, ctx, plugins, keywordIndex);
  }
}

// ─── normalisasi pesan ──────────────────────────────────────────────────────

async function handleMessage(
  sock: WASocket,
  raw: WAMessage,
  plugins: LoadedPlugin[],
  keywordIndex: KeywordIndexEntry[],
): Promise<void> {
  if (!raw.message) return;
  // Hard guard: jangan pernah proses pesan dari bot sendiri (mencegah loop).
  if (raw.key.fromMe) return;

  const remoteJid = raw.key.remoteJid;
  if (!remoteJid) return;
  // Skip status broadcast & newsletter — bot tidak perlu balas.
  if (remoteJid === "status@broadcast") return;
  if (remoteJid.endsWith("@newsletter")) return;

  const isGroup = isGroupJid(remoteJid);
  const senderJid = isGroup ? raw.key.participant ?? raw.participant ?? remoteJid : remoteJid;

  // Resolve LID + PN untuk pengirim. v7: pakai signalRepository.lidMapping.
  const ids = await resolveIdentities(sock, senderJid ?? "");
  const from = ids.preferred;

  // Extract text
  const m = raw.message;
  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    "";

  // Detect media
  let media: Msg["media"] = null;
  if (m.imageMessage) {
    media = { type: "image", url: await saveMedia(sock, raw, "image"), mimeType: m.imageMessage.mimetype ?? undefined };
  } else if (m.videoMessage) {
    media = { type: "video", url: await saveMedia(sock, raw, "video"), mimeType: m.videoMessage.mimetype ?? undefined };
  } else if (m.audioMessage) {
    media = { type: "audio", url: await saveMedia(sock, raw, "audio"), mimeType: m.audioMessage.mimetype ?? undefined };
  } else if (m.documentMessage) {
    media = { type: "file", url: await saveMedia(sock, raw, "document"), mimeType: m.documentMessage.mimetype ?? undefined };
  }

  const event: MsgEvent = media ? "media" : "message";

  const msg: Msg = {
    id: raw.key.id ?? `${Date.now()}`,
    platform: "whatsapp",
    from,
    phoneNumber: ids.phoneNumber,
    lid: ids.lid,
    addressingMode: isLid(senderJid) ? "lid" : "pn",
    remoteJid,
    pushName: raw.pushName ?? undefined,
    groupId: isGroup ? remoteJid : null,
    isGroup,
    fromMe: !!raw.key.fromMe,
    text: text ?? "",
    media,
    event,
    timestamp: Number(raw.messageTimestamp) * 1000 || Date.now(),
    raw,
  };

  const ctx = makeCtx(sock, msg);
  await route(msg, ctx, plugins, keywordIndex);
}

// ─── identity resolution (LID ↔ PN) ──────────────────────────────────────────

interface ResolvedIdentities {
  /** Stable identifier untuk msg.from — prefer LID karena lebih konsisten. */
  preferred: string;
  /** Nomor HP (E.164 tanpa "+"), undefined kalau tidak diketahui. */
  phoneNumber?: string;
  /** LID full ("xxxxx@lid"), undefined kalau tidak diketahui. */
  lid?: string;
}

async function resolveIdentities(sock: WASocket, jid: string): Promise<ResolvedIdentities> {
  const out: ResolvedIdentities = { preferred: stripDomain(jid) || jid };

  if (!jid) return out;

  if (isLid(jid)) {
    out.lid = jid;
    out.preferred = stripDomain(jid);
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid);
      if (pn) out.phoneNumber = stripDomain(pn);
    } catch {
      /* ignore */
    }
  } else if (isPn(jid)) {
    out.phoneNumber = stripDomain(jid);
    try {
      const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(jid);
      if (lid) {
        out.lid = lid;
        out.preferred = stripDomain(lid);
      }
    } catch {
      /* ignore */
    }
  }

  return out;
}

// ─── context (Ctx) per pesan ─────────────────────────────────────────────────

function makeCtx(sock: WASocket, msg: Msg): Ctx {
  let stopped = false;

  const replyTarget = msg.remoteJid ?? msg.from;

  // Quote hanya kalau msg.raw memang WAMessage (punya .key). Untuk join/leave,
  // msg.raw = event object (bukan message) — tidak boleh di-quote.
  const rawIsWaMessage =
    typeof msg.raw === "object" &&
    msg.raw !== null &&
    "key" in msg.raw &&
    "message" in msg.raw;

  const send = async (content: AnyMessageContent) => {
    if (!replyTarget) return;
    if (rawIsWaMessage) {
      await sock.sendMessage(replyTarget, content, { quoted: msg.raw as WAMessage });
    } else {
      await sock.sendMessage(replyTarget, content);
    }
  };

  const ctx: Ctx = {
    platform: "whatsapp",
    db,
    config,
    log: logger,
    helpers,
    async reply(text: string) {
      await send({ text });
    },
    async replyMedia(url: string, caption?: string) {
      // Best-effort: kalau path lokal yang ada → kirim file; selain itu treat sebagai URL.
      const isLocal = !/^https?:\/\//i.test(url);
      try {
        if (isLocal) {
          await send({ image: { url }, caption });
        } else {
          await send({ image: { url }, caption });
        }
      } catch (err) {
        logger.error({ err: (err as Error).message }, "[wa] replyMedia gagal");
      }
    },
    stop() {
      stopped = true;
    },
    get stopped() {
      return stopped;
    },
  };

  return ctx;
}

// ─── media downloader ────────────────────────────────────────────────────────

async function saveMedia(
  sock: WASocket,
  raw: WAMessage,
  kind: "image" | "video" | "audio" | "document",
): Promise<string> {
  try {
    const buffer = await downloadMediaMessage(raw, "buffer", {}, {
      logger: rawLogger,
      reuploadRequest: sock.updateMediaMessage,
    });
    const dir = path.resolve("tmp");
    await fs.mkdir(dir, { recursive: true });
    const ext = kind === "image" ? "jpg" : kind === "video" ? "mp4" : kind === "audio" ? "ogg" : "bin";
    const file = path.join(dir, `${raw.key.id ?? Date.now()}.${ext}`);
    await fs.writeFile(file, buffer);
    return file;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[wa] download media gagal");
    return "";
  }
}
