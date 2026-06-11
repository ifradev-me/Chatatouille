import path from "path";
import fs from "fs/promises";
import { Bot, InputFile, type Context as TgContext } from "grammy";

import type { Ctx, KeywordIndexEntry, LoadedPlugin, Msg, MsgEvent } from "../types.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { db } from "../db/index.js";
import * as helpers from "../helpers/index.js";
import { route } from "../router.js";

interface StartOpts {
  plugins: LoadedPlugin[];
  keywordIndex: KeywordIndexEntry[];
}

export async function startTelegram({ plugins, keywordIndex }: StartOpts): Promise<void> {
  if (!config.TELEGRAM_TOKEN) {
    logger.warn("[tg] TELEGRAM_TOKEN kosong di .env — adapter tidak start");
    return;
  }

  const bot = new Bot(config.TELEGRAM_TOKEN);
  await bot.init(); // populate bot.botInfo (untuk fromMe check)
  logger.info({ username: bot.botInfo.username }, "[tg] bot online");

  // ─── message (text + media) ────────────────────────────────────────────────
  bot.on("message", async (tgCtx) => {
    try {
      // Join/leave di-handle terpisah di bawah — skip di sini supaya tidak double.
      if (tgCtx.message.new_chat_members || tgCtx.message.left_chat_member) return;

      const msg = await normalizeMessage(tgCtx);
      if (!msg) return;
      const ctx = makeCtx(bot, tgCtx, msg);
      await route(msg, ctx, plugins, keywordIndex);
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[tg] handle error");
    }
  });

  // ─── join (new chat members) ───────────────────────────────────────────────
  bot.on("message:new_chat_members", async (tgCtx) => {
    try {
      const members = tgCtx.message.new_chat_members ?? [];
      for (const member of members) {
        if (member.is_bot && member.id === bot.botInfo.id) continue; // bot ditambahkan sendiri
        const msg = buildMemberMsg(tgCtx, member, "join");
        const ctx = makeCtx(bot, tgCtx, msg);
        await route(msg, ctx, plugins, keywordIndex);
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[tg] join error");
    }
  });

  // ─── leave (left chat member) ──────────────────────────────────────────────
  bot.on("message:left_chat_member", async (tgCtx) => {
    try {
      const member = tgCtx.message.left_chat_member;
      if (!member) return;
      const msg = buildMemberMsg(tgCtx, member, "leave");
      const ctx = makeCtx(bot, tgCtx, msg);
      await route(msg, ctx, plugins, keywordIndex);
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[tg] leave error");
    }
  });

  bot.catch((err) => {
    logger.error({ err: err.error }, "[tg] bot error");
  });

  // Long polling — non-blocking; bot.start() resolve hanya saat di-stop.
  void bot.start({
    onStart: () => logger.info("[tg] polling started"),
  });
}

// ─── normalize: text / media message ─────────────────────────────────────────

async function normalizeMessage(tgCtx: TgContext): Promise<Msg | null> {
  const m = tgCtx.message;
  if (!m || !tgCtx.from || !tgCtx.chat) return null;

  // Skip pesan bot sendiri.
  if (m.from?.is_bot && m.from.id === tgCtx.me.id) return null;

  const isGroup = tgCtx.chat.type === "group" || tgCtx.chat.type === "supergroup";

  // Detect media + download.
  let media: Msg["media"] = null;
  let event: MsgEvent = "message";

  if (m.photo && m.photo.length > 0) {
    // photos[] = beberapa size — ambil yang terbesar.
    const largest = m.photo[m.photo.length - 1];
    const file = await downloadTgFile(tgCtx, largest.file_id, "jpg");
    if (file) media = { type: "image", url: file };
  } else if (m.video) {
    const file = await downloadTgFile(tgCtx, m.video.file_id, "mp4");
    if (file) media = { type: "video", url: file, mimeType: m.video.mime_type };
  } else if (m.document) {
    const ext = (m.document.file_name?.split(".").pop() ?? "bin").toLowerCase();
    const file = await downloadTgFile(tgCtx, m.document.file_id, ext);
    if (file) media = { type: "file", url: file, mimeType: m.document.mime_type };
  } else if (m.voice) {
    const file = await downloadTgFile(tgCtx, m.voice.file_id, "ogg");
    if (file) media = { type: "audio", url: file, mimeType: m.voice.mime_type };
  } else if (m.audio) {
    const file = await downloadTgFile(tgCtx, m.audio.file_id, "mp3");
    if (file) media = { type: "audio", url: file, mimeType: m.audio.mime_type };
  }

  if (media) event = "media";

  const text = m.text ?? m.caption ?? "";

  return {
    id: `${tgCtx.chat.id}:${m.message_id}`,
    platform: "telegram",
    from: String(tgCtx.from.id),
    pushName: displayName(tgCtx.from),
    groupId: isGroup ? String(tgCtx.chat.id) : null,
    isGroup,
    fromMe: false,
    text,
    media,
    event,
    timestamp: m.date * 1000,
    raw: m,
  };
}

function buildMemberMsg(
  tgCtx: TgContext,
  member: { id: number; first_name?: string; last_name?: string; username?: string },
  event: "join" | "leave",
): Msg {
  const chatId = tgCtx.chat!.id;
  return {
    id: `${chatId}:${event}:${member.id}:${Date.now()}`,
    platform: "telegram",
    from: String(member.id),
    pushName: displayName(member),
    groupId: String(chatId),
    isGroup: true,
    fromMe: false,
    text: "",
    media: null,
    event,
    timestamp: Date.now(),
    raw: tgCtx.message ?? tgCtx.update,
  };
}

function displayName(u: { first_name?: string; last_name?: string; username?: string }): string | undefined {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || u.username || undefined;
}

// ─── ctx ─────────────────────────────────────────────────────────────────────

function makeCtx(bot: Bot, tgCtx: TgContext, msg: Msg): Ctx {
  let stopped = false;
  const chatId = tgCtx.chat!.id;
  // Hanya reply-quoted untuk event message/media (ada message_id yang valid).
  const replyToId =
    msg.event === "message" || msg.event === "media"
      ? (tgCtx.message?.message_id ?? undefined)
      : undefined;

  const ctx: Ctx = {
    platform: "telegram",
    db,
    config,
    log: logger,
    helpers,
    async reply(text: string) {
      await bot.api.sendMessage(chatId, text, replyToId ? { reply_parameters: { message_id: replyToId } } : {});
    },
    async replyMedia(url: string, caption?: string) {
      const isUrl = /^https?:\/\//i.test(url);
      const source = isUrl ? url : new InputFile(url);
      try {
        await bot.api.sendPhoto(chatId, source, {
          caption,
          ...(replyToId ? { reply_parameters: { message_id: replyToId } } : {}),
        });
      } catch (err) {
        logger.error({ err: (err as Error).message }, "[tg] replyMedia gagal");
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

// ─── media download ──────────────────────────────────────────────────────────

async function downloadTgFile(tgCtx: TgContext, fileId: string, ext: string): Promise<string | null> {
  try {
    const file = await tgCtx.api.getFile(fileId);
    if (!file.file_path) return null;
    const url = `https://api.telegram.org/file/bot${config.TELEGRAM_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    const dir = path.resolve("tmp");
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, `${fileId}.${ext}`);
    await fs.writeFile(out, buf);
    return out;
  } catch (err) {
    logger.error({ err: (err as Error).message, fileId }, "[tg] download failed");
    return null;
  }
}

