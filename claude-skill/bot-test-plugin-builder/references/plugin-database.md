# Plugin-owned PostgreSQL (schema per plugin)

A plugin can own real Postgres tables **without touching `core/db/`** — fully self-contained: handler + manifest + migrations live in the plugin folder, and all its tables live in a Postgres schema owned by the plugin.

## When to generate this

Ask during the interview only if the plugin's purpose implies durable, structured data (orders, notes, reminders, inventory). Decision table:

| Need | Use |
|---|---|
| Ad-hoc event/log without schema | `ctx.db.save("collection", data)` → shared `events` JSONB table |
| Transient state (lost on restart is fine) | `ctx.helpers.session` / `conversation` |
| Real tables: typed columns, indexes, constraints | `createPluginDb` + `migrations/` folder (this doc) |

## Generated layout

```
<plugin-name>/
├── plugin.json
├── index.ts
└── migrations/
    └── 001_<YYYYMMDD>_<HHMMSS>_<epoch_s>_init.sql
```

Migration filename format is **mandatory**: `[seq]_[YYYYMMDD]_[HHMMSS]_[epoch_s]_[description].sql`. The filename is the primary key in the bot's `_migrations` table (namespaced as `<plugin-name>/<filename>`) — it must never be renamed after being applied.

## How isolation works (explain this to the user)

- At boot, after core migrations, the bot applies pending `plugins/<name>/migrations/*.sql` for enabled plugins.
- Each file runs in a transaction with `search_path = <schema>, public`. Schema = plugin name with `-` → `_` (`plugin-notes` → `plugin_notes`), auto-created.
- Write **plain unqualified SQL** in migrations: `CREATE TABLE notes (...)` lands in `plugin_notes.notes`. Never write `public.x` or another plugin's schema.
- A failed migration excludes the plugin from routing (bot still boots; error in logs).
- Clean uninstall: `DROP SCHEMA <schema> CASCADE;` + `DELETE FROM _migrations WHERE filename LIKE '<plugin-name>/%';` + delete the folder.

## index.ts pattern

```ts
import { definePlugin, createPluginDb } from "../../core/plugin-sdk.js";

interface NoteRow { id: string; text: string; created_at: Date; }

// import.meta → plugin name derived from the folder name (no hard-coded
// string that can drift). Call ONCE at module top level; pool is lazy.
const db = createPluginDb(import.meta);

export default definePlugin(async (msg, ctx) => {
  try {
    const { rows } = await db.query<NoteRow>(
      "SELECT id, text, created_at FROM notes WHERE from_id = $1 AND platform = $2 ORDER BY created_at DESC LIMIT 5",
      [msg.from, msg.platform],
    );
    // ...
  } catch (err) {
    ctx.log.error({ err: (err as Error).message }, "[<plugin-name>] query failed");
    await ctx.reply("Storage hiccup — try again shortly.");
  }
});
```

Transactions:

```ts
await db.tx(async (q) => {
  const { rows } = await q<{ id: string }>(
    "INSERT INTO orders (from_id, item) VALUES ($1, $2) RETURNING id",
    [msg.from, item],
  );
  await q("INSERT INTO order_events (order_id, type) VALUES ($1, 'created')", [rows[0].id]);
});
// throw inside the callback → automatic ROLLBACK.
```

## Migration template

```sql
-- Tables owned by <plugin-name>.
-- Runs with search_path = <schema>, public — unqualified objects land in the
-- plugin's schema. Do NOT write schema qualifiers.

CREATE TABLE <table> (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id    TEXT NOT NULL,
  platform   TEXT NOT NULL,
  -- ...domain columns...
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX <table>_user_idx ON <table> (from_id, platform, created_at DESC);
```

Convention: per-user data always carries `(from_id, platform)` — users are namespaced per platform.

## Hard rules (enforce in generated code)

1. Always parameterized queries (`$1, $2`) — never interpolate user input into SQL strings.
2. `createPluginDb()` at module top level, never inside a hook.
3. No schema qualifiers in migrations or queries.
4. Never query another plugin's schema; reading core tables (`public.users`) is discouraged — prefer `ctx.helpers.*`.
5. `(from_id, platform)` for any per-user rows — `msg.from` + `msg.platform`.

## Validation note

`validate_plugin_json.py` does not validate migrations (manifest is unchanged by this feature). Visually verify: filename format, no schema qualifiers, parameterized queries in index.ts. The user's local `npm run typecheck` + boot log confirms the rest.

Live example in the bot repo: `plugins/plugin-notes/`.
