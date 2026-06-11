# Mengedit Core

> 🇬🇧 [English](CORE.md) · 🇮🇩 Bahasa Indonesia

Panduan untuk siapa pun yang akan **mengubah `core/`** — bukan menulis plugin. Tiap bagian punya:

- **Kapan** harus disentuh
- **File yang terlibat**
- **Langkah-langkah** dalam urutan yang benar
- **Yang perlu diperhatikan** (pitfall, breaking change risk)
- **Cara verifikasi**

Aturan umum sebelum menyentuh apa pun di `core/`:

> Setiap perubahan di `core/` berpotensi memengaruhi **semua plugin**. Setiap penambahan di `types.ts` ideal-nya **opsional** (`?` atau default value) supaya plugin lama tidak break.

---

## 0. Peta core

```
core/
├── index.ts          ← entry: migrate DB, load plugins, boot platforms
├── types.ts          ← KONTRAK. Hampir semua perubahan dimulai/berakhir di sini
├── config.ts         ← parse .env ke shape Config
├── logger.ts         ← pino instance (pretty di dev, raw JSON saat NODE_ENV=production)
├── loader.ts         ← discover plugin.json + dynamic import handler + keyword index
├── router.ts         ← matching plugin + dispatch lifecycle hook
├── plugin-sdk.ts     ← utility yang di-import plugin
├── db/               ← PostgreSQL: pool.ts, migrate.ts, index.ts (DbClient), migrations/*.sql
├── middleware/       ← global middleware (jalan untuk semua pesan)
├── helpers/          ← domain helpers (user, history, session, conversation) di-attach ke ctx.helpers
└── platforms/        ← adapter per platform (whatsapp, telegram, discord)
```

**Mental model**:

```
.env → config.ts ──┐
                    ├─→ platform adapter ─→ Msg (normalized)
                    │                         │
                    │                         ▼
                    │                   global middleware
                    │                         │
                    │                         ▼
                    │                   loader pick plugin
                    │                         │
                    │                         ▼
                    │                   local middleware
                    │                         │
                    │                         ▼
                    │                   lifecycle hook (handle/onMedia/...)
                    │                         │
                    │                         ▼
plugin-sdk.ts ─────┴─→ helpers ──→ db
```

---

## 1. Menambah field di `Msg`

### Kapan
Pesan dari platform punya info yang belum ter-expose ke plugin (mis. `replyToMessageId`, `forwarded`, `reaction`, dst.).

### File
- [core/types.ts](../core/types.ts) — tambah field di interface `Msg`.
- Semua adapter di [core/platforms/](../core/platforms/) — isi field saat normalisasi.

### Langkah
1. Tambah field di `Msg` sebagai **opsional** (`field?: T`) supaya plugin lama tidak break.
2. Tambah JSDoc — jelaskan kapan field tersedia (platform mana, kondisi apa).
3. Update **setiap** adapter untuk isi field tersebut. Adapter yang tidak punya info tersebut → biarkan `undefined` (jangan dummy value).
4. Kalau platform tidak punya info: jangan paksakan polyfill — biarkan `undefined`, dokumentasikan.

### Yang perlu diperhatikan
- **Jangan** bikin field wajib (`field: T`) kalau hanya satu platform yang bisa isi. Itu memaksa adapter lain bohong.
- **Lintas-platform**: field yang sama harus punya **semantik sama**. `text` di WA dan Telegram harus sama-sama "pesan teks utama", bukan "caption" di satu sisi dan "body" di sisi lain.
- Pertimbangkan apakah field ini sebenarnya butuh hook lifecycle baru (lihat §3).

### Verifikasi
```bash
npm run typecheck     # cek semua adapter masih lulus
```
Test manual di platform yang relevan.

---

## 2. Menambah middleware global

### Kapan
Logic yang harus jalan untuk **semua pesan, di semua platform, sebelum plugin manapun**. Contoh: telemetry, blocklist, anti-spam global, language detection.

### File
- Buat file baru di [core/middleware/](../core/middleware/).
- Daftarkan di [core/middleware/index.ts](../core/middleware/index.ts).

### Langkah
1. Buat `core/middleware/namaMu.ts`:

   ```ts
   import type { MiddlewareFn } from "../types.js";

   const namaMu: MiddlewareFn = async (msg, ctx) => {
     // ... logic
     if (kondisiStop) {
       await ctx.reply("alasan");
       ctx.stop();
     }
   };

   export default namaMu;
   ```

2. Tambahkan ke array di `core/middleware/index.ts`:

   ```ts
   import namaMu from "./namaMu.js";
   export const globalMiddlewares: MiddlewareFn[] = [logger, ratelimit, auth, welcome, namaMu];
   ```

### Yang perlu diperhatikan
- **Urutan penting**. Saat ini:
  1. `logger` — selalu jalan, hanya observasi
  2. `ratelimit` — block sebelum side-effect mahal
  3. `auth` — auto-register user + ban check
  4. `welcome` — first-contact welcome (private chat only; butuh user di DB)
  5. (middleware baru taruh setelah ini biasanya)

- **`ctx.stop()`** akan **menghentikan semua middleware berikutnya + plugin**. Pikirkan apakah itu yang Anda mau. Untuk middleware yang sekadar observasi, jangan panggil `stop()`.

- **Hindari I/O blocking lama** di middleware global — ini jalan untuk **setiap** pesan. Operasi DB harus cepat (indexed lookup), HTTP call harus punya timeout pendek (~500ms) atau jangan dilakukan di sini.

- **`msg.fromMe` handling**: middleware `auth` sudah `stop()` untuk pesan dari bot sendiri. Kalau Anda taruh middleware baru **sebelum** `auth`, handle `fromMe` sendiri.

- **Banned user**: setelah `auth`, plugin tidak dipanggil. Middleware setelah `auth` juga tidak dipanggil (karena `auth` panggil `stop()`). Pastikan urutan Anda benar.

### Verifikasi
- Kirim pesan, cek log middleware Anda muncul.
- Test edge case: pesan dari bot sendiri, dari user banned, di luar jam (kalau pakai filter waktu), dll.

---

## 3. Menambah lifecycle event baru (selain handle/onMedia/onJoin/onLeave)

### Kapan
Platform punya event yang konseptual berbeda dari yang ada — mis. `reaction`, `edit`, `poll-vote`, `call`.

### File
- [core/types.ts](../core/types.ts) — extend `MsgEvent` + `PluginDef`.
- [core/router.ts](../core/router.ts) — extend `getHook()`.
- Adapter platform yang men-trigger event tersebut.

### Langkah
1. Di `types.ts`, tambah varian ke `MsgEvent`:

   ```ts
   export type MsgEvent = "message" | "media" | "join" | "leave" | "reaction";
   ```

2. Tambah hook opsional di `PluginDef`:

   ```ts
   export interface PluginDef {
     handle?(msg: Msg, ctx: Ctx): Promise<void>;
     onMedia?(msg: Msg, ctx: Ctx): Promise<void>;
     onJoin?(msg: Msg, ctx: Ctx): Promise<void>;
     onLeave?(msg: Msg, ctx: Ctx): Promise<void>;
     onReaction?(msg: Msg, ctx: Ctx): Promise<void>;   // ← baru
   }
   ```

3. Di `router.ts`, mapping di `getHook()`:

   ```ts
   function getHook(plugin, event) {
     switch (event) {
       case "message":  return plugin.handle?.bind(plugin);
       case "media":    return plugin.onMedia?.bind(plugin);
       case "join":     return plugin.onJoin?.bind(plugin);
       case "leave":    return plugin.onLeave?.bind(plugin);
       case "reaction": return plugin.onReaction?.bind(plugin);   // ← baru
     }
   }
   ```

4. Di adapter platform yang relevan, dispatch event:

   ```ts
   // misalnya di whatsapp.ts saat handle messages.reaction
   const msg: Msg = { ...common, event: "reaction" };
   await route(msg, makeCtx(sock, msg), plugins, keywordIndex);
   ```

### Yang perlu diperhatikan
- **Backward compat**: hook baru WAJIB opsional (`?`). Plugin lama otomatis di-skip oleh router (karena `getHook` return `undefined`).
- **Match logic**: plugin pakai `match: keyword/regex` mungkin tidak relevan untuk event baru (`reaction` biasanya tidak punya `text`). Pertimbangkan: plugin yang mau handle event baru biasanya pakai `match: all`. Kalau perlu, dokumentasikan di [docs/PLUGINS.md](PLUGINS.id.md).
- **Konsistensi `Msg`**: event baru tetap harus isi field minimum (`id`, `from`, `platform`, `event`, `timestamp`). Field lain bisa kosong (`text: ""`, `media: null`).
- **Adapter lain**: tidak perlu di-update — kalau platform lain belum support event ini, ya tidak akan men-trigger. Itu fine.

### Verifikasi
1. `npm run typecheck`
2. Plugin lama tetap bisa load (tidak require hook baru).
3. Buat plugin test yang implement `onReaction`, kirim reaction, cek terpanggil.

---

## 4. Menambah helper baru di `ctx.helpers`

### Kapan
Domain logic yang dipakai banyak plugin dan tahu struktur DB. Bedanya dengan SDK: helper tahu data shape & akses DB, SDK utility teknis generic.

| | SDK (`plugin-sdk.ts`) | Helpers (`core/helpers/`) |
|---|---|---|
| Akses DB | tidak | ya |
| Generic | ya | tidak (domain-aware) |
| Contoh | `retry`, `formatMessage`, `match` | `user`, `history`, `session`, `conversation` |

### File
- [core/types.ts](../core/types.ts) — tambah interface helper baru + tambah di `Ctx.helpers`.
- Buat file di [core/helpers/](../core/helpers/).
- Update [core/helpers/index.ts](../core/helpers/index.ts) — export.
- Tiap adapter platform → `makeCtx()` harus include helper baru. (Saat ini `import * as helpers from "../helpers/index.js"` jadi otomatis ter-include — verifikasi pola ini di tiap adapter.)

### Langkah
1. Di `types.ts`, tambah interface:

   ```ts
   export interface OrderHelpers {
     create(from: string, item: string): Promise<{ id: string }>;
     getByUser(from: string): Promise<Order[]>;
     cancel(id: string): Promise<void>;
   }
   ```

2. Tambah ke `Ctx.helpers`:

   ```ts
   helpers: {
     user: UserHelpers;
     history: HistoryHelpers;
     session: SessionHelpers;
     conversation: ConversationHelpers;
     order: OrderHelpers;     // ← baru
   };
   ```

3. Buat `core/helpers/order.ts`:

   ```ts
   import type { OrderHelpers } from "../types.js";
   import { db } from "../db/index.js";

   export const order: OrderHelpers = {
     async create(from, item) { /* ... */ },
     async getByUser(from)    { /* ... */ },
     async cancel(id)          { /* ... */ },
   };
   ```

4. Export di `core/helpers/index.ts`:

   ```ts
   export { user } from "./user.js";
   export { history } from "./history.js";
   export { session } from "./session.js";
   export { conversation } from "./conversation.js";
   export { order } from "./order.js";    // ← baru
   ```

### Yang perlu diperhatikan
- **Helper harus bersih dari side-effect saat load.** Jangan inisialisasi koneksi/timer di module top-level kecuali memang dibutuhkan (dan idempotent).
- **Schema DB**: kalau helper butuh table baru, tambah migration di [core/db/migrations/](../core/db/migrations/) + `FieldMap` di [core/db/index.ts](../core/db/index.ts) (lihat §10).
- **Adapter compatibility**: kalau pola `makeCtx` di adapter sudah `helpers,` (object shorthand di-import wholesale), otomatis dapat helper baru. Kalau adapter destructure manual (`{ user, history, session }`), perlu di-update.
- **Pastikan helper deterministik untuk testing.** Hindari `Date.now()` langsung — terima clock injectable, atau dokumentasikan.

### Verifikasi
```bash
npm run typecheck
```
Plugin test pakai `ctx.helpers.order.create(...)` — verifikasi data tersimpan & dapat di-retrieve.

---

## 5. Menambah platform baru (mis. Slack, Line, Instagram DM)

### Kapan
Platform baru. Bot mendukung multi-platform — plugin **tidak** perlu tahu ada platform baru selama adapter menormalisasi pesan ke `Msg`.

### File
- Buat [core/platforms/slack.ts](../core/platforms/slack.ts) (atau platform lain).
- [core/types.ts](../core/types.ts) — tambah ke union `Platform`.
- [core/config.ts](../core/config.ts) — tambah env vars (token, dll).
- [core/index.ts](../core/index.ts) — boot adapter kalau enabled.
- [.env.example](../.env.example) — dokumentasikan env vars.

### Langkah
1. Tambah ke `Platform`:

   ```ts
   export type Platform = "whatsapp" | "telegram" | "discord" | "slack";
   ```

2. Tambah config:

   ```ts
   // config.ts
   SLACK_TOKEN: process.env.SLACK_TOKEN ?? "",
   ENABLE_SLACK: bool(process.env.ENABLE_SLACK, false),
   ```

3. Buat adapter `core/platforms/slack.ts`:

   ```ts
   import type { KeywordIndexEntry, LoadedPlugin, Msg, Ctx } from "../types.js";
   import { config } from "../config.js";
   import { logger } from "../logger.js";
   import { db } from "../db/index.js";
   import * as helpers from "../helpers/index.js";
   import { route } from "../router.js";

   interface StartOpts {
     plugins: LoadedPlugin[];
     keywordIndex: KeywordIndexEntry[];
   }

   export async function startSlack({ plugins, keywordIndex }: StartOpts) {
     // 1. connect ke Slack
     // 2. listen ke event yang relevan
     // 3. saat pesan masuk:
     const msg: Msg = {
       id, platform: "slack", from, groupId, isGroup,
       fromMe, text, media, event: "message",
       timestamp, raw,
     };
     const ctx = makeCtx(msg);
     await route(msg, ctx, plugins, keywordIndex);
   }

   function makeCtx(msg: Msg): Ctx {
     let stopped = false;
     return {
       platform: "slack",
       db, config, log: logger, helpers,
       async reply(text)      { /* slack.chat.postMessage */ },
       async replyMedia(url, caption) { /* slack files.upload */ },
       stop()      { stopped = true; },
       get stopped() { return stopped; },
     };
   }
   ```

4. Wire di `index.ts`:

   ```ts
   if (config.ENABLE_SLACK) tasks.push(startSlack({ plugins, keywordIndex }));
   ```

### Yang perlu diperhatikan
- **Normalisasi adalah pekerjaan utama adapter.** Jangan teruskan field platform-specific ke plugin selain via `msg.raw`. Plugin yang baca `msg.raw` jadi tightly-coupled dan tidak portable.
- **Identity (`msg.from`)**: pilih identifier yang **stabil**. Di Slack itu user ID (`Uxxxxx`), bukan display name. Di WhatsApp, kami prefer LID (bukan nomor HP). Dokumentasikan pilihan di kode + di [docs/PLUGINS.md §10](PLUGINS.id.md).
- **`replyMedia`**: pastikan support file path lokal **dan** URL HTTP. Plugin (`plugin-image`) kirim path lokal hasil download — adapter harus upload, bukan asumsikan URL publik.
- **Auto-reconnect**: implementasikan setelah disconnect transient. Lihat pola di `whatsapp.ts` — schedule `startSock()` lagi setelah delay.
- **Auth state persist**: WhatsApp pakai `useMultiFileAuthState`. Platform lain biasanya cukup bot token di env. Jangan commit token.
- **Rate limit platform**: tiap platform punya batas API berbeda (WA: anti-ban, Telegram: 30 msg/sec/bot, Slack: tier-based). Hormati di adapter, bukan di plugin.
- **Lifecycle event coverage**: minimal `message` & `media`. `join`/`leave` opsional kalau platform support group/channel.

### Verifikasi
```bash
npm run typecheck
ENABLE_SLACK=true npm start
```
Kirim pesan dari Slack → cek log + bot balas. Test plugin existing tetap jalan tanpa modifikasi (itulah ujian portability).

---

## 6. Menambah / mengubah utility di `plugin-sdk.ts`

### Kapan
Utility teknis generic yang bermanfaat untuk banyak plugin. **Bukan** untuk akses DB/state — itu helpers.

### File
- [core/plugin-sdk.ts](../core/plugin-sdk.ts) — tambah export baru.
- [docs/PLUGINS.md §5](PLUGINS.id.md) — dokumentasikan.

### Langkah
1. Tambah fungsi di `plugin-sdk.ts`:

   ```ts
   /**
    * Debounce fungsi async — panggilan berikutnya dalam window di-ignore.
    * Berguna untuk handler yang nge-trigger di event burst.
    */
   export function debounce<A extends unknown[]>(
     fn: (...args: A) => Promise<void>,
     ms: number,
   ): (...args: A) => void {
     let timer: NodeJS.Timeout | null = null;
     return (...args) => {
       if (timer) clearTimeout(timer);
       timer = setTimeout(() => { void fn(...args); }, ms);
     };
   }
   ```

2. Update docs.

### Yang perlu diperhatikan
- **NO breaking change.** Plugin lama mungkin import utility lama. Kalau perlu ganti signature, **tambah** fungsi baru — jangan ubah yang ada.
- **Generic.** SDK utility yang assume DB shape, env var spesifik, atau platform tertentu = salah tempat. Pindahkan ke `helpers/` atau bikin abstraction.
- **No side-effect saat load.** SDK di-import sebanyak jumlah plugin × kali. Hindari timer/listener di top-level.
- **Type-safe.** Pakai generics + JSDoc. `unknown`/`any` di SDK akan menyebar ke plugin dan bikin codebase mereka brittle.
- **Test minimal.** Utility seperti `retry`, `formatMessage` mudah di-unit-test — kalau menambah, sertakan setidaknya satu test (kalau test infra sudah ada).

### Verifikasi
```bash
npm run typecheck
```
Plugin yang pakai utility lama tetap jalan (tidak break).

---

## 7. Mengubah `router.ts`

### Kapan
**Hanya** kalau routing logic fundamental berubah:
- Tambah jenis matching baru (mis. `match.type: "intent"` dengan classifier real)
- Allow multiple plugins match (saat ini hanya 1)
- Reorder global vs local middleware
- Tambah parameter ke hook

### File
- [core/router.ts](../core/router.ts)
- Kalau breaking, [core/types.ts](../core/types.ts) juga (signature change).

### Urutan routing saat ini
1. **Global middleware** (logger → ratelimit → auth → welcome)
2. **Conversation lock** — `ctx.helpers.conversation.current()`. Kalau aktif, dispatch ke plugin owner (bypass matching). Kalau plugin owner missing → auto-`exit()` + fall through.
3. **Fuzzy keyword** (centralized) — `findKeywordMatch()` token-wise pakai dice coefficient lintas `keywordIndex`. Plugin dengan score tertinggi yang lulus threshold menang. **Hanya untuk event `"message"`**.
4. **Regex + all loop** — plugin dengan `match.type === "keyword"` di-skip (sudah di step 3).

### Yang perlu diperhatikan — ini PALING SENSITIF di codebase

- **Setiap perubahan di sini memengaruhi 100% pesan, 100% plugin.**
- **Pattern saat ini**: plugin pertama yang match + punya hook menang, sisanya di-skip. Mengubah ini (mis. ke "semua plugin yang match jalan") = breaking semantic untuk semua plugin existing.
- **`match.type: "intent"`** saat ini placeholder — return `false`. Kalau implement: panggil classifier eksternal jangan blocking, cache result per-pesan kalau dipanggil > 1x.
- **Hook signature `(msg, ctx)`** sudah jadi kontrak. Menambah parameter ke-3 = breaking. Tambah field di `ctx` atau `msg` malah.
- **Error handling**: router saat ini `try/catch` di sekitar `hook()`, log error tapi tidak crash. Pertahankan ini — satu plugin yang error tidak boleh bunuh bot.
- **Local middleware loading**: lazy (`await import` saat dispatch pertama) lalu di-cache di module-level `Map`. Loader juga warn saat boot kalau file middleware yang dideklarasikan manifest tidak ada. Error middleware di-log dan pesan dianggap handled (tidak fall-through ke plugin lain).
- **Conversation lock prioritas tertinggi**. Plugin yang dalam flow akan dapat semua pesan, termasuk kalau text-nya match fuzzy keyword plugin lain. Untuk admin override, plugin owner perlu deteksi command admin sendiri + `exit()`.
- **`keywordIndex` dibangun sekali di boot** (lihat §8). Plugin yang `enabled: false` atau platform mismatch akan di-filter saat lookup.

### Langkah saat mengubah
1. Tulis behavior baru di komentar dulu — apa yang berubah dari pattern saat ini.
2. Update test case kalau ada (atau test manual setidaknya 3 plugin: specific match, fallback `all`, plugin dengan local middleware).
3. Update [docs/PLUGINS.md §1 "match.type"](PLUGINS.id.md) kalau semantic match berubah.
4. Catat breaking change di CHANGELOG/README.

---

## 8. Mengubah `loader.ts`

### Kapan
- Cara discovery plugin berubah (mis. plugin di npm registry, bukan folder)
- Format manifest berubah (`plugin.json` → `plugin.yaml`)
- Hot-reload plugin tanpa restart bot

### File
- [core/loader.ts](../core/loader.ts)
- [scripts/copy-manifests.mjs](../scripts/copy-manifests.mjs) kalau struktur output dist berubah

### Yang perlu diperhatikan
- **Loader run sekali saat boot.** Tidak ada watch/hot-reload built-in. Kalau mau tambah hot-reload, hati-hati state plugin top-level (rate limiter map, health check interval) — perlu di-cleanup saat reload. Juga `keywordIndex` perlu di-rebuild.
- **Dual mode**: source (plugins/) dan compiled (dist/plugins/). Kalau ubah, jaga supaya keduanya tetap jalan, atau pilih satu mode + update docs + build script.
- **`plugin.json` copy ke dist** dilakukan oleh `scripts/copy-manifests.mjs` (di-trigger oleh `npm run build`). Script ini juga copy `core/db/migrations/*.sql` → `dist/core/db/migrations/` dan `plugins/*/migrations/*.sql` → `dist/plugins/*/migrations/`. Kalau tambah file non-TS baru, update script ini.
- **Loader error tolerance**: kalau satu plugin gagal load (manifest invalid, import error), log + skip — jangan crash boot. Pattern saat ini di-`try/catch` per plugin.
- **Urutan loading**: `specifics` dulu, `fallbacks` (`match.type === "all"`) terakhir. Mengubah urutan = mengubah routing semantic untuk regex/all path.
- **`buildKeywordIndex(plugins)`** harus dipanggil setelah `loadPlugins()` — output dipakai router untuk fuzzy match. Hanya plugin `match.type === "keyword"` masuk index. Default threshold global = `DEFAULT_FUZZY_THRESHOLD` (0.6).
- **`platforms[]` validation**: `validatePlatforms()` warn kalau value bukan `whatsapp`/`telegram`/`discord` atau kalau array kosong. Plugin tetap ter-load (warn ≠ skip).

### Langkah
1. Identifikasi apa yang berubah: discovery / manifest format / lifecycle.
2. Pastikan `LoadedPlugin` shape (di `types.ts`) tetap konsisten — router tergantung shape ini.
3. Test boot dengan 0 plugin, 1 plugin, mix specific+fallback.

---

## 9. Mengubah `config.ts` / menambah env var

### Kapan
- Platform baru → tambah token
- Feature flag baru
- DB URL / external service URL baru

### File
- [core/types.ts](../core/types.ts) — interface `Config`
- [core/config.ts](../core/config.ts) — parsing
- [.env.example](../.env.example) — dokumentasikan
- [README.md](../README.id.md) kalau bermakna user-facing

### Langkah
1. Tambah field di `interface Config` di `types.ts` — dengan **tipe yang strict** (`string`, `boolean`, `number`, bukan `string | undefined`).
2. Parse di `config.ts` dengan default value:

   ```ts
   NEW_FLAG: bool(process.env.NEW_FLAG, false),
   NEW_URL: process.env.NEW_URL ?? "",
   NEW_PORT: num(process.env.NEW_PORT, 8080),
   ```

3. Tambah ke `.env.example` dengan komentar:

   ```
   # ... apa ini, kapan dibutuhkan
   NEW_FLAG=false
   ```

### Yang perlu diperhatikan
- **Default value WAJIB.** Jangan biarkan field tipe `string | undefined` di `Config` — itu push validasi ke setiap consumer. Lebih baik default `""` lalu cek `if (!config.NEW_URL) ...` di tempat yang butuh.
- **Boolean parsing**: `bool()` helper handle `"true"`, `"1"`. Jangan parse `Boolean(process.env.X)` — string `"false"` jadi `true`.
- **Secrets**: jangan log full value. Kalau log untuk debug, mask: `secret.slice(0, 4) + "***"`.
- **Validasi saat boot**: kalau env var critical (mis. `WA_PHONE_NUMBER` saat `WA_USE_PAIRING_CODE=true`), log error jelas. Pattern: lihat `core/platforms/whatsapp.ts`.

---

## 10. Mengubah `db/` (Postgres)

DB layer = PostgreSQL via `pg`. Setup koneksi via `DATABASE_URL` di `.env`. Schema dikelola lewat raw SQL migrations.

### File
- [core/db/pool.ts](../core/db/pool.ts) — `pg.Pool` singleton dari `DATABASE_URL`
- [core/db/migrate.ts](../core/db/migrate.ts) — scan `migrations/*.sql`, apply yang belum di tabel `_migrations`
- [core/db/index.ts](../core/db/index.ts) — implementasi `DbClient` (translasi field TS ↔ kolom DB)
- [core/db/migrations/](../core/db/migrations/) — file `.sql`, urut by filename
- [core/types.ts](../core/types.ts) — interface `DbClient`, `DbCollection<T>`

### Tambah migration baru

1. Buat file di `core/db/migrations/` dengan format:
   ```
   [urutan]_[YYYYMMDD]_[HHMMSS]_[epoch_s]_[deskripsi].sql
   ```
   Contoh: `002_20260601_103045_1748778645_add_orders_table.sql`. Urutan numerik di depan jadi tie-breaker waktu sort filename. Filename = primary key di tabel `_migrations` — **tidak boleh di-rename setelah apply**.
2. Tulis SQL idempotency-friendly (`CREATE TABLE IF NOT EXISTS …` aman; `ALTER TABLE` tidak — bungkus dengan `DO $$ BEGIN … EXCEPTION WHEN duplicate_column THEN NULL; END $$;` kalau perlu).
3. Restart bot — `migrate()` jalan otomatis sebelum `loadPlugins()`. File pending dijalankan dalam transaksi tunggal per file (rollback on error).

### Plugin migrations (schema per plugin)

Tabel kebutuhan **plugin** TIDAK ditambahkan di sini — plugin punya jalur sendiri yang sepenuhnya self-contained (lihat [PLUGINS.md §8](PLUGINS.id.md)):

- File: `plugins/<nama>/migrations/*.sql` (format filename sama dengan core). Di-copy ke dist oleh `copy-manifests.mjs`.
- Runner: `migratePlugins()` di [core/db/migrate.ts](../core/db/migrate.ts) — dipanggil `index.ts` **setelah** `migrate()` core dan `loadPlugins()` (hanya plugin enabled).
- Isolasi: tiap file jalan dalam transaksi dengan `search_path = <schema>, public`; schema = nama plugin (`-`→`_`), auto-create. Tracking di `_migrations` dengan namespace `<plugin>/<filename>`.
- Kegagalan: **tidak** menghentikan boot — plugin yang gagal di-exclude dari routing (return value `migratePlugins`), error di log.
- Akses query plugin: `createPluginDb()` di [core/db/plugin.ts](../core/db/plugin.ts) (di-re-export `plugin-sdk.ts`) — pool kecil per plugin dengan `search_path` di level koneksi.

### Tambah collection baru ke `DbClient`

1. Tambah migration yang `CREATE TABLE` untuk schema-nya.
2. Tambah `FieldMap<T>` (TS field → kolom DB) di `core/db/index.ts`.
3. Tambah `makePgCollection<T>("table", fields)` ke object `db`.
4. Tambah field di interface `DbClient` di [types.ts](../core/types.ts).

### Yang perlu diperhatikan
- **Field name TS ≠ kolom DB**. Convention: camelCase di TS (`phoneNumber`, `createdAt`), snake_case di SQL (`phone_number`, `created_at`). Translasi dilakukan **hanya di `core/db/index.ts`** lewat `FieldMap` — helper & plugin pakai field name TS.
- **`from` adalah reserved word SQL**. Kolom disimpan sebagai `from_id`; field TS tetap `from`.
- **UNIQUE constraint per-platform**. `users` punya `UNIQUE (from_id, platform)` — semua user helper lookup pakai `{ from, platform }`. Jangan lookup hanya by `from`.
- **Pool, bukan client per query**. Pool dibuat sekali di [pool.ts](../core/db/pool.ts). Untuk transaksi multi-statement, pakai `pool.connect()` + `BEGIN/COMMIT`/`ROLLBACK` (lihat `migrate.ts`).
- **`ctx.db.save("collection", data)`** menulis ke tabel generic `events(collection, data JSONB)`. Plugin yang butuh schema sungguhan: tambah migration + collection sendiri, jangan tumpuk semua di `events`.
- **Async semua**. Interface `DbCollection<T>` sudah `Promise<T>` di semua method — pertahankan.
- **Build copy**: file `.sql` di `core/db/migrations/` di-copy ke `dist/core/db/migrations/` oleh [scripts/copy-manifests.mjs](../scripts/copy-manifests.mjs). Kalau pindah lokasi, update script-nya juga.

### Verifikasi
- `psql $DATABASE_URL -c '\dt'` menampilkan tabel `users`, `history`, `events`, `_migrations` setelah boot pertama.
- Kirim 1 pesan ke bot → row baru di `users` (auto-register via middleware/auth) + `history` (via plugin yang `history.append`).
- Restart bot → data persistent.

---

## 11. Logger / observability

### File
- [core/logger.ts](../core/logger.ts)
- [core/types.ts](../core/types.ts) — interface `Logger`

### Kapan
- Pindah ke logger lain (winston, log4js)
- Tambah destination (file, datadog, sentry)
- Structured logging untuk production

### Yang perlu diperhatikan
- **Interface `Logger`** di `types.ts` (`trace/debug/info/warn/error`) dipakai semua plugin via `ctx.log`. Pertahankan signature ini — pino-style `log.info(obj, "msg")` sudah cocok.
- **Log level via env** sudah ada (`LOG_LEVEL`). Pertahankan supaya bisa di-tune tanpa rebuild.
- **PII**: `msg.text` mungkin sensitif. Default log middleware truncate ke 80 char. Kalau ganti, jaga praktek ini.
- **Production**: matikan `pino-pretty` (CPU mahal) — pakai raw JSON ke stdout, biar collector di luar yang parse.

---

## 12. `core/index.ts` — boot order

Saat ini:

1. Load `.env` (otomatis via `import "dotenv/config"` di `config.ts`).
2. `migrate()` — apply pending SQL migrations core. DB harus siap sebelum apa pun yang menyentuh helpers.
3. `loadPlugins()` — discover & import semua plugin.
4. `migratePlugins()` — apply migrations milik plugin (schema per plugin). Plugin yang gagal di-exclude dari routing.
5. `buildKeywordIndex(plugins)` — index fuzzy keyword global untuk router.
6. Untuk tiap platform yang `enabled`, `startXxx({ plugins, keywordIndex })`.
7. `Promise.all(tasks)` — bot stay alive selama platform connected.

### Kalau menambah boot step
- **Sebelum `loadPlugins`**: setup yang plugin tidak boleh sentuh (DB migration, schema validation).
- **Setelah platforms start**: schedule cron/timer global. Pastikan idempotent kalau ada hot-reload.
- **Graceful shutdown**: pertimbangkan tangkap `SIGINT`/`SIGTERM` → tutup koneksi, flush log. Saat ini belum ada — kalau Anda tambah, taruh di sini.

### Yang perlu diperhatikan
- Boot crash di sini = bot mati total. Wrap step yang bisa fail dengan log jelas.
- **Async sequencing**: kalau platform baru butuh resource yang di-init lebih dulu (cache, koneksi DB), `await` dulu di sini sebelum `startXxx()`.

---

## 13. Checklist generic untuk PR yang menyentuh `core/`

- [ ] Plugin existing **tidak perlu** diubah, atau perubahan didokumentasikan + dieksekusi.
- [ ] `types.ts` field/method baru = opsional (`?` atau default).
- [ ] `npm run typecheck` lulus.
- [ ] `npm run build` lulus (termasuk copy-manifests).
- [ ] Smoke test: boot bot, kirim 1 pesan trigger plugin specific, 1 pesan fallback, cek tidak regresi.
- [ ] Update docs yang relevan:
  - Tambah field `Msg` → update [docs/PLUGINS.md §3](PLUGINS.id.md)
  - Tambah helper → update [docs/PLUGINS.md §4](PLUGINS.id.md)
  - Tambah lifecycle → update [docs/PLUGINS.md §2](PLUGINS.id.md)
  - Tambah SDK utility → update [docs/PLUGINS.md §5](PLUGINS.id.md)
  - Tambah platform → update [README.md](../README.id.md) bagian setup
- [ ] Tidak ada secrets di-commit.
- [ ] Log level + message di code baru sesuai (debug untuk dev info, info untuk lifecycle, warn untuk recoverable, error untuk failure).

---

## 14. Anti-pattern di core

| Anti-pattern | Kenapa salah | Alternative |
|---|---|---|
| Hard-code platform di router (`if msg.platform === "whatsapp"`) | Bikin router tahu platform, kontrak abstraction bocor | Adapter yang normalisasi; router platform-agnostic |
| Plugin import langsung dari `core/db/index.ts` | Tightly coupled ke implementasi DB | Pakai `ctx.helpers.*` atau `ctx.db` |
| Helper di-instantiate ulang per request | Boros, lose internal state | Helper export const tunggal, stateless |
| `Date.now()` / `Math.random()` tersebar di helper | Tidak deterministik untuk test | Inject clock/rng, atau dokumentasikan |
| Auto-reload plugin dengan `require.cache` clear | Risk leak listener/timer dari load lama | Restart bot, atau implement proper teardown protocol |
| Mutasi `msg` di middleware (`msg.text = msg.text.toLowerCase()`) | Plugin downstream mengasumsikan `msg` immutable | Bikin field baru (mis. `msg.normalizedText`) atau pass via `ctx` |
| Global state di module top-level (selain cache) | Bocor antar test, sulit di-reason | Encapsulate di factory/class |
| `try/catch` swallow tanpa log | Bug invisible | `try/catch` + `ctx.log.error(...)` minimal |

---

## 15. Referensi cepat

| Mau apa | Buka file ini |
|---|---|
| Tambah field di `Msg` | [core/types.ts](../core/types.ts) + tiap adapter |
| Tambah middleware global | [core/middleware/](../core/middleware/) + `middleware/index.ts` |
| Tambah lifecycle event | [core/types.ts](../core/types.ts) + [core/router.ts](../core/router.ts) + adapter |
| Tambah `ctx.helpers.x` | [core/types.ts](../core/types.ts) + [core/helpers/](../core/helpers/) |
| Tambah platform | [core/platforms/](../core/platforms/) + `Platform` type + `config.ts` + `index.ts` |
| Tambah utility plugin | [core/plugin-sdk.ts](../core/plugin-sdk.ts) |
| Ubah routing logic | [core/router.ts](../core/router.ts) ⚠️ sensitive |
| Ubah cara discovery plugin | [core/loader.ts](../core/loader.ts) + [scripts/copy-manifests.mjs](../scripts/copy-manifests.mjs) |
| Tambah env var | [core/types.ts](../core/types.ts) + [core/config.ts](../core/config.ts) + [.env.example](../.env.example) |
| Swap DB | [core/db/index.ts](../core/db/index.ts) (interface di `types.ts` jangan diubah) |
| Boot order | [core/index.ts](../core/index.ts) |
