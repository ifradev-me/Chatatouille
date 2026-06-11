# Contributing

> 🇬🇧 English · 🇮🇩 [Bahasa Indonesia](CONTRIBUTING.id.md)

Thanks for considering a contribution! This repo is deliberately easy to learn — nearly every design decision is documented.

## Where to start

| What you want to do | Read |
|---|---|
| Build a new plugin (bot feature) | [docs/PLUGINS.md](docs/PLUGINS.md) — 99% of contributions live here, **without touching `core/`** |
| Change core (router, loader, DB, platforms) | [docs/CORE.md](docs/CORE.md) — per area: when, which files, the pitfalls |
| Check feature status / find ideas | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Generate a plugin with Claude | [docs/CLAUDE_PROMPT.md](docs/CLAUDE_PROMPT.md) or the skill in [claude-skill/](claude-skill/) |

## Development setup

```bash
npm install
cp .env.example .env          # at minimum set DATABASE_URL (see README for one-line Postgres via Docker)
npm run dev                   # tsx watch — auto-reload
```

## Before opening a PR

```bash
npm run typecheck             # must pass
npm run build                 # must pass (tsc + copy manifests/migrations)
npm run sim:conversation      # conversation helper smoke test (requires build)
```

If you touched `claude-skill/`:

```bash
cd claude-skill/bot-test-plugin-builder
python -m pytest tests/       # 46+ tests must pass, then regenerate the tarball (see plan.md §8)
```

## Ground rules

1. **Plugins are self-contained.** All of a plugin's code, manifest, middleware, migrations, and dependencies live in its own folder. Never import from another plugin; never add plugin migrations to `core/db/migrations/`.
2. **Changes to `core/types.ts` must be backward-compatible** — new fields/hooks are always optional (`?`). Full checklist: [docs/CORE.md §13](docs/CORE.md).
3. **Update the relevant docs in the same PR.** A feature without documentation is not done. The mapping lives in [docs/CORE.md §13](docs/CORE.md).
4. **Never commit secrets** (`.env` is already in `.gitignore` — keep it that way).
5. **Small, focused PRs** get reviewed much faster than one giant PR.

## Conventions

- Strict TypeScript, ESM (`.js` extensions in imports), camelCase in TS ↔ snake_case in SQL.
- Comments in English or Indonesian — be consistent within a file.
- Logging is pino-style: `log.info({ obj }, "message")`. Levels: `debug` dev info, `info` lifecycle, `warn` recoverable, `error` failure.
- Documentation is bilingual: English is the primary (`docs/*.md`), Indonesian lives alongside (`docs/*.id.md`). When you change one, update the other (or flag it in the PR so a maintainer can).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
