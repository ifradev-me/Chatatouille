# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **Plugin-owned PostgreSQL** — plugins can own real tables without touching core:
  - `plugins/<name>/migrations/*.sql` run automatically at boot, inside an isolated per-plugin Postgres schema (`plugin-notes` → `plugin_notes`).
  - `createPluginDb(import.meta)` in the plugin SDK: `query` / `tx` / `close` with a connection-level `search_path`.
  - A failed plugin migration excludes that plugin from routing; the bot still boots.
  - Live example: `plugins/plugin-notes/`. Documentation: `docs/PLUGINS.md` §8.
- Boot-time validation of local middleware files (early loader warning).
- `npm run sim:conversation` — conversation helper smoke test with proper exit codes.
- Open source scaffolding: `LICENSE` (MIT), `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/ROADMAP.md`.
- English documentation as the primary language (`README.md`, `docs/*.md`); Indonesian preserved alongside as `*.id.md`.

### Fixed

- Router: a keyword registered by more than one plugin is now evaluated against each entry's own threshold (previously only the first entry was considered).
- Router: errors in local middleware are logged and no longer abort the whole routing pass; middleware modules are cached.
- WhatsApp: reconnects now use backoff and catch errors (previously a failed reconnect could kill the process via an unhandled rejection).
- `user.findOrCreate`: two simultaneous first messages no longer throw a unique-constraint violation.
- The welcome middleware no longer sends onboarding messages into groups.
- `config`: empty numeric env vars (`PORT=`) fall back to the default instead of `0`.
- SDK `retry()` no longer sleeps after the final attempt; rate-limit maps (global & SDK) no longer grow unboundedly.
- Logger: `pino-pretty` is disabled when `NODE_ENV=production`.

### Changed

- Boot order: core `migrate()` → `loadPlugins()` → `migratePlugins()` → `buildKeywordIndex()` → start platforms.
- Docs synchronized with the code (CORE.md, PLUGINS.md, and the previously empty ROADMAP.md).
- Claude skill: the plan-approval loop and the test-fix loop are now explicit in `SKILL.md`; added a `plugin-database.md` reference for generating DB-backed plugins.
