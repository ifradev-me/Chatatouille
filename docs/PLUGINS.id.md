# Membuat Plugin

> 🇬🇧 [English](PLUGINS.md) · 🇮🇩 Bahasa Indonesia

Plugin adalah unit fitur. Self-contained — semua kode, config, middleware, dan dependency-nya hidup di satu folder. Tambah, ganti, atau hapus plugin **tanpa menyentuh `core/`**.

---

## TL;DR — 3 langkah bikin plugin baru

```
plugins/plugin-namaku/
├── plugin.json     ← manifest: kapan plugin ini dipanggil
└── index.ts        ← logic-nya
```

1. Buat folder `plugins/plugin-namaku/`.
2. Isi `plugin.json` (kapan plugin dipanggil) + `index.ts` (apa yang dikerjakan).
3. Restart bot. Selesai.

```bash
npm run dev    # auto-reload saat development
# atau
npm run build && npm start
```

---

## 1. `plugin.json` — manifest

Minimum:

```json
{
  "name": "plugin-namaku",
  "enabled": true,
  "match": { "type": "keyword", "values": ["halo"] }
}
```

### Field reference

| Field | Wajib | Deskripsi |
|---|---|---|
| `name` | ✓ | Identifier unik plugin. Sebaiknya sama dengan nama folder. |
| `enabled` | ✓ | `true` aktif, `false` di-skip loader. |
| `match` | ✓ | Kapan plugin ini dipanggil. Lihat detail di bawah. |
| `platforms` | — | Whitelist platform (`["whatsapp"]`, `["whatsapp","telegram"]`). Absent → semua platform. `[]` → tidak jalan di mana pun (loader warn). |
| `middleware` | — | Array nama file (tanpa `.ts`) dari folder `middleware/` plugin. |
| `response` | — | Informatif saja (`static` / `dynamic` / `llm`). Core tidak pakai untuk routing. |

### `platforms` — batasi plugin ke platform tertentu (opsional)

```json
{ "platforms": ["whatsapp"] }                  // WA only
{ "platforms": ["whatsapp", "telegram"] }      // WA + Telegram
// field absent → semua platform (backward compatible)
```

Cek `msg.platform` di awal `matches()` — kalau platform pesan tidak ada di whitelist, plugin di-skip sebelum cek `match`. Cocok untuk plugin yang pakai API platform-specific (mis. WA group admin) atau fitur regional.

### `match.type` — kapan plugin match

| Type | Cocok jika… | Contoh values |
|---|---|---|
| `keyword` | **Fuzzy match** (dice coefficient) — token di `msg.text` mirip salah satu value. Default threshold 0.6. Override per-plugin via `match.threshold`. | `["harga", "ongkir"]` |
| `regex` | `msg.text` cocok regex (case-insensitive) | `["^order\\s+.+"]` |
| `intent` | **TODO: belum diimplementasikan** — manifest dengan tipe ini akan di-skip router. Jangan pakai. | — |
| `all` | selalu cocok. Pakai untuk **fallback** (LLM, welcome) | — |

**Urutan eksekusi router**:
1. Global middleware
2. **Conversation lock** — kalau user dalam flow aktif, dispatch ke plugin owner (lihat §4 `ctx.helpers.conversation` + pola di §9).
3. **Fuzzy keyword** (centralized) — token-wise sortMatch lintas semua plugin `type: "keyword"`. Plugin dengan score tertinggi yang lulus threshold menang.
4. `regex` + `all` loop — plugin pertama yang match menang.

```json
{
  "name": "plugin-faq",
  "enabled": true,
  "match": {
    "type": "keyword",
    "values": ["harga", "ongkir", "stok"],
    "threshold": 0.65
  }
}
```

Toleran typo: `"harga"` cocok ke `"hrga"`, `"hargaa"`, `"berapa harganya?"` — tidak perlu exact match.

> **Catatan fuzzy match**: scoring bekerja **per-token**. Untuk multi-word keyword (mis. `"selamat pagi"`), sebaiknya pakai `type: "regex"` atau pecah jadi 2 plugin/keyword. Token disusun dari split whitespace + punctuation.

Plugin yang `match`-nya hit via fuzzy akan menerima `ctx.matched = { keyword, score }` — berguna untuk logging/branching internal.

> Tips: `match: all` aman dipakai plugin yang **hanya** implement `onMedia`/`onJoin`/`onLeave` — router dispatch berdasar `msg.event`, jadi pesan teks biasa tidak akan menyentuh plugin tersebut.

---

## 2. `index.ts` — logic plugin

Plugin **wajib** `export default` sebuah object dengan minimal satu **lifecycle hook**.

### Lifecycle hooks

| Hook | Dipanggil saat… | `msg.event` |
|---|---|---|
| `handle` | pesan teks biasa | `"message"` |
| `onMedia` | pesan dengan gambar/video/file/audio | `"media"` |
| `onJoin` | user join grup | `"join"` |
| `onLeave` | user keluar grup | `"leave"` |

Plugin **tidak perlu** implement semua. Cukup yang relevan.

### Bentuk 1 — paling sederhana (cuma reply teks)

```ts
// plugins/plugin-halo/index.ts
import type { PluginDef } from "../../core/types.js";

const halo: PluginDef = {
  async handle(msg, ctx) {
    await ctx.reply(`Halo, ${msg.pushName ?? "kakak"}!`);
  },
};

export default halo;
```

### Bentuk 2 — pakai `definePlugin` SDK (validasi struktur + shortcut)

```ts
// plugins/plugin-halo/index.ts
import { definePlugin } from "../../core/plugin-sdk.js";

export default definePlugin(async (msg, ctx) => {
  await ctx.reply(`Halo, ${msg.pushName ?? "kakak"}!`);
});
```

Fungsi tunggal otomatis di-wrap jadi `{ handle: fn }`. Untuk multi-hook, pass object:

```ts
export default definePlugin({
  async handle(msg, ctx)  { /* … */ },
  async onMedia(msg, ctx) { /* … */ },
  async onJoin(msg, ctx)  { /* … */ },
});
```

---

## 3. `Msg` — apa yang diterima plugin

```ts
{
  id: string,
  platform: "whatsapp" | "telegram" | "discord",
  from: string,            // stable ID — pakai ini untuk DB/session/history
  phoneNumber?: string,    // E.164 tanpa "+", hanya WA & kalau diketahui
  lid?: string,            // "xxxxx@lid", hanya WA
  pushName?: string,       // display name di platform
  groupId: string | null,  // null kalau private chat
  isGroup: boolean,
  fromMe: boolean,         // bot tidak harus balas dirinya sendiri
  text: string,
  media: { type, url, mimeType } | null,
  event: "message" | "media" | "join" | "leave",
  timestamp: number,
  raw: unknown             // pesan asli dari platform (escape hatch)
}
```

**Rules**:
- Plugin **wajib** pakai `msg.from` untuk identitas (DB lookup, session, history). **Jangan** pakai `msg.phoneNumber` atau `msg.lid` sebagai primary key — keduanya bisa kosong atau berubah antar update WhatsApp.
- `msg.raw` adalah escape hatch — pakai hanya kalau benar-benar butuh data platform-specific yang belum dinormalisasi.
- Kalau `msg.fromMe === true`, global middleware `auth` sudah otomatis `ctx.stop()`. Jadi plugin nggak akan dipanggil — tapi tetap aman untuk double-check.

---

## 4. `Ctx` — toolbox plugin

```ts
ctx.reply(text)                    // balas teks (quoted ke pesan asli)
ctx.replyMedia(url, caption?)      // balas media (file path lokal atau URL)
ctx.platform                       // "whatsapp" | "telegram" | "discord"
ctx.config                         // process.env yang sudah di-parse
ctx.log                            // pino logger (trace/debug/info/warn/error)
ctx.db                             // raw DB client (jarang dipakai — prefer helpers)
ctx.helpers.user                   // CRUD user per-platform (findOrCreate, ban, isBanned)
ctx.helpers.history                // chat history per-platform (get, append, clear)
ctx.helpers.session                // in-memory state per user (TTL opsional)
ctx.helpers.conversation           // multi-step flow lock (lihat di bawah)
ctx.matched                        // diisi router kalau plugin di-trigger via fuzzy: { keyword, score }
ctx.stop()                         // hentikan middleware chain (untuk middleware)
ctx.stopped                        // true kalau stop() sudah dipanggil
```

### `ctx.helpers.conversation` — multi-step flow

Conversation = state-machine yang **mengunci** router ke satu plugin selama user dalam flow. Selama aktif, semua pesan dari user itu langsung di-dispatch ke plugin owner — matching biasa di-bypass. Cocok untuk wizard, order step-by-step, form pengisian, dll.

```ts
ctx.helpers.conversation.enter(
  msg.from,
  ctx.platform,
  "plugin-order",                     // nama plugin owner (biasanya diri sendiri)
  { step: "ask_qty", item: "kopi" },  // state awal
  5 * 60_000,                         // TTL WAJIB (5 menit)
  // { force: true }                  // opsional — override flow lain yang aktif (admin)
);

const active = ctx.helpers.conversation.current<{ step: string; item: string }>(msg.from, ctx.platform);
ctx.helpers.conversation.update(msg.from, ctx.platform, { ...active!.state, qty: 2 });
ctx.helpers.conversation.exit(msg.from, ctx.platform);
```

**Aturan**:
- **TTL wajib** di `enter()`. Tidak boleh infinite — kalau user lupa cancel, flow auto-expire.
- **Plugin handle cancel sendiri** — konvensi: cek `"batal"` / `"/cancel"` di `handle`, panggil `exit()`.
- **State in-memory** — hilang saat bot restart. Kalau butuh durable (mis. order yang sudah confirm), simpan ke DB via `ctx.helpers.history` / `ctx.db.save()`.
- **Tiap plugin punya flow sendiri** — flow plugin-A independen dari plugin-B. Key store: `${platform}:${from}`.
- **`update()` tidak reset TTL**. Kalau perlu perpanjang, panggil `enter()` lagi dengan `force: true` + state baru.

Contoh full: [§9 Pola — Multi-step order flow](#9-pola-umum).

### Pakai `ctx.helpers`

> **User & history lookup PER-PLATFORM.** WA `"628123"` ≠ Telegram `"628123"`.
> Selalu pass `ctx.platform` (atau `msg.platform`) sebagai argumen kedua.

```ts
// auto-register kalau belum ada
const user = await ctx.helpers.user.findOrCreate(msg.from, ctx.platform);

// cek ban
if (await ctx.helpers.user.isBanned(msg.from, ctx.platform)) return;

// simpan history (append baca platform dari msg, tidak perlu pass)
await ctx.helpers.history.append(msg, "user");
await ctx.helpers.history.append(msg, "bot", "balasan saya");

// ambil 10 pesan terakhir
const last = await ctx.helpers.history.get(msg.from, ctx.platform, { limit: 10 });

// state sementara dengan TTL 1 menit
ctx.helpers.session.set(msg.from, { step: "confirm", item: "kopi" }, 60_000);
const state = ctx.helpers.session.get<{ step: string; item: string }>(msg.from);
ctx.helpers.session.clear(msg.from);
```

> **Catatan session**: berbeda dari `user`/`history`/`conversation`, `session` di-key oleh `from` saja — **tidak** per-platform. Kalau plugin kamu jalan multi-platform dan butuh isolasi, pakai key manual: `ctx.helpers.session.set(`${ctx.platform}:${msg.from}`, ...)`. Untuk multi-step flow, prefer `conversation` (sudah per-platform).

---

## 5. SDK utilities — `core/plugin-sdk.ts`

Import yang dibutuhkan saja:

```ts
import {
  definePlugin,
  formatMessage,
  retry,
  createRateLimit,
  createHealthCheck,
  checkHealth,
} from "../../core/plugin-sdk.js";
```

| Util | Fungsi |
|---|---|
| `definePlugin(impl)` | Validasi + auto-wrap fungsi jadi `{ handle }`. |
| `createPluginDb(import.meta)` | PostgreSQL milik plugin — schema terisolasi + migrations di folder plugin. Lihat [§8](#8-plugin-dengan-tabel-postgresql-sendiri). |
| `match(a, b, threshold=0.6)` | Fuzzy boolean check (dice coefficient). Untuk branch internal plugin, mis. cek `"ya"` / `"tidak"` di conversation flow. |
| `formatMessage(tmpl, vars)` | Replace `{{ key }}` di string. |
| `retry(fn, times=3)` | Exponential backoff (200ms → 400ms → 800ms). |
| `createRateLimit(max, windowMs)` | Per-plugin limiter, return `(key) => boolean`. |
| `createHealthCheck(url, intervalMs=30s)` | Background HEAD check, return `() => boolean`. Panggil **sekali** di top-level, **bukan** tiap pesan. |
| `checkHealth(url)` | One-off HEAD check. |

### Contoh gabungan

```ts
// plugins/plugin-ai/index.ts
import { definePlugin, createHealthCheck, retry, formatMessage } from "../../core/plugin-sdk.js";

// dieksekusi sekali saat load — bukan tiap pesan masuk
const isHealthy = createHealthCheck(process.env.AI_URL!);

export default definePlugin(async (msg, ctx) => {
  if (!isHealthy()) {
    await ctx.reply("Layanan AI sedang tidak tersedia.");
    return;
  }

  const data = await retry(async () => {
    const res = await fetch(process.env.AI_URL!, {
      method: "POST",
      body: JSON.stringify({ text: msg.text }),
    });
    if (!res.ok) throw new Error(`AI ${res.status}`);
    return res.json() as Promise<{ reply: string }>;
  }, 3);

  await ctx.reply(
    formatMessage("Halo {{ name }}, kata AI: {{ reply }}", {
      name: msg.pushName ?? "kakak",
      reply: data.reply,
    }),
  );
});
```

---

## 6. Middleware lokal plugin

Berbeda dari **global middleware** (jalan untuk semua pesan), **middleware lokal** hanya jalan kalau plugin ini yang match. Cocok untuk validasi format, cek kuota khusus, dll.

### Struktur

```
plugins/plugin-order/
├── index.ts
├── plugin.json
└── middleware/
    ├── validateFormat.ts
    └── checkStock.ts
```

### Daftarkan di `plugin.json`

```json
{
  "name": "plugin-order",
  "enabled": true,
  "match": { "type": "regex", "values": ["^order\\s+.+"] },
  "middleware": ["validateFormat", "checkStock"]
}
```

Urutan di array = urutan eksekusi. Setelah semua middleware lokal lulus, hook (`handle`/`onMedia`/dll) baru dipanggil.

### Tulis middleware

```ts
// plugins/plugin-order/middleware/validateFormat.ts
import type { MiddlewareFn } from "../../../core/types.js";

const validate: MiddlewareFn = async (msg, ctx) => {
  const rest = msg.text.replace(/^order\s+/i, "").trim();
  if (!rest) {
    await ctx.reply("Format salah. Ketik: order [produk]");
    ctx.stop();   // hentikan chain — hook & middleware berikutnya skip
  }
};

export default validate;
```

**Aturan**:
- `export default` fungsi async dengan signature `(msg, ctx) => Promise<void>`.
- Panggil `ctx.stop()` kalau mau hentikan eksekusi (hook tidak akan dipanggil).
- Boleh kirim reply sebelum `stop()` — biasanya untuk pesan error.

---

## 7. Plugin dengan dependency npm

Plugin boleh punya `package.json` sendiri biar dependency-nya tidak nyampur ke root.

### Struktur

```
plugins/plugin-image/
├── index.ts
├── plugin.json
└── package.json     ← scoped dependencies
```

### `package.json` plugin

```json
{
  "name": "plugin-image",
  "private": true,
  "dependencies": {
    "sharp": "^0.33.0"
  }
}
```

### Install

```bash
cd plugins/plugin-image
npm install
```

### Import dinamis (recommended)

Pakai `await import()` di dalam hook supaya bot tetap boot meski dependency belum di-install:

```ts
import { definePlugin } from "../../core/plugin-sdk.js";

export default definePlugin({
  async onMedia(msg, ctx) {
    if (msg.media?.type !== "image") return;

    let sharp;
    try {
      sharp = (await import("sharp")).default;
    } catch {
      ctx.log.warn("[plugin-image] sharp belum di-install");
      return;
    }

    // gunakan sharp…
  },
});
```

---

## 8. Plugin dengan tabel PostgreSQL sendiri

Plugin bisa punya tabel Postgres sungguhan **tanpa menyentuh `core/db/` sama sekali** — self-contained penuh: handler + manifest + migrations hidup di folder plugin, dan semua tabelnya hidup di **schema Postgres milik plugin**.

### Kapan pakai apa

| Kebutuhan | Pakai |
|---|---|
| Simpan event/log ad-hoc tanpa schema | `ctx.db.save("collection", data)` → tabel `events` (JSONB) |
| State sementara (boleh hilang saat restart) | `ctx.helpers.session` / `ctx.helpers.conversation` |
| Tabel sungguhan: kolom typed, index, constraint | **`createPluginDb` + folder `migrations/`** (section ini) |

### Struktur

```
plugins/plugin-notes/
├── plugin.json
├── index.ts
└── migrations/
    └── 001_20260611_000000_1781136000_init.sql
```

### Cara kerja isolasi

- Saat boot — setelah migrations core — runner menjalankan `plugins/<nama>/migrations/*.sql` yang belum applied (hanya plugin `enabled: true`).
- Tiap file jalan dalam **transaksi** dengan `search_path = <schema>, public`. Schema = nama plugin dengan `-` diganti `_` (`plugin-notes` → `plugin_notes`), dibuat otomatis.
- `CREATE TABLE notes (...)` polos → jadi `plugin_notes.notes`. Tidak mungkin tabrakan nama dengan core (schema `public`) atau plugin lain.
- Tracking di tabel `_migrations` dengan namespace: `plugin-notes/001_....sql`.
- **Migration gagal → plugin di-exclude dari routing** (bot tetap boot; error jelas di log). Perbaiki SQL-nya, restart.

### Query dari handler

```ts
import { definePlugin, createPluginDb } from "../../core/plugin-sdk.js";

interface NoteRow { id: string; text: string; created_at: Date; }

// import.meta → nama plugin otomatis dari nama folder (tidak bisa typo/drift).
// Panggil SEKALI di top-level; pool dibuat lazy saat query pertama.
const db = createPluginDb(import.meta);

export default definePlugin(async (msg, ctx) => {
  // Tabel "notes" resolve ke plugin_notes.notes via search_path koneksi.
  const { rows } = await db.query<NoteRow>(
    "SELECT id, text, created_at FROM notes WHERE from_id = $1 AND platform = $2 ORDER BY created_at DESC LIMIT 5",
    [msg.from, msg.platform],
  );
  // ...
});
```

### Transaksi

```ts
await db.tx(async (q) => {
  const { rows } = await q<{ id: string }>(
    "INSERT INTO orders (from_id, item) VALUES ($1, $2) RETURNING id",
    [msg.from, item],
  );
  await q("INSERT INTO order_events (order_id, type) VALUES ($1, 'created')", [rows[0].id]);
});
// throw di dalam callback → ROLLBACK otomatis.
```

### Aturan

- **Format filename migration sama dengan core**: `[urutan]_[YYYYMMDD]_[HHMMSS]_[epoch_s]_[deskripsi].sql`. Filename = key di `_migrations` — **tidak boleh di-rename** setelah applied.
- **Jangan tulis schema qualifier** (`public.x`, `plugin_lain.x`) di migration — biarkan `search_path` yang bekerja.
- **Jangan query schema plugin lain** — itu memecah self-containment. Butuh sharing data antar plugin? Itu sinyal datanya milik core: usulkan helper di `core/helpers/` (lihat [CORE.md §4](CORE.id.md)).
- Baca tabel core (`public.users`, `public.history`) **boleh tapi hindari** — prefer `ctx.helpers.*`; query langsung = coupling ke schema internal core yang bisa berubah.
- **Selalu parameterized query** (`$1, $2`) — jangan pernah interpolasi input user ke string SQL.
- `createPluginDb()` di **top-level module**, bukan di dalam hook (sama seperti `createHealthCheck`).

### Uninstall bersih

Semua jejak plugin hidup di folder + satu schema — menghapus plugin tidak meninggalkan sampah:

```sql
DROP SCHEMA plugin_notes CASCADE;
DELETE FROM _migrations WHERE filename LIKE 'plugin-notes/%';
```

lalu hapus folder `plugins/plugin-notes/`.

Contoh hidup end-to-end: [plugins/plugin-notes/](../plugins/plugin-notes/).

---

## 9. Pola umum

### Multi-step flow (pakai conversation)

Satu plugin yang handle seluruh flow. Saat user dalam flow, router lock ke plugin ini — semua pesan masuk lewat `handle` selama flow aktif.

```ts
// plugins/plugin-order
import { definePlugin, match } from "../../core/plugin-sdk.js";

type OrderState =
  | { step: "ask_qty"; item: string }
  | { step: "confirm"; item: string; qty: number };

export default definePlugin(async (msg, ctx) => {
  const active = ctx.helpers.conversation.current<OrderState>(msg.from, ctx.platform);

  // Plugin convention: dukung cancel di mana pun.
  if (match(msg.text, "batal") || msg.text === "/cancel") {
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
    await ctx.reply("Order dibatalkan.");
    return;
  }

  // Entry point (belum dalam flow) — trigger via fuzzy keyword "order".
  if (!active) {
    const item = msg.text.replace(/^order\s+/i, "").trim() || "(tanpa nama)";
    ctx.helpers.conversation.enter(
      msg.from,
      ctx.platform,
      "plugin-order",
      { step: "ask_qty", item } satisfies OrderState,
      5 * 60_000,
    );
    await ctx.reply(`Mau pesan "${item}". Berapa qty?`);
    return;
  }

  // Step: ask_qty
  if (active.state.step === "ask_qty") {
    const qty = parseInt(msg.text, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      await ctx.reply("Qty harus angka > 0. Coba lagi.");
      return;
    }
    ctx.helpers.conversation.update(
      msg.from,
      ctx.platform,
      { step: "confirm", item: active.state.item, qty } satisfies OrderState,
    );
    await ctx.reply(`Konfirmasi ${qty}x ${active.state.item}? (ya / tidak)`);
    return;
  }

  // Step: confirm
  if (active.state.step === "confirm") {
    if (match(msg.text, "ya")) {
      await ctx.db.save("orders", { item: active.state.item, qty: active.state.qty, from: msg.from });
      await ctx.reply(`Order ${active.state.qty}x ${active.state.item} dibuat!`);
    } else {
      await ctx.reply("Order dibatalkan.");
    }
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
  }
});
```

### Welcome message di grup

```ts
// plugins/plugin-welcome
// match: all aman karena hanya implement onJoin/onLeave
export default definePlugin({
  async onJoin(msg, ctx) {
    if (!msg.isGroup) return;
    await ctx.reply(`Selamat datang, ${msg.pushName ?? msg.from}!`);
  },
});
```

### Forward ke LLM eksternal (n8n / OpenAI / Anthropic)

```ts
// plugins/plugin-ai — fallback (match: all) — taruh terakhir di plugins/
const isHealthy = createHealthCheck(process.env.N8N_WEBHOOK_URL!);

export default definePlugin(async (msg, ctx) => {
  if (!isHealthy()) return ctx.reply("AI offline.");

  const [user, history] = await Promise.all([
    ctx.helpers.user.findOrCreate(msg.from, ctx.platform),
    ctx.helpers.history.get(msg.from, ctx.platform, { limit: 10 }),
  ]);

  const data = await retry(async () => {
    const res = await fetch(process.env.N8N_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg.text,
        from: msg.from,
        user: { name: user.name, phoneNumber: user.phoneNumber },
        history: history.map(h => ({ role: h.role, text: h.text })),
      }),
    });
    return res.json() as Promise<{ reply: string }>;
  }, 3);

  await ctx.helpers.history.append(msg, "user");
  await ctx.helpers.history.append(msg, "bot", data.reply);
  await ctx.reply(data.reply);
});
```

---

## 10. Catatan WhatsApp (Baileys v7 / LID)

Saat berjalan di WhatsApp, `msg.from` mengikuti aturan ini:

- **Prefer LID** (Linked Identity) — lebih konsisten lintas-grup dan tahan ganti nomor.
- Fallback ke PN (phone number) kalau LID belum diketahui.
- Selalu **strip domain** — plugin terima `"6281234567890"` atau `"123456789"` (LID), bukan `"...@s.whatsapp.net"` atau `"...@lid"`.

Field tambahan yang bisa dipakai kalau perlu:

- `msg.phoneNumber` — nomor HP E.164 tanpa `+` (kalau diketahui).
- `msg.lid` — LID full `"xxxxx@lid"` (kalau diketahui).
- `msg.addressingMode` — `"lid"` atau `"pn"` (mode addressing chat ini).
- `msg.remoteJid` — raw remoteJid (untuk advanced use case).

Plugin yang **portable lintas-platform** sebaiknya **hanya** pakai `msg.from`, `msg.pushName`, `msg.text`, `msg.media`.

---

## 11. Yang TIDAK boleh / hindari

- ❌ **Jangan** import file dari plugin lain (`plugins/plugin-x/...`). Plugin harus self-contained. Kalau perlu sharing logic, taruh di `core/helpers/` atau jadikan SDK utility.
- ❌ **Jangan** sentuh `core/router.ts` atau `core/loader.ts` untuk fitur plugin biasa. Routing sudah handle semua case via `match` + lifecycle hooks.
- ❌ **Jangan** pakai global state di module top-level kecuali untuk cache yang memang per-process (rate limiter, health check). Hindari menyimpan data user di sana — pakai `ctx.helpers.session` atau DB.
- ❌ **Jangan** panggil `createHealthCheck()` di dalam hook — itu bikin interval baru tiap pesan. Panggil sekali di module top-level.
- ❌ **Jangan** lupa `await` di tiap `ctx.reply()` / `ctx.helpers.*`. Semuanya async.
- ❌ **Jangan** pakai `msg.phoneNumber` sebagai primary key — di WA, user yang sama bisa muncul dengan PN kosong (LID-only addressing). `msg.from` selalu ada.
- ❌ **Jangan** query schema plugin lain (`SELECT ... FROM plugin_lain.tabel`) atau tambah migration ke `core/db/migrations/` untuk kebutuhan plugin — tabel plugin hidup di schema sendiri via [§8](#8-plugin-dengan-tabel-postgresql-sendiri).

---

## 12. Checklist sebelum commit plugin baru

- [ ] Folder `plugins/plugin-nama/` dengan `plugin.json` + `index.ts`.
- [ ] `plugin.json` punya `name`, `enabled: true`, `match`.
- [ ] `index.ts` `export default` object dengan minimal satu lifecycle hook.
- [ ] Reply pertama paling lambat ~2 detik (kalau lebih, kirim "tunggu sebentar…" dulu).
- [ ] Error di-`try/catch` — minimal log via `ctx.log.error(...)`, jangan biarkan plugin crash diam-diam.
- [ ] Kalau ada I/O eksternal (fetch/DB), pakai `retry()` + timeout.
- [ ] Kalau ada dependency npm: `package.json` lokal + `npm install` di folder plugin.
- [ ] Kalau punya tabel sendiri: migration di `migrations/` (format filename benar), query semua parameterized, tidak ada schema qualifier di SQL.
- [ ] Test manual: kirim pesan trigger, cek bot balas sesuai harapan.
- [ ] `npm run typecheck` lulus.

---

## 13. Troubleshooting

| Gejala | Kemungkinan penyebab |
|---|---|
| Plugin tidak pernah dipanggil | `enabled: false`, `match` salah, atau ada plugin specific lain yang match duluan. |
| Warn `middleware tidak ditemukan` saat boot / error saat plugin match | Nama di `plugin.json` → `middleware` tidak match nama file di `middleware/`. Tanpa `.ts`. |
| Pesan grup tidak masuk | Cek `msg.isGroup` & pastikan plugin tidak filter `groupId === null`. |
| Plugin LLM (fallback) ikut match pesan yang harusnya ditangkap plugin specific | Pastikan plugin specific punya hook yang sesuai event-nya — kalau hook tidak ada, router lanjut cari plugin berikutnya. |
| `ctx.replyMedia` gagal | File path lokal harus absolut atau relatif ke CWD bot. URL harus reachable dari server bot. |
| Sesi hilang antar pesan | Session in-memory — hilang kalau bot restart. Untuk durable state, simpan di DB via `ctx.db`. |
| Plugin tidak jalan + log `migration failed` | SQL di `migrations/` error — plugin di-exclude dari routing saat boot. Perbaiki file-nya (jangan rename yang sudah applied), restart. |
| `relation "x" does not exist` saat query plugin | Migration belum jalan (plugin baru di-enable? restart bot) atau query pakai schema qualifier yang salah — tulis nama tabel polos. |

---

## 14. Referensi cepat

- Architecture & file layout: [CORE.md](CORE.id.md) §0
- Type definitions: [core/types.ts](../core/types.ts)
- SDK source: [core/plugin-sdk.ts](../core/plugin-sdk.ts)
- Router: [core/router.ts](../core/router.ts)
- Global middleware: [core/middleware/](../core/middleware/)
- Contoh plugins: [plugins/](../plugins/)
