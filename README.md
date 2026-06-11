# bot-test — Multi-Platform Modular Bot

> 🇬🇧 English · 🇮🇩 [Bahasa Indonesia](README.id.md)

A modular, plugin-driven bot for **WhatsApp** (Baileys v7, LID-aware) and **Telegram** (grammy), written in TypeScript. Storage: **PostgreSQL** via `pg` + raw SQL migrations. Add features by dropping a folder into `plugins/` — no core changes required.

## Features

- **Plugin system** — each feature is a self-contained folder: manifest, handler, middleware, npm deps, and database migrations all live together. Add/remove plugins without touching `core/`.
- **Fuzzy keyword routing** — typo-tolerant matching (dice coefficient) with per-plugin thresholds, plus regex and fallback matching.
- **Multi-step conversation flows** — a router lock keeps a user inside one plugin's wizard (orders, forms) with mandatory TTLs.
- **Plugin-owned PostgreSQL** — every plugin gets its own Postgres schema and migration folder; name collisions are impossible and uninstalls are clean.
- **Per-platform identity** — users are namespaced per platform; WhatsApp LID/PN handling is done for you.
- **Global middleware** — logging, rate limiting, auto-registration + ban check, first-contact welcome.
- **Claude skill** — [claude-skill/](claude-skill/) ships a claude.ai skill that scaffolds new plugins end-to-end (interview → plan approval → generate → test → tarball).

## Quick start

### 1. PostgreSQL

You need an empty database + a user with `CREATE` permission. One-liner via Docker:

```bash
docker run -d --name bot-pg -e POSTGRES_USER=bot -e POSTGRES_PASSWORD=bot -e POSTGRES_DB=bot -p 5432:5432 postgres:16
```

Or with an existing Postgres install:

```bash
createdb bot
createuser bot --pwprompt
psql -c "GRANT ALL PRIVILEGES ON DATABASE bot TO bot;"
psql -U postgres -d bot -c "GRANT ALL ON SCHEMA public TO bot;"
```

### 2. Install + configure

```bash
npm install
cp .env.example .env
# edit .env — at minimum set DATABASE_URL
```

Minimal `.env`:

```
DATABASE_URL=postgres://bot:bot@localhost:5432/bot
ENABLE_WHATSAPP=true
```

### 3. Build & start

```bash
npm run build
npm start
# or dev mode (auto-reload):
npm run dev
```

Migrations in `core/db/migrations/*.sql` (and each plugin's `migrations/`) run automatically at boot (see the `_migrations` table). To add a migration, create a file named `[seq]_[YYYYMMDD]_[HHMMSS]_[epoch_s]_[description].sql` and restart the bot.

### 4. WhatsApp login

- Default: scan the QR code printed in the terminal.
- Pairing code: set `WA_USE_PAIRING_CODE=true` & `WA_PHONE_NUMBER=628xxxx`, restart.

### 5. (Optional) Telegram

1. Chat with **@BotFather** on Telegram → `/newbot` → follow the steps → get a **token**.
2. `.env`:
   ```
   TELEGRAM_TOKEN=123456:ABCxxx...
   ENABLE_TELEGRAM=true
   ```
3. Restart the bot. Default mode: **long polling** (no public URL needed).

For the bot to read group messages without a command (`/x`): in @BotFather → `/setprivacy` → **Disable**. For join/leave auto-responses: `/setjoingroups` → **Enable**.

## Plugins own their database

Plugins are fully self-contained — including their PostgreSQL tables:

```
plugins/plugin-notes/
├── plugin.json                 ← when the plugin fires
├── index.ts                    ← logic (createPluginDb(import.meta))
└── migrations/001_..._init.sql ← tables, auto-applied at boot, in an isolated schema
```

Each plugin gets its own Postgres schema (`plugin-notes` → `plugin_notes`) — no name collisions with core or other plugins, and uninstalling is a one-line `DROP SCHEMA`. Details: [docs/PLUGINS.md §8](docs/PLUGINS.md).

## Documentation

| Document | What it covers |
|---|---|
| [docs/PLUGINS.md](docs/PLUGINS.md) | Building plugins: manifest, lifecycle, conversation flows, fuzzy matching, per-plugin database. |
| [docs/CORE.md](docs/CORE.md) | Modifying core: router, loader, helpers, DB, adding platforms. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Feature status + implementation notes. |
| [docs/CLAUDE_PROMPT.md](docs/CLAUDE_PROMPT.md) | Generating plugins with Claude; an uploadable skill lives in [claude-skill/](claude-skill/). |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute. |

## Useful scripts

```bash
npm run typecheck          # TypeScript check, no emit
npm run build              # tsc + copy manifests/migrations to dist
npm run dev                # tsx watch (auto-reload)
npm run sim:conversation   # smoke test for the conversation helper (build first)
```

## Baileys v7 notes (LID)

- WhatsApp now uses **LID** (Linked Identity) alongside phone numbers (PN).
- `Contact.id` is the primary identifier; it can be a LID or a PN.
- Extra fields: `phoneNumber` (when id is a LID) and `lid` (when id is a PN).
- `isJidUser` is deprecated → use `isPnUser` / `isLidUser`.
- LID/PN mappings are accessed via `sock.signalRepository.lidMapping` (`getLIDForPN`, `getPNForLID`).
- Auth state must support the new keys: `lid-mapping`, `device-list`, `tctoken` → handled automatically by `useMultiFileAuthState`.
- ESM-only since v6.8.0.

See `core/platforms/whatsapp.ts` for the LID handling details.

## License

[MIT](LICENSE)
