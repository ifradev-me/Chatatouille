export type Platform = "whatsapp" | "telegram" | "discord";

export type MsgEvent = "message" | "media" | "join" | "leave";

export interface Msg {
  id: string;
  platform: Platform;
  /**
   * Stable identifier untuk pengirim. Lintas-platform:
   * - whatsapp: LID jika tersedia, fallback ke PN (nomor HP), keduanya tanpa suffix `@domain`.
   * - telegram: numeric user id.
   * - discord:  snowflake user id.
   * Selalu pakai field ini untuk DB lookup / history / session.
   */
  from: string;
  /** Nomor HP (E.164 tanpa `+`) jika diketahui — hanya WhatsApp dan hanya kalau kontak punya PN. */
  phoneNumber?: string;
  /** LID asli (`xxxx@lid`) hanya untuk WhatsApp — kalau perlu kirim balas pakai addressing LID. */
  lid?: string;
  /** Untuk WhatsApp: addressing mode chat ini ("lid" | "pn"). Plugin tidak perlu peduli. */
  addressingMode?: "lid" | "pn";
  /** Raw remoteJid (di WhatsApp). Adapter pakai ini untuk balas; plugin jangan pakai langsung. */
  remoteJid?: string;
  /** Display name yang dilaporkan platform (push name di WA, dst). */
  pushName?: string;
  /** Group identifier, null kalau private chat. */
  groupId: string | null;
  /** Apakah pesan ini dari grup. */
  isGroup: boolean;
  /** Apakah pesan dari diri sendiri (bot). */
  fromMe: boolean;
  text: string;
  media: { type: "image" | "video" | "file" | "audio"; url: string; mimeType?: string } | null;
  event: MsgEvent;
  /** Unix ms timestamp pesan. */
  timestamp: number;
  /** Pesan asli dari platform — adapter-specific. */
  raw: unknown;
}

export interface Logger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface Config {
  WA_SESSION_PATH: string;
  WA_USE_PAIRING_CODE: boolean;
  WA_PHONE_NUMBER: string;
  TELEGRAM_TOKEN: string;
  DISCORD_TOKEN: string;
  ENABLE_WHATSAPP: boolean;
  ENABLE_TELEGRAM: boolean;
  ENABLE_DISCORD: boolean;
  DATABASE_URL: string;
  N8N_WEBHOOK_URL: string;
  PORT: number;
  LOG_LEVEL: string;
}

export interface Ctx {
  reply(text: string): Promise<void>;
  replyMedia(url: string, caption?: string): Promise<void>;
  db: DbClient;
  config: Config;
  log: Logger;
  platform: Platform;
  helpers: {
    user: UserHelpers;
    history: HistoryHelpers;
    session: SessionHelpers;
    conversation: ConversationHelpers;
  };
  stop(): void;
  stopped: boolean;
  /** Diisi router saat plugin di-trigger via fuzzy keyword match. Read-only. */
  matched?: { keyword: string; score: number };
}

export interface PluginDef {
  handle?(msg: Msg, ctx: Ctx): Promise<void>;
  onMedia?(msg: Msg, ctx: Ctx): Promise<void>;
  onJoin?(msg: Msg, ctx: Ctx): Promise<void>;
  onLeave?(msg: Msg, ctx: Ctx): Promise<void>;
}

export type MiddlewareFn = (msg: Msg, ctx: Ctx) => Promise<void>;

// ─── plugin.json ─────────────────────────────────────────────────────────────

// "intent" = TODO: belum ada classifier built-in. Manifest yang pakai ini
// akan di-skip router (lihat router.ts). Dipertahankan di union supaya plugin
// lama tidak gagal di-load.
export type MatchType = "keyword" | "regex" | "intent" | "all";

export interface PluginMatch {
  type: MatchType;
  values?: string[];
  /**
   * Fuzzy threshold (0..1) untuk `type: "keyword"`. Default global = 0.6.
   * Score < threshold → tidak dianggap match. Pakai turunkan kalau target longgar,
   * naikkan kalau strict.
   */
  threshold?: number;
}

// Index keyword global yang dibangun loader sekali saat boot. Dipakai router
// untuk fuzzy match centralized (sortMatch lintas semua keyword sekaligus).
export interface KeywordIndexEntry {
  plugin: string;
  keyword: string;
  threshold: number;
}

export interface PluginManifest {
  name: string;
  enabled: boolean;
  match: PluginMatch;
  /**
   * Whitelist platform yang boleh menjalankan plugin ini.
   * - field absent / undefined → semua platform (backward compatible).
   * - `[]` empty → plugin tidak jalan di mana pun (loader akan warn).
   * - `["whatsapp"]` → WA only.
   */
  platforms?: Platform[];
  middleware?: string[];
  response?: { type: "static" | "dynamic" | "llm" };
}

export interface LoadedPlugin extends PluginManifest {
  dir: string;
  handler: PluginDef;
}

// ─── DB (PostgreSQL via pg) ──────────────────────────────────────────────────
// Implementasi di core/db/index.ts; schema dikelola lewat raw SQL migrations
// di core/db/migrations/. Plugin sebaiknya pakai ctx.helpers.* daripada
// ctx.db langsung supaya tidak coupling ke implementasi DB.

export interface DbCollection<T> {
  findOne(query: Partial<T>): Promise<T | null>;
  find(query: Partial<T>, opts?: { limit?: number; since?: Date }): Promise<T[]>;
  create(data: T): Promise<T>;
  updateOne(query: Partial<T>, data: Partial<T>): Promise<T>;
  deleteMany(query: Partial<T>): Promise<void>;
}

export interface DbClient {
  users: DbCollection<User>;
  history: DbCollection<HistoryEntry>;
  /** Generic save bila plugin butuh collection ad-hoc. */
  save(collection: string, data: Record<string, unknown>): Promise<{ id: string } & Record<string, unknown>>;
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  from: string;
  platform: Platform;
  name?: string;
  phoneNumber?: string;
  lid?: string;
  banned: boolean;
  /** First-contact welcome sudah dikirim. Di-set oleh middleware/welcome.ts. */
  welcomed: boolean;
  createdAt: Date;
}

// User dilookup per-platform. WA `"628123"` dan Telegram `"628123"` adalah user
// terpisah. Schema: UNIQUE (from, platform).
export interface UserHelpers {
  find(from: string, platform: Platform): Promise<User | null>;
  findOrCreate(from: string, platform: Platform, extra?: Partial<User>): Promise<User>;
  update(from: string, platform: Platform, data: Partial<User>): Promise<User>;
  ban(from: string, platform: Platform): Promise<void>;
  isBanned(from: string, platform: Platform): Promise<boolean>;
}

// ─── History ─────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id?: string;
  from: string;
  platform: Platform;
  text: string;
  role: "user" | "bot";
  createdAt: Date;
}

export interface HistoryHelpers {
  get(from: string, platform: Platform, opts?: { limit?: number; since?: Date }): Promise<HistoryEntry[]>;
  append(msg: Msg, role: "user" | "bot", replyText?: string): Promise<void>;
  clear(from: string, platform: Platform): Promise<void>;
}

// ─── Session ─────────────────────────────────────────────────────────────────

export interface SessionHelpers {
  get<T>(from: string): T | null;
  set<T>(from: string, data: T, ttlMs?: number): void;
  clear(from: string): void;
  has(from: string): boolean;
}

// ─── Conversation (multi-step flow) ─────────────────────────────────────────

export interface ConversationState<T = unknown> {
  /** Nama plugin owner. Router dispatch ke plugin ini selama flow aktif. */
  plugin: string;
  /** State milik plugin — bentuk bebas. */
  state: T;
}

export interface ConversationHelpers {
  /**
   * Masuk ke flow. Selama aktif, router bypass matching dan dispatch ke plugin ini.
   * @param ttlMs WAJIB — jangan infinite, supaya user tidak stuck.
   * @param opts.force overwrite flow yang sudah ada (admin override).
   */
  enter(
    from: string,
    platform: Platform,
    plugin: string,
    state: unknown,
    ttlMs: number,
    opts?: { force?: boolean },
  ): void;
  /** Update state, TTL tidak di-reset. */
  update(from: string, platform: Platform, state: unknown): void;
  /** Baca state aktif. null kalau tidak dalam flow / sudah expire. */
  current<T = unknown>(from: string, platform: Platform): ConversationState<T> | null;
  /** Keluar dari flow. Plugin **wajib** call ini setelah selesai. */
  exit(from: string, platform: Platform): void;
}
