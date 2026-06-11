import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";
import stringComparison from "string-comparison";
import type {
  Ctx,
  KeywordIndexEntry,
  LoadedPlugin,
  MiddlewareFn,
  Msg,
  PluginDef,
} from "./types.js";
import { globalMiddlewares } from "./middleware/index.js";

const dice = stringComparison.diceCoefficient;

// ─── matching helpers ────────────────────────────────────────────────────────

function platformAllowed(plugin: LoadedPlugin, msg: Msg): boolean {
  return plugin.platforms === undefined || plugin.platforms.includes(msg.platform);
}

// Non-keyword matcher (regex/all). Keyword centralized di fuzzy path.
function matchesNonKeyword(plugin: LoadedPlugin, msg: Msg): boolean {
  if (!platformAllowed(plugin, msg)) return false;
  const { type, values = [] } = plugin.match;
  if (type === "all") return true;
  if (type === "regex") return values.some((v) => new RegExp(v, "i").test(msg.text ?? ""));
  // "keyword" → di-handle terpisah lewat keywordIndex.
  // "intent" → TODO, belum diimplementasikan.
  return false;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.!?;:"'()[\]{}<>/\\|@#$%^&*=+~`-]+/u)
    .filter(Boolean);
}

interface KeywordHit {
  plugin: string;
  keyword: string;
  score: number;
}

/**
 * Fuzzy keyword match centralized.
 * Token-wise: tiap token user dicoba ke seluruh keyword index sekaligus,
 * pakai sortMatch (dice coefficient). Pilih hit terbaik yang lulus threshold.
 */
function findKeywordMatch(
  text: string,
  index: KeywordIndexEntry[],
  msgPlatform: Msg["platform"],
  plugins: LoadedPlugin[],
): KeywordHit | null {
  if (index.length === 0 || !text) return null;

  // Filter index by platform whitelist masing-masing plugin.
  const allowed = new Set(
    plugins
      .filter((p) => platformAllowed(p, { platform: msgPlatform } as Msg))
      .map((p) => p.name),
  );
  const filtered = index.filter((e) => allowed.has(e.plugin));
  if (filtered.length === 0) return null;

  // Keyword yang sama bisa didaftarkan > 1 plugin (threshold beda-beda) —
  // kelompokkan supaya semua entry ikut dipertimbangkan, bukan cuma yang pertama.
  const byKeyword = new Map<string, KeywordIndexEntry[]>();
  for (const e of filtered) {
    const list = byKeyword.get(e.keyword);
    if (list) list.push(e);
    else byKeyword.set(e.keyword, [e]);
  }

  const keywords = [...byKeyword.keys()];
  const tokens = tokenize(text);
  let best: KeywordHit | null = null;

  for (const token of tokens) {
    const ranked = dice.sortMatch(token, keywords) as Array<{ member: string; rating: number }>;
    for (const r of ranked) {
      // sortMatch sorted desc by rating — kalau yang teratas pun di bawah best, skip sisanya.
      if (best && r.rating <= best.score) break;
      for (const entry of byKeyword.get(r.member) ?? []) {
        if (r.rating < entry.threshold) continue;
        // Tie pada rating sama: entry pertama (urutan load plugin) menang.
        best = { plugin: entry.plugin, keyword: r.member, score: r.rating };
        break;
      }
    }
  }
  return best;
}

// ─── dispatch ────────────────────────────────────────────────────────────────

type Hook = (msg: Msg, ctx: Ctx) => Promise<void>;

function getHook(plugin: PluginDef, event: Msg["event"]): Hook | undefined {
  switch (event) {
    case "message":
      return plugin.handle?.bind(plugin);
    case "media":
      return plugin.onMedia?.bind(plugin);
    case "join":
      return plugin.onJoin?.bind(plugin);
    case "leave":
      return plugin.onLeave?.bind(plugin);
  }
}

// Cache modul middleware lokal — dynamic import per pesan tidak perlu diulang.
const localMwCache = new Map<string, Promise<MiddlewareFn>>();

async function loadLocalMiddleware(dir: string, name: string): Promise<MiddlewareFn> {
  const cacheKey = `${dir}::${name}`;
  let cached = localMwCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      const candidates = [
        path.join(dir, "middleware", `${name}.js`),
        path.join(dir, "middleware", `${name}.ts`),
        path.join(dir, "middleware", `${name}.mjs`),
      ];
      const found = candidates.find((c) => fs.existsSync(c));
      if (!found) throw new Error(`middleware "${name}" tidak ditemukan di ${dir}/middleware/`);
      const mod = (await import(pathToFileURL(found).href)) as { default: MiddlewareFn };
      return mod.default;
    })();
    localMwCache.set(cacheKey, cached);
    // Jangan cache kegagalan — file bisa muncul tanpa restart (dev mode).
    cached.catch(() => localMwCache.delete(cacheKey));
  }
  return cached;
}

/** Jalankan local middleware + hook plugin. Return true kalau plugin di-handle. */
async function dispatch(plugin: LoadedPlugin, msg: Msg, ctx: Ctx): Promise<boolean> {
  const hook = getHook(plugin.handler, msg.event);
  if (!hook) return false;

  for (const mwName of plugin.middleware ?? []) {
    try {
      const mw = await loadLocalMiddleware(plugin.dir, mwName);
      await mw(msg, ctx);
    } catch (err) {
      // Middleware error = pesan dianggap handled (jangan fall-through ke plugin
      // lain) — konsisten dengan error handling hook di bawah.
      ctx.log.error(
        { plugin: plugin.name, middleware: mwName, err: (err as Error).message },
        "middleware error",
      );
      return true;
    }
    if (ctx.stopped) return true;
  }

  try {
    await hook(msg, ctx);
  } catch (err) {
    ctx.log.error({ plugin: plugin.name, err: (err as Error).message }, "plugin error");
  }
  return true;
}

// ─── entry point ─────────────────────────────────────────────────────────────

export async function route(
  msg: Msg,
  ctx: Ctx,
  plugins: LoadedPlugin[],
  keywordIndex: KeywordIndexEntry[],
): Promise<void> {
  // 1. global middleware
  for (const mw of globalMiddlewares) {
    await mw(msg, ctx);
    if (ctx.stopped) return;
  }

  // 2. conversation lock — kalau user dalam flow, dispatch ke plugin owner.
  const active = ctx.helpers.conversation.current(msg.from, msg.platform);
  if (active) {
    const plugin = plugins.find((p) => p.name === active.plugin);
    if (!plugin) {
      ctx.log.warn({ plugin: active.plugin }, "[router] conversation plugin missing — auto-exit");
      ctx.helpers.conversation.exit(msg.from, msg.platform);
    } else if (await dispatch(plugin, msg, ctx)) {
      return;
    }
    // hook untuk event ini tidak ada di plugin owner → fall through.
  }

  // 3. fuzzy keyword (centralized) — hanya untuk event "message".
  if (msg.event === "message" && msg.text) {
    const hit = findKeywordMatch(msg.text, keywordIndex, msg.platform, plugins);
    if (hit) {
      const plugin = plugins.find((p) => p.name === hit.plugin);
      if (plugin) {
        ctx.matched = { keyword: hit.keyword, score: hit.score };
        if (await dispatch(plugin, msg, ctx)) return;
      }
    }
  }

  // 4. regex + all (keyword sudah di-handle di step 3).
  for (const plugin of plugins) {
    if (plugin.match.type === "keyword") continue;
    if (!matchesNonKeyword(plugin, msg)) continue;
    if (await dispatch(plugin, msg, ctx)) return;
  }
}
