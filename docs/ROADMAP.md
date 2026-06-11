# Roadmap

> 🇬🇧 English · 🇮🇩 [Bahasa Indonesia](ROADMAP.id.md)

Feature status + implementation notes. Item numbers are referenced across documents (e.g. "#7" = Push notification API) — **never renumber** existing items; append below.

Legend: ✅ done · 🚧 partial / stub · ⬜ not started

---

## 1. ✅ WhatsApp adapter (Baileys v7, LID-aware)

- `core/platforms/whatsapp.ts`. QR + pairing code, auto-reconnect with backoff, media downloads to `tmp/`.
- LID↔PN resolution via `signalRepository.lidMapping`; `msg.from` prefers LID (see [PLUGINS.md §10](PLUGINS.md)).
- Only `messages.upsert` of type `notify` is processed — history replays during sync are never answered.

## 2. ✅ Telegram adapter (grammy)

- `core/platforms/telegram.ts`. Long polling (no public URL needed), media download via the Bot API, join/leave events.
- Note: the bot's privacy mode must be disabled via @BotFather to read non-command group messages.

## 3. ✅ Plugin system

- Loader (`core/loader.ts`): discovers `plugins/*/plugin.json` + `dist/plugins/`, prefers dist. Validates `platforms[]` + middleware files at boot.
- Router (`core/router.ts`): global middleware → conversation lock → fuzzy keyword (centralized, dice coefficient) → regex/all loop.
- Lifecycle hooks: `handle` / `onMedia` / `onJoin` / `onLeave`.
- Per-plugin local middleware (lazy-loaded + cached).
- SDK (`core/plugin-sdk.ts`): `definePlugin`, `match`, `retry`, `formatMessage`, `createRateLimit`, `createHealthCheck`, `createPluginDb`.

## 4. ✅ PostgreSQL storage + migrations

- `core/db/`: a single pool from `DATABASE_URL`, raw SQL migrations auto-applied at boot (`_migrations` table, one transaction per file).
- Tables: `users` (UNIQUE from_id+platform), `history`, `events` (generic JSONB for `ctx.db.save`).

## 5. ✅ Conversation flows (multi-step)

- `ctx.helpers.conversation` — locks the router to one plugin per (user, platform), TTL required, `force` to override.
- In-memory; lost on restart (by design — persist durable data to the DB).
- Smoke test: `npm run sim:conversation` (requires `npm run build` first).

## 6. ✅ Claude skill — plugin builder

- `claude-skill/bot-test-plugin-builder/` — a claude.ai skill that scaffolds plugins end-to-end (interview → plan → approval loop → generate → test loop → tar.gz).
- Internal tests: `cd claude-skill/bot-test-plugin-builder && python -m pytest tests/`.
- Version-pinned to the core API as of 2026-05 — regenerate if `core/types.ts` changes signatures.

## 7. ⬜ Push notification API

- An HTTP endpoint (using `PORT` from config) so external systems (n8n, cron, dashboards) can make the bot send outbound messages without an inbound trigger.
- Needs: auth token, per-caller rate limiting, a send queue that respects platform limits.

## 8. 🚧 Discord adapter

- `core/platforms/discord.ts` is still a stub (logs a warning). The `Platform` union + config flag already exist.
- Implementation: normalize into `Msg` + `route(msg, ctx, plugins, keywordIndex)` — see the pattern in [CORE.md §5](CORE.md).

## 9. ⬜ `match.type: "intent"` (classifier)

- Placeholder in types + router (always skipped). Plan: non-blocking external classifier, result cached per message.

## 10. ⬜ Graceful shutdown

- Trap SIGINT/SIGTERM → close the pg pool, stop Telegram polling, close Baileys without logout, flush logs. Not implemented yet (see [CORE.md §12](CORE.md)).

## 11. ⬜ Plugin hot-reload

- Currently a bot restart loads new plugins (`tsx watch` is enough in dev). Hot-reload needs a teardown protocol (timer/listener cleanup) + `keywordIndex` rebuild.

## 12. ⬜ Per-platform session helper

- `ctx.helpers.session` is still keyed by `from` only — a user with the same id on WA & Telegram shares the session. `conversation` is already per-platform. Changing `SessionHelpers` = a breaking change for plugins; postponed until there's a real need. Meanwhile use a manual `${platform}:${from}` key when isolation matters.

## 13. ⬜ TypeScript test infrastructure

- No TS unit tests yet (only `sim:conversation` + the skill's Python tests). Candidates: vitest for router matching, helpers, plugin-sdk.

## 14. ✅ Plugin-owned PostgreSQL (schema per plugin)

- Fully self-contained plugins: `plugins/<name>/migrations/*.sql` + `createPluginDb(import.meta)` from the SDK.
- Isolation via a Postgres schema per plugin (`plugin-notes` → schema `plugin_notes`) with a connection-level `search_path` — plain unqualified tables, name collisions impossible.
- Failed migration → the plugin is excluded from routing; the bot still boots.
- Clean uninstall: `DROP SCHEMA <schema> CASCADE` + delete the `_migrations` rows + delete the folder.
- Live example: `plugins/plugin-notes/`. Guide: [PLUGINS.md §8](PLUGINS.md).
