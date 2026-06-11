<div align="center">

# 🤖 bot-test

**Multi-platform modular bot — WhatsApp × Telegram, powered by TypeScript**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Baileys](https://img.shields.io/badge/Baileys-v7%20LID--aware-25D366?style=flat-square&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![grammy](https://img.shields.io/badge/grammy-Telegram-2CA5E0?style=flat-square&logo=telegram&logoColor=white)](https://grammy.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

*Add features by dropping a folder into `plugins/` — zero core changes required.*

🇬🇧 English · 🇮🇩 [Bahasa Indonesia](README.id.md)

</div>

---

## ✨ Features

| | Feature | What it does |
|---|---|---|
| 🧩 | **Plugin system** | Each feature is a self-contained folder: manifest, handler, middleware, npm deps, and DB migrations all live together |
| 🔍 | **Fuzzy keyword routing** | Typo-tolerant matching (dice coefficient) with per-plugin thresholds, plus regex and fallback matching |
| 💬 | **Multi-step conversation flows** | Router lock keeps a user inside one plugin's wizard (orders, forms) with mandatory TTLs |
| 🗄️ | **Plugin-owned PostgreSQL** | Every plugin gets its own Postgres schema — no name collisions, uninstalls are a one-line `DROP SCHEMA` |
| 🪪 | **Per-platform identity** | Users are namespaced per platform; WhatsApp LID/PN handling is done for you |
| 🛡️ | **Global middleware** | Logging, rate limiting, auto-registration + ban check, first-contact welcome |
| 🤖 | **Claude skill** | Scaffolds new plugins end-to-end: interview → plan approval → generate → test → tarball |

---

## 🚀 Quick Start

### 1️⃣ PostgreSQL

> You need an empty database + a user with `CREATE` permission.

```bash
# via Docker (easiest)
docker run -d --name bot-pg \
  -e POSTGRES_USER=bot \
  -e POSTGRES_PASSWORD=bot \
  -e POSTGRES_DB=bot \
  -p 5432:5432 postgres:16
```

<details>
<summary>Using an existing Postgres install instead?</summary>

```bash
createdb bot
createuser bot --pwprompt
psql -c "GRANT ALL PRIVILEGES ON DATABASE bot TO bot;"
psql -U postgres -d bot -c "GRANT ALL ON SCHEMA public TO bot;"
```

</details>

### 2️⃣ Install & configure

```bash
npm install
cp .env.example .env
# edit .env — at minimum set DATABASE_URL
```

Minimal `.env`:

```env
DATABASE_URL=postgres://bot:bot@localhost:5432/bot
ENABLE_WHATSAPP=true
```

### 3️⃣ Build & start

```bash
npm run build && npm start

# or dev mode (auto-reload):
npm run dev
```

> Migrations in `core/db/migrations/*.sql` and each plugin's `migrations/` run **automatically** at boot. To add a migration, create a file named `[seq]_[YYYYMMDD]_[HHMMSS]_[epoch_s]_[description].sql` and restart.

### 4️⃣ Connect WhatsApp

- **Default:** scan the QR code printed in the terminal
- **Pairing code:** set `WA_USE_PAIRING_CODE=true` & `WA_PHONE_NUMBER=628xxxx`, then restart

### 5️⃣ (Optional) Telegram

1. Chat with **@BotFather** → `/newbot` → grab your **token**
2. Add to `.env`:
   ```env
   TELEGRAM_TOKEN=123456:ABCxxx...
   ENABLE_TELEGRAM=true
   ```
3. Restart — runs in **long polling** mode, no public URL needed

> **Tips:** To read group messages without `/commands`: BotFather → `/setprivacy` → **Disable**  
> For join/leave auto-responses: BotFather → `/setjoingroups` → **Enable**

---

## 🧩 Plugin architecture

Plugins are fully self-contained — including their own database tables:

```
plugins/plugin-notes/
├── plugin.json                  ← when the plugin fires
├── index.ts                     ← logic (createPluginDb(import.meta))
└── migrations/
    └── 001_..._init.sql         ← tables, auto-applied at boot, isolated schema
```

Each plugin gets its own Postgres schema (`plugin-notes` → `plugin_notes`).  
No name collisions with core or other plugins, and uninstalling is one line:

```sql
DROP SCHEMA plugin_notes CASCADE;
```

Full details: [docs/PLUGINS.md §8](docs/PLUGINS.md)

---

## 📖 Documentation

| Document | What it covers |
|---|---|
| [docs/PLUGINS.md](docs/PLUGINS.md) | Building plugins: manifest, lifecycle, conversation flows, fuzzy matching, per-plugin database |
| [docs/CORE.md](docs/CORE.md) | Modifying core: router, loader, helpers, DB, adding platforms |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Feature status + implementation notes |
| [docs/CLAUDE_PROMPT.md](docs/CLAUDE_PROMPT.md) | Generating plugins with Claude; uploadable skill in [`claude-skill/`](claude-skill/) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |

---

## 🛠️ Useful scripts

```bash
npm run typecheck           # TypeScript check, no emit
npm run build               # tsc + copy manifests/migrations to dist
npm run dev                 # tsx watch (auto-reload)
npm run sim:conversation    # smoke test for the conversation helper (build first)
```

---

## 📡 Baileys v7 & LID

WhatsApp now uses **LID** (Linked Identity) alongside phone numbers. Key changes:

- `Contact.id` is the primary identifier — can be a LID or a PN
- `isJidUser` is deprecated → use `isPnUser` / `isLidUser`
- LID/PN mappings via `sock.signalRepository.lidMapping` (`getLIDForPN`, `getPNForLID`)
- Auth state must support `lid-mapping`, `device-list`, `tctoken` → handled automatically by `useMultiFileAuthState`
- ESM-only since v6.8.0

See [`core/platforms/whatsapp.ts`](core/platforms/whatsapp.ts) for the full implementation.

---

## 📄 License

[MIT](LICENSE) — made with ☕ and too many late nights.