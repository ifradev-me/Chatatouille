<div align="center">

# 🤖 bot-test

**Bot modular multi-platform — WhatsApp × Telegram, ditenagai TypeScript**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Baileys](https://img.shields.io/badge/Baileys-v7%20LID--aware-25D366?style=flat-square&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![grammy](https://img.shields.io/badge/grammy-Telegram-2CA5E0?style=flat-square&logo=telegram&logoColor=white)](https://grammy.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

*Tambah fitur cukup dengan menaruh folder ke `plugins/` — tanpa ubah core sama sekali.*

🇬🇧 [English](README.md) · 🇮🇩 Bahasa Indonesia

</div>

---

## ✨ Fitur

| | Fitur | Deskripsi |
|---|---|---|
| 🧩 | **Sistem plugin** | Setiap fitur adalah folder mandiri: manifest, handler, middleware, npm deps, dan migrasi DB semuanya dalam satu tempat |
| 🔍 | **Fuzzy keyword routing** | Pencocokan toleran typo (dice coefficient) dengan threshold per-plugin, plus regex dan fallback matching |
| 💬 | **Alur percakapan multi-langkah** | Router lock menjaga user tetap di dalam wizard satu plugin (order, form) dengan TTL wajib |
| 🗄️ | **PostgreSQL milik plugin** | Setiap plugin punya schema Postgres sendiri — nol tabrakan nama, uninstall cukup satu baris `DROP SCHEMA` |
| 🪪 | **Identitas per-platform** | User dipisahkan per platform; penanganan LID/PN WhatsApp sudah diurus otomatis |
| 🛡️ | **Middleware global** | Logging, rate limiting, auto-registrasi + cek ban, pesan sambutan kontak pertama |
| 🤖 | **Claude skill** | Scaffolding plugin baru dari ujung ke ujung: wawancara → persetujuan rencana → generate → test → tarball |

---

## 🚀 Mulai Cepat

### 1️⃣ PostgreSQL

> Kamu butuh database kosong + user dengan izin `CREATE`.

```bash
# via Docker (paling gampang)
docker run -d --name bot-pg \
  -e POSTGRES_USER=bot \
  -e POSTGRES_PASSWORD=bot \
  -e POSTGRES_DB=bot \
  -p 5432:5432 postgres:16
```

<details>
<summary>Pakai instalasi Postgres yang sudah ada?</summary>

```bash
createdb bot
createuser bot --pwprompt
psql -c "GRANT ALL PRIVILEGES ON DATABASE bot TO bot;"
psql -U postgres -d bot -c "GRANT ALL ON SCHEMA public TO bot;"
```

</details>

### 2️⃣ Install & konfigurasi

```bash
npm install
cp .env.example .env
# edit .env — minimal set DATABASE_URL
```

`.env` minimal:

```env
DATABASE_URL=postgres://bot:bot@localhost:5432/bot
ENABLE_WHATSAPP=true
```

### 3️⃣ Build & jalankan

```bash
npm run build && npm start

# atau mode dev (auto-reload):
npm run dev
```

> Migrasi di `core/db/migrations/*.sql` dan folder `migrations/` tiap plugin berjalan **otomatis** saat boot. Untuk menambah migrasi, buat file bernama `[seq]_[YYYYMMDD]_[HHMMSS]_[epoch_s]_[deskripsi].sql` lalu restart.

### 4️⃣ Hubungkan WhatsApp

- **Default:** scan QR code yang muncul di terminal
- **Pairing code:** set `WA_USE_PAIRING_CODE=true` & `WA_PHONE_NUMBER=628xxxx`, lalu restart

### 5️⃣ (Opsional) Telegram

1. Chat ke **@BotFather** → `/newbot` → ikuti langkahnya → ambil **token**
2. Tambahkan ke `.env`:
   ```env
   TELEGRAM_TOKEN=123456:ABCxxx...
   ENABLE_TELEGRAM=true
   ```
3. Restart — berjalan dalam mode **long polling**, tidak butuh URL publik

> **Tips:** Agar bot bisa baca pesan grup tanpa `/perintah`: BotFather → `/setprivacy` → **Disable**  
> Untuk respons otomatis masuk/keluar grup: BotFather → `/setjoingroups` → **Enable**

---

## 🧩 Arsitektur plugin

Plugin sepenuhnya mandiri — termasuk tabel database-nya sendiri:

```
plugins/plugin-notes/
├── plugin.json                  ← kapan plugin aktif
├── index.ts                     ← logika (createPluginDb(import.meta))
└── migrations/
    └── 001_..._init.sql         ← tabel, otomatis diterapkan saat boot, schema terisolasi
```

Setiap plugin mendapat schema Postgres sendiri (`plugin-notes` → `plugin_notes`).  
Tidak ada tabrakan nama dengan core maupun plugin lain, dan uninstall cukup satu baris:

```sql
DROP SCHEMA plugin_notes CASCADE;
```

Detail lengkap: [docs/PLUGINS.md §8](docs/PLUGINS.md)

---

## 📖 Dokumentasi

| Dokumen | Isinya |
|---|---|
| [docs/PLUGINS.md](docs/PLUGINS.md) | Membuat plugin: manifest, lifecycle, alur percakapan, fuzzy matching, database per-plugin |
| [docs/CORE.md](docs/CORE.md) | Modifikasi core: router, loader, helpers, DB, menambah platform |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Status fitur + catatan implementasi |
| [docs/CLAUDE_PROMPT.md](docs/CLAUDE_PROMPT.md) | Generate plugin dengan Claude; skill yang bisa diupload ada di [`claude-skill/`](claude-skill/) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Cara berkontribusi |

---

## 🛠️ Skrip berguna

```bash
npm run typecheck           # cek TypeScript, tanpa emit
npm run build               # tsc + salin manifests/migrations ke dist
npm run dev                 # tsx watch (auto-reload)
npm run sim:conversation    # smoke test conversation helper (build dulu)
```

---

## 📡 Baileys v7 & LID

WhatsApp kini menggunakan **LID** (Linked Identity) bersamaan dengan nomor telepon. Perubahan utama:

- `Contact.id` adalah identifier utama — bisa berupa LID atau PN
- `isJidUser` sudah deprecated → gunakan `isPnUser` / `isLidUser`
- Mapping LID/PN lewat `sock.signalRepository.lidMapping` (`getLIDForPN`, `getPNForLID`)
- Auth state harus mendukung `lid-mapping`, `device-list`, `tctoken` → ditangani otomatis oleh `useMultiFileAuthState`
- ESM-only sejak v6.8.0

Lihat [`core/platforms/whatsapp.ts`](core/platforms/whatsapp.ts) untuk implementasi lengkapnya.

---

## 📄 Lisensi

[MIT](LICENSE) — dibuat dengan ☕ dan banyak begadang.