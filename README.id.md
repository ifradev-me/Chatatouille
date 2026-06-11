# bot-test — Bot Modular Multi-Platform

> 🇬🇧 [English](README.md) · 🇮🇩 Bahasa Indonesia

Bot modular berbasis plugin untuk **WhatsApp** (Baileys v7, LID-aware) dan **Telegram** (grammy), ditulis dengan TypeScript. Storage: **PostgreSQL** via `pg` + raw SQL migrations. Tambah fitur cukup dengan drop folder ke `plugins/` — tanpa mengubah core.

## Fitur

- **Plugin system** — tiap fitur adalah folder self-contained: manifest, handler, middleware, dependency npm, dan migration database hidup bersama. Tambah/hapus plugin tanpa menyentuh `core/`.
- **Fuzzy keyword routing** — matching toleran typo (dice coefficient) dengan threshold per plugin, plus regex dan fallback.
- **Conversation flow multi-step** — router lock menjaga user di dalam wizard satu plugin (order, form) dengan TTL wajib.
- **PostgreSQL milik plugin** — tiap plugin dapat schema Postgres + folder migration sendiri; tabrakan nama mustahil, uninstall bersih.
- **Identitas per platform** — user di-namespace per platform; penanganan LID/PN WhatsApp sudah diurus.
- **Global middleware** — logging, rate limit, auto-register + cek ban, welcome first-contact.
- **Claude skill** — [claude-skill/](claude-skill/) berisi skill claude.ai yang scaffold plugin baru end-to-end (interview → approval plan → generate → test → tarball).

## Quick Start

### 1. PostgreSQL

Butuh database kosong + user dengan permission `CREATE`. Satu baris via Docker:

```bash
docker run -d --name bot-pg -e POSTGRES_USER=bot -e POSTGRES_PASSWORD=bot -e POSTGRES_DB=bot -p 5432:5432 postgres:16
```

Atau pakai Postgres yang sudah ter-install:

```bash
createdb bot
createuser bot --pwprompt
psql -c "GRANT ALL PRIVILEGES ON DATABASE bot TO bot;"
psql -U postgres -d bot -c "GRANT ALL ON SCHEMA public TO bot;"
```

### 2. Install + konfigurasi

```bash
npm install
cp .env.example .env
# edit .env — minimal isi DATABASE_URL
```

`.env` minimal:

```
DATABASE_URL=postgres://bot:bot@localhost:5432/bot
ENABLE_WHATSAPP=true
```

### 3. Build & start

```bash
npm run build
npm start
# atau dev mode (auto-reload):
npm run dev
```

Migrations di `core/db/migrations/*.sql` (dan `migrations/` tiap plugin) auto-jalan saat boot (lihat tabel `_migrations`). Tambah migration baru = tambah file dengan format `[urutan]_[YYYYMMDD]_[HHMMSS]_[epoch_s]_[deskripsi].sql`, restart bot.

### 4. Login WhatsApp

- Default: scan QR yang muncul di terminal.
- Pairing code: set `WA_USE_PAIRING_CODE=true` & `WA_PHONE_NUMBER=628xxxx`, jalankan ulang.

### 5. (Opsional) Telegram

1. Chat **@BotFather** di Telegram → `/newbot` → ikuti instruksi → dapat **token**.
2. `.env`:
   ```
   TELEGRAM_TOKEN=123456:ABCxxx...
   ENABLE_TELEGRAM=true
   ```
3. Restart bot. Mode default: **long polling** (tidak butuh URL publik).

Supaya bot bisa baca pesan grup tanpa command (`/x`): di @BotFather → `/setprivacy` → **Disable**. Untuk auto-respon join/leave grup: `/setjoingroups` → **Enable**.

## Plugin punya database sendiri

Plugin self-contained penuh — termasuk tabel PostgreSQL-nya:

```
plugins/plugin-notes/
├── plugin.json                 ← kapan plugin dipanggil
├── index.ts                    ← logic (createPluginDb(import.meta))
└── migrations/001_..._init.sql ← tabel, auto-apply saat boot, di schema terisolasi
```

Tiap plugin dapat schema Postgres sendiri (`plugin-notes` → `plugin_notes`) — tidak mungkin tabrakan nama dengan core atau plugin lain, dan uninstall = `DROP SCHEMA` satu baris. Detail: [docs/PLUGINS.id.md §8](docs/PLUGINS.id.md).

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [docs/PLUGINS.id.md](docs/PLUGINS.id.md) | Cara bikin plugin: manifest, lifecycle, conversation flow, fuzzy match, database per plugin. |
| [docs/CORE.id.md](docs/CORE.id.md) | Cara modifikasi core: router, loader, helpers, DB, platform baru. |
| [docs/ROADMAP.id.md](docs/ROADMAP.id.md) | Status fitur + catatan implementasi. |
| [docs/CLAUDE_PROMPT.id.md](docs/CLAUDE_PROMPT.id.md) | Generate plugin pakai Claude; skill siap-upload di [claude-skill/](claude-skill/). |
| [CONTRIBUTING.id.md](CONTRIBUTING.id.md) | Panduan kontribusi. |

## Scripts berguna

```bash
npm run typecheck          # cek TypeScript tanpa emit
npm run build              # tsc + copy manifest/migration ke dist
npm run dev                # tsx watch (auto-reload)
npm run sim:conversation   # smoke test conversation helper (build dulu)
```

## Catatan Baileys v7 (LID)

- WhatsApp sekarang pakai **LID** (Linked Identity) selain nomor HP/PN.
- `Contact.id` adalah identifier utama; bisa LID atau PN.
- Field tambahan: `phoneNumber` (jika id LID) dan `lid` (jika id PN).
- `isJidUser` deprecated → pakai `isPnUser` / `isLidUser`.
- LID/PN mapping diakses via `sock.signalRepository.lidMapping` (`getLIDForPN`, `getPNForLID`).
- Auth state harus support key baru: `lid-mapping`, `device-list`, `tctoken` → sudah otomatis di `useMultiFileAuthState`.
- ESM-only sejak v6.8.0.

Lihat `core/platforms/whatsapp.ts` untuk detail penanganan LID.

## Lisensi

[MIT](LICENSE)
