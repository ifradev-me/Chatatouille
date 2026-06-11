# Modifying Core

> 🇬🇧 English · 🇮🇩 [Bahasa Indonesia](CORE.id.md)

A guide for anyone about to **change `core/`** — as opposed to writing a plugin. Each section covers:

- **When** to touch it
- **Files** involved
- **Steps** in the right order
- **Watch out for** (pitfalls, breaking-change risk)
- **How to verify**

General rule before touching anything in `core/`:

> Every change in `core/` potentially affects **all plugins**. Every addition to `types.ts` should ideally be **optional** (`?` or a default value) so existing plugins don't break.

---

## 0. Core map

```
core/
├── index.ts          ← entry: migrate DB, load plugins, boot platforms
├── types.ts          ← THE CONTRACT. Almost every change starts/ends here
├── config.ts         ← parses .env into the Config shape
├── logger.ts         ← pino instance (pretty in dev, raw JSON when NODE_ENV=production)
├── loader.ts         ← discovers plugin.json + dynamic-imports handlers + keyword index
├── router.ts         ← plugin matching + lifecycle hook dispatch
├── plugin-sdk.ts     ← utilities imported by plugins
├── db/               ← PostgreSQL: pool.ts, migrate.ts, index.ts (DbClient), plugin.ts (per-plugin schema), migrations/*.sql
├── middleware/       ← global middleware (runs for every message)
├── helpers/          ← domain helpers (user, history, session, conversation) attached to ctx.helpers
└── platforms/        ← one adapter per platform (whatsapp, telegram, discord)
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
                    │                   loader picks plugin
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

## 1. Adding a field to `Msg`

### When
A platform message carries info not yet exposed to plugins (e.g. `replyToMessageId`, `forwarded`, `reaction`, etc.).

### Files
- [core/types.ts](../core/types.ts) — add the field to the `Msg` interface.
- Every adapter in [core/platforms/](../core/platforms/) — populate the field during normalization.

### Steps
1. Add the field to `Msg` as **optional** (`field?: T`) so existing plugins don't break.
2. Add JSDoc — explain when the field is available (which platform, under which conditions).
3. Update **every** adapter to populate it. Adapters lacking the info → leave it `undefined` (no dummy values).
4. If a platform doesn't have the info: don't force a polyfill — leave it `undefined` and document it.

### Watch out for
- **Don't** make a field required (`field: T`) if only one platform can populate it. That forces the other adapters to lie.
- **Cross-platform**: the same field must carry **the same semantics**. `text` on WA and Telegram must both mean "the main text message", not "caption" on one side and "body" on the other.
- Consider whether the field actually warrants a new lifecycle hook (see §3).

### Verify
```bash
npm run typecheck     # all adapters still pass
```
Manual test on the relevant platform.

---

## 2. Adding global middleware

### When
Logic that must run for **every message, on every platform, before any plugin**. Examples: telemetry, blocklists, global anti-spam, language detection.

### Files
- Create a new file in [core/middleware/](../core/middleware/).
- Register it in [core/middleware/index.ts](../core/middleware/index.ts).

### Steps
1. Create `core/middleware/yourThing.ts`:

   ```ts
   import type { MiddlewareFn } from "../types.js";

   const yourThing: MiddlewareFn = async (msg, ctx) => {
     // ... logic
     if (shouldStop) {
       await ctx.reply("reason");
       ctx.stop();
     }
   };

   export default yourThing;
   ```

2. Add it to the array in `core/middleware/index.ts`:

   ```ts
   import yourThing from "./yourThing.js";
   export const globalMiddlewares: MiddlewareFn[] = [logger, ratelimit, auth, welcome, yourThing];
   ```

### Watch out for
- **Order matters**. Currently:
  1. `logger` — always runs, observation only
  2. `ratelimit` — block before expensive side effects
  3. `auth` — auto-registers the user + ban check
  4. `welcome` — first-contact welcome (private chats only; needs the user in the DB)
  5. (new middleware usually goes after these)

- **`ctx.stop()`** halts **all subsequent middleware + the plugin**. Think about whether that's what you want. Observation-only middleware should never call `stop()`.

- **Avoid long blocking I/O** in global middleware — it runs for **every** message. DB ops must be fast (indexed lookups); HTTP calls need short timeouts (~500ms) or shouldn't happen here at all.

- **`msg.fromMe` handling**: the `auth` middleware already `stop()`s the bot's own messages. If you place new middleware **before** `auth`, handle `fromMe` yourself.

- **Banned users**: after `auth`, no plugin runs. Middleware placed after `auth` won't run either (because `auth` calls `stop()`). Double-check your ordering.

### Verify
- Send a message, confirm your middleware's log line appears.
- Test edge cases: the bot's own messages, banned users, off-hours (if you filter by time), etc.

---

## 3. Adding a new lifecycle event (beyond handle/onMedia/onJoin/onLeave)

### When
The platform has an event that's conceptually different from the existing ones — e.g. `reaction`, `edit`, `poll-vote`, `call`.

### Files
- [core/types.ts](../core/types.ts) — extend `MsgEvent` + `PluginDef`.
- [core/router.ts](../core/router.ts) — extend `getHook()`.
- The platform adapter(s) that trigger the event.

### Steps
1. In `types.ts`, add the variant to `MsgEvent`:

   ```ts
   export type MsgEvent = "message" | "media" | "join" | "leave" | "reaction";
   ```

2. Add an optional hook to `PluginDef`:

   ```ts
   export interface PluginDef {
     handle?(msg: Msg, ctx: Ctx): Promise<void>;
     onMedia?(msg: Msg, ctx: Ctx): Promise<void>;
     onJoin?(msg: Msg, ctx: Ctx): Promise<void>;
     onLeave?(msg: Msg, ctx: Ctx): Promise<void>;
     onReaction?(msg: Msg, ctx: Ctx): Promise<void>;   // ← new
   }
   ```

3. In `router.ts`, map it in `getHook()`:

   ```ts
   function getHook(plugin, event) {
     switch (event) {
       case "message":  return plugin.handle?.bind(plugin);
       case "media":    return plugin.onMedia?.bind(plugin);
       case "join":     return plugin.onJoin?.bind(plugin);
       case "leave":    return plugin.onLeave?.bind(plugin);
       case "reaction": return plugin.onReaction?.bind(plugin);   // ← new
     }
   }
   ```

4. In the relevant adapter, dispatch the event:

   ```ts
   // e.g. in whatsapp.ts when handling messages.reaction
   const msg: Msg = { ...common, event: "reaction" };
   await route(msg, makeCtx(sock, msg), plugins, keywordIndex);
   ```

### Watch out for
- **Backward compat**: new hooks MUST be optional (`?`). Old plugins are skipped automatically by the router (`getHook` returns `undefined`).
- **Match logic**: plugins using `match: keyword/regex` may be irrelevant for the new event (`reaction` usually has no `text`). Plugins handling new events typically use `match: all`. Document it in [docs/PLUGINS.md](PLUGINS.md) if needed.
- **`Msg` consistency**: new events must still populate the minimum fields (`id`, `from`, `platform`, `event`, `timestamp`). Others can be empty (`text: ""`, `media: null`).
- **Other adapters**: no update needed — platforms that don't support the event simply never trigger it. That's fine.

### Verify
1. `npm run typecheck`
2. Old plugins still load (the new hook isn't required).
3. Build a test plugin implementing `onReaction`, send a reaction, confirm it fires.

---

## 4. Adding a new helper to `ctx.helpers`

### When
Domain logic used by many plugins that knows the DB structure. Difference vs the SDK: helpers know data shapes & access the DB; SDK utilities are generic and technical.

| | SDK (`plugin-sdk.ts`) | Helpers (`core/helpers/`) |
|---|---|---|
| DB access | no | yes |
| Generic | yes | no (domain-aware) |
| Examples | `retry`, `formatMessage`, `match` | `user`, `history`, `session`, `conversation` |

### Files
- [core/types.ts](../core/types.ts) — add the new helper interface + add it to `Ctx.helpers`.
- Create the file in [core/helpers/](../core/helpers/).
- Update [core/helpers/index.ts](../core/helpers/index.ts) — export it.
- Every adapter's `makeCtx()` must include the new helper. (Currently `import * as helpers from "../helpers/index.js"` means it's included automatically — verify this pattern in each adapter.)

### Steps
1. In `types.ts`, add the interface:

   ```ts
   export interface OrderHelpers {
     create(from: string, item: string): Promise<{ id: string }>;
     getByUser(from: string): Promise<Order[]>;
     cancel(id: string): Promise<void>;
   }
   ```

2. Add it to `Ctx.helpers`:

   ```ts
   helpers: {
     user: UserHelpers;
     history: HistoryHelpers;
     session: SessionHelpers;
     conversation: ConversationHelpers;
     order: OrderHelpers;     // ← new
   };
   ```

3. Create `core/helpers/order.ts`:

   ```ts
   import type { OrderHelpers } from "../types.js";
   import { db } from "../db/index.js";

   export const order: OrderHelpers = {
     async create(from, item) { /* ... */ },
     async getByUser(from)    { /* ... */ },
     async cancel(id)          { /* ... */ },
   };
   ```

4. Export it in `core/helpers/index.ts`:

   ```ts
   export { user } from "./user.js";
   export { history } from "./history.js";
   export { session } from "./session.js";
   export { conversation } from "./conversation.js";
   export { order } from "./order.js";    // ← new
   ```

### Watch out for
- **Helpers must be free of load-time side effects.** Don't initialize connections/timers at module top level unless truly needed (and idempotent).
- **DB schema**: if the helper needs a new table, add a migration in [core/db/migrations/](../core/db/migrations/) + a `FieldMap` in [core/db/index.ts](../core/db/index.ts) (see §10).
- **Adapter compatibility**: if the adapter's `makeCtx` already imports helpers wholesale (`helpers,` shorthand), it gets the new helper automatically. If it destructures manually (`{ user, history, session }`), update it.
- **Keep helpers deterministic for testing.** Avoid raw `Date.now()` — accept an injectable clock, or document it.

### Verify
```bash
npm run typecheck
```
A test plugin using `ctx.helpers.order.create(...)` — verify data is stored & retrievable.

---

## 5. Adding a new platform (e.g. Slack, Line, Instagram DM)

### When
A new platform. The bot is multi-platform — plugins **don't** need to know a new platform exists, as long as the adapter normalizes messages into `Msg`.

### Files
- Create [core/platforms/slack.ts](../core/platforms/slack.ts) (or other platform).
- [core/types.ts](../core/types.ts) — add to the `Platform` union.
- [core/config.ts](../core/config.ts) — add env vars (token, etc.).
- [core/index.ts](../core/index.ts) — boot the adapter when enabled.
- [.env.example](../.env.example) — document the env vars.

### Steps
1. Add to `Platform`:

   ```ts
   export type Platform = "whatsapp" | "telegram" | "discord" | "slack";
   ```

2. Add config:

   ```ts
   // config.ts
   SLACK_TOKEN: process.env.SLACK_TOKEN ?? "",
   ENABLE_SLACK: bool(process.env.ENABLE_SLACK, false),
   ```

3. Create the adapter `core/platforms/slack.ts`:

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
     // 1. connect to Slack
     // 2. listen to the relevant events
     // 3. on incoming message:
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

4. Wire it in `index.ts`:

   ```ts
   if (config.ENABLE_SLACK) tasks.push(startSlack({ plugins, keywordIndex }));
   ```

### Watch out for
- **Normalization is the adapter's main job.** Never pass platform-specific fields to plugins outside `msg.raw`. Plugins reading `msg.raw` become tightly coupled and non-portable.
- **Identity (`msg.from`)**: pick a **stable** identifier. On Slack that's the user ID (`Uxxxxx`), not the display name. On WhatsApp we prefer the LID (not the phone number). Document the choice in code + in [docs/PLUGINS.md §10](PLUGINS.md).
- **`replyMedia`**: must support local file paths **and** HTTP URLs. Plugins (`plugin-image`) send local paths from downloads — the adapter must upload, not assume a public URL.
- **Auto-reconnect**: implement it for transient disconnects. See the pattern in `whatsapp.ts` — schedule a restart after a delay (with backoff and error handling).
- **Auth state persistence**: WhatsApp uses `useMultiFileAuthState`. Other platforms usually just need a bot token in env. Never commit tokens.
- **Platform rate limits**: each platform has different API limits (WA: anti-ban, Telegram: 30 msg/sec/bot, Slack: tier-based). Respect them in the adapter, not in plugins.
- **Lifecycle event coverage**: at minimum `message` & `media`. `join`/`leave` optional if the platform supports groups/channels.

### Verify
```bash
npm run typecheck
ENABLE_SLACK=true npm start
```
Send a message from Slack → check logs + bot replies. Existing plugins must work without modification (that's the portability test).

---

## 6. Adding / changing utilities in `plugin-sdk.ts`

### When
Generic technical utilities useful for many plugins. **Not** for DB/state access — that's helpers.

### Files
- [core/plugin-sdk.ts](../core/plugin-sdk.ts) — add the new export.
- [docs/PLUGINS.md §5](PLUGINS.md) — document it.

### Steps
1. Add the function to `plugin-sdk.ts`:

   ```ts
   /**
    * Debounce an async function — subsequent calls within the window are ignored.
    * Useful for handlers triggered by event bursts.
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

2. Update the docs.

### Watch out for
- **NO breaking changes.** Old plugins may import the old utility. If a signature must change, **add** a new function — don't change the existing one.
- **Generic.** SDK utilities that assume a DB shape, a specific env var, or a specific platform = wrong place. Move them to `helpers/` or build an abstraction.
- **No load-time side effects.** The SDK is imported once per plugin × N. Avoid timers/listeners at top level.
- **Type-safe.** Use generics + JSDoc. `unknown`/`any` in the SDK spreads to plugins and makes their code brittle.
- **Minimal tests.** Utilities like `retry`, `formatMessage` are easy to unit test — when adding one, include at least one test (once test infra exists).

### Verify
```bash
npm run typecheck
```
Plugins using the old utilities still work (no breakage).

---

## 7. Changing `router.ts`

### When
**Only** when routing logic fundamentally changes:
- New matching kind (e.g. `match.type: "intent"` with a real classifier)
- Allowing multiple plugins to match (currently only 1)
- Reordering global vs local middleware
- Adding parameters to hooks

### Files
- [core/router.ts](../core/router.ts)
- If breaking, [core/types.ts](../core/types.ts) too (signature change).

### Current routing order
1. **Global middleware** (logger → ratelimit → auth → welcome)
2. **Conversation lock** — `ctx.helpers.conversation.current()`. If active, dispatch to the owner plugin (bypassing matching). If the owner plugin is missing → auto-`exit()` + fall through.
3. **Fuzzy keyword** (centralized) — `findKeywordMatch()` runs token-wise dice-coefficient scoring across the `keywordIndex`. The highest-scoring plugin above its threshold wins. **Only for the `"message"` event**.
4. **Regex + all loop** — plugins with `match.type === "keyword"` are skipped (already handled in step 3).

### Watch out for — this is the MOST SENSITIVE file in the codebase

- **Every change here affects 100% of messages, 100% of plugins.**
- **Current pattern**: the first plugin that matches and has the hook wins; the rest are skipped. Changing this (e.g. to "all matching plugins run") = breaking semantics for every existing plugin.
- **`match.type: "intent"`** is currently a placeholder — returns `false`. If you implement it: call the external classifier non-blocking, cache the result per message if called more than once.
- **The hook signature `(msg, ctx)`** is a contract. Adding a 3rd parameter = breaking. Add fields to `ctx` or `msg` instead.
- **Error handling**: the router `try/catch`es around `hook()`, logs the error, doesn't crash. Keep it that way — one broken plugin must never kill the bot.
- **Local middleware loading**: lazy (`await import` on first dispatch), then cached in a module-level `Map`. The loader also warns at boot when a declared middleware file is missing. Middleware errors are logged and the message is treated as handled (no fall-through to other plugins).
- **Conversation lock has top priority.** A plugin in a flow receives every message, even if the text fuzzy-matches another plugin's keyword. For admin overrides, the owner plugin must detect the admin command itself + `exit()`.
- **`keywordIndex` is built once at boot** (see §8). Plugins that are `enabled: false` or platform-mismatched are filtered at lookup time.

### Steps when changing
1. Write the new behavior in comments first — what changes vs the current pattern.
2. Update test cases if any (or at least manually test 3 plugins: a specific match, an `all` fallback, and a plugin with local middleware).
3. Update [docs/PLUGINS.md §1 "match.type"](PLUGINS.md) if matching semantics change.
4. Record the breaking change in the CHANGELOG/README.

---

## 8. Changing `loader.ts`

### When
- Plugin discovery changes (e.g. plugins from an npm registry instead of folders)
- Manifest format changes (`plugin.json` → `plugin.yaml`)
- Hot-reloading plugins without a bot restart

### Files
- [core/loader.ts](../core/loader.ts)
- [scripts/copy-manifests.mjs](../scripts/copy-manifests.mjs) if the dist output structure changes

### Watch out for
- **The loader runs once at boot.** No built-in watch/hot-reload. If you add hot-reload, beware of plugin top-level state (rate limiter maps, health check intervals) — it needs cleanup on reload. The `keywordIndex` also needs rebuilding.
- **Dual mode**: source (`plugins/`) and compiled (`dist/plugins/`). If you change this, keep both working, or pick one mode + update docs + build script.
- **`plugin.json` is copied to dist** by `scripts/copy-manifests.mjs` (triggered by `npm run build`). The script also copies `core/db/migrations/*.sql` → `dist/core/db/migrations/` and `plugins/*/migrations/*.sql` → `dist/plugins/*/migrations/`. Adding new non-TS files? Update this script.
- **Loader error tolerance**: if one plugin fails to load (invalid manifest, import error), log + skip — never crash the boot. The current pattern is a per-plugin `try/catch`.
- **Load order**: `specifics` first, `fallbacks` (`match.type === "all"`) last. Changing the order changes routing semantics for the regex/all path.
- **`buildKeywordIndex(plugins)`** must be called after `loadPlugins()` — the router uses its output for fuzzy matching. Only `match.type === "keyword"` plugins enter the index. Global default threshold = `DEFAULT_FUZZY_THRESHOLD` (0.6).
- **`platforms[]` validation**: `validatePlatforms()` warns when a value isn't `whatsapp`/`telegram`/`discord` or when the array is empty. The plugin still loads (warn ≠ skip).

### Steps
1. Identify what's changing: discovery / manifest format / lifecycle.
2. Keep the `LoadedPlugin` shape (in `types.ts`) consistent — the router depends on it.
3. Test boot with 0 plugins, 1 plugin, and a mix of specific+fallback.

---

## 9. Changing `config.ts` / adding env vars

### When
- New platform → new token
- New feature flag
- New DB URL / external service URL

### Files
- [core/types.ts](../core/types.ts) — the `Config` interface
- [core/config.ts](../core/config.ts) — parsing
- [.env.example](../.env.example) — documentation
- [README.md](../README.md) if user-facing

### Steps
1. Add the field to `interface Config` in `types.ts` — with a **strict type** (`string`, `boolean`, `number`, not `string | undefined`).
2. Parse it in `config.ts` with a default:

   ```ts
   NEW_FLAG: bool(process.env.NEW_FLAG, false),
   NEW_URL: process.env.NEW_URL ?? "",
   NEW_PORT: num(process.env.NEW_PORT, 8080),
   ```

3. Add it to `.env.example` with a comment:

   ```
   # ... what this is, when it's needed
   NEW_FLAG=false
   ```

### Watch out for
- **Defaults are MANDATORY.** Never leave a `string | undefined` field in `Config` — that pushes validation onto every consumer. Better to default to `""` and check `if (!config.NEW_URL) ...` where needed.
- **Boolean parsing**: the `bool()` helper handles `"true"`, `"1"`. Never use `Boolean(process.env.X)` — the string `"false"` is truthy.
- **Secrets**: never log full values. For debugging, mask: `secret.slice(0, 4) + "***"`.
- **Boot-time validation**: for critical env vars (e.g. `WA_PHONE_NUMBER` when `WA_USE_PAIRING_CODE=true`), log a clear error. Pattern: see `core/platforms/whatsapp.ts`.

---

## 10. Changing `db/` (Postgres)

The DB layer = PostgreSQL via `pg`. Connection set up via `DATABASE_URL` in `.env`. Schema managed through raw SQL migrations.

### Files
- [core/db/pool.ts](../core/db/pool.ts) — `pg.Pool` singleton from `DATABASE_URL`
- [core/db/migrate.ts](../core/db/migrate.ts) — scans `migrations/*.sql`, applies what's not yet in the `_migrations` table; also runs plugin migrations (`migratePlugins`)
- [core/db/index.ts](../core/db/index.ts) — the `DbClient` implementation (TS field ↔ DB column translation)
- [core/db/plugin.ts](../core/db/plugin.ts) — `createPluginDb` (per-plugin schema, re-exported by `plugin-sdk.ts`)
- [core/db/migrations/](../core/db/migrations/) — `.sql` files, ordered by filename
- [core/types.ts](../core/types.ts) — the `DbClient`, `DbCollection<T>` interfaces

### Adding a new core migration

1. Create a file in `core/db/migrations/` with the format:
   ```
   [seq]_[YYYYMMDD]_[HHMMSS]_[epoch_s]_[description].sql
   ```
   Example: `002_20260601_103045_1748778645_add_orders_table.sql`. The numeric sequence at the front is the tiebreaker for filename sort. The filename = the primary key in `_migrations` — **never rename after applying**.
2. Write idempotency-friendly SQL (`CREATE TABLE IF NOT EXISTS …` is safe; `ALTER TABLE` is not — wrap with `DO $$ BEGIN … EXCEPTION WHEN duplicate_column THEN NULL; END $$;` if needed).
3. Restart the bot — `migrate()` runs automatically before `loadPlugins()`. Pending files run in a single transaction per file (rollback on error).

### Plugin migrations (schema per plugin)

Tables needed by **plugins** are NOT added here — plugins have their own fully self-contained path (see [PLUGINS.md §8](PLUGINS.md)):

- Files: `plugins/<name>/migrations/*.sql` (same filename format as core). Copied to dist by `copy-manifests.mjs`.
- Runner: `migratePlugins()` in [core/db/migrate.ts](../core/db/migrate.ts) — called by `index.ts` **after** the core `migrate()` and `loadPlugins()` (enabled plugins only).
- Isolation: each file runs in a transaction with `search_path = <schema>, public`; schema = plugin name (`-`→`_`), auto-created. Tracked in `_migrations` namespaced as `<plugin>/<filename>`.
- Failure: does **not** stop the boot — failed plugins are excluded from routing (the return value of `migratePlugins`), with the error logged.
- Plugin query access: `createPluginDb()` in [core/db/plugin.ts](../core/db/plugin.ts) (re-exported by `plugin-sdk.ts`) — a small per-plugin pool with connection-level `search_path`.

### Adding a new collection to `DbClient`

1. Add a migration that `CREATE TABLE`s the schema.
2. Add a `FieldMap<T>` (TS field → DB column) in `core/db/index.ts`.
3. Add `makePgCollection<T>("table", fields)` to the `db` object.
4. Add the field to the `DbClient` interface in [types.ts](../core/types.ts).

### Watch out for
- **TS field names ≠ DB columns**. Convention: camelCase in TS (`phoneNumber`, `createdAt`), snake_case in SQL (`phone_number`, `created_at`). Translation happens **only in `core/db/index.ts`** via `FieldMap` — helpers & plugins use TS field names.
- **`from` is a reserved SQL word**. The column is stored as `from_id`; the TS field remains `from`.
- **Per-platform UNIQUE constraint**. `users` has `UNIQUE (from_id, platform)` — every user-helper lookup uses `{ from, platform }`. Never look up by `from` alone.
- **Pool, not a client per query**. The pool is created once in [pool.ts](../core/db/pool.ts). For multi-statement transactions, use `pool.connect()` + `BEGIN/COMMIT`/`ROLLBACK` (see `migrate.ts`).
- **`ctx.db.save("collection", data)`** writes to the generic `events(collection, data JSONB)` table. Plugins needing a real schema: own migrations + `createPluginDb` ([PLUGINS.md §8](PLUGINS.md)) — don't pile everything into `events`.
- **All async**. The `DbCollection<T>` interface is `Promise<T>` on every method — keep it that way.
- **Build copy**: `.sql` files in `core/db/migrations/` are copied to `dist/core/db/migrations/` by [scripts/copy-manifests.mjs](../scripts/copy-manifests.mjs). Moving the location? Update the script too.

### Verify
- `psql $DATABASE_URL -c '\dt'` shows the `users`, `history`, `events`, `_migrations` tables after the first boot.
- Send 1 message to the bot → a new row in `users` (auto-registered via middleware/auth) + `history` (via any plugin calling `history.append`).
- Restart the bot → data persists.

---

## 11. Logger / observability

### Files
- [core/logger.ts](../core/logger.ts)
- [core/types.ts](../core/types.ts) — the `Logger` interface

### When
- Switching loggers (winston, log4js)
- Adding destinations (file, Datadog, Sentry)
- Structured logging for production

### Watch out for
- **The `Logger` interface** in `types.ts` (`trace/debug/info/warn/error`) is used by every plugin via `ctx.log`. Preserve the signature — pino-style `log.info(obj, "msg")` already fits.
- **Log level via env** already exists (`LOG_LEVEL`). Keep it so levels can be tuned without rebuilds.
- **PII**: `msg.text` can be sensitive. The default log middleware truncates to 80 chars. If you change it, keep that practice.
- **Production**: `pino-pretty` is disabled when `NODE_ENV=production` (CPU-expensive) — raw JSON goes to stdout for an external collector to parse.

---

## 12. `core/index.ts` — boot order

Currently:

1. Load `.env` (automatic via `import "dotenv/config"` in `config.ts`).
2. `migrate()` — apply pending core SQL migrations. The DB must be ready before anything touches helpers.
3. `loadPlugins()` — discover & import all plugins.
4. `migratePlugins()` — apply plugin-owned migrations (schema per plugin). Failed plugins are excluded from routing.
5. `buildKeywordIndex(plugins)` — global fuzzy keyword index for the router.
6. For each `enabled` platform, `startXxx({ plugins, keywordIndex })`.
7. `Promise.all(tasks)` — the bot stays alive while platforms are connected.

### When adding a boot step
- **Before `loadPlugins`**: setup that plugins must not touch (DB migration, schema validation).
- **After platforms start**: global cron/timer scheduling. Make it idempotent if hot-reload ever lands.
- **Graceful shutdown**: consider trapping `SIGINT`/`SIGTERM` → close connections, flush logs. Not implemented yet — if you add it, it goes here.

### Watch out for
- A boot crash here = the bot is fully down. Wrap fallible steps with clear logging.
- **Async sequencing**: if a new platform needs a resource initialized earlier (cache, DB connection), `await` it here before `startXxx()`.

---

## 13. Generic checklist for PRs touching `core/`

- [ ] Existing plugins need **no** changes, or the changes are documented + executed.
- [ ] New `types.ts` fields/methods are optional (`?` or defaulted).
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes (including copy-manifests).
- [ ] Smoke test: boot the bot, send 1 message hitting a specific plugin, 1 hitting the fallback, confirm no regression.
- [ ] Relevant docs updated:
  - New `Msg` field → update [docs/PLUGINS.md §3](PLUGINS.md)
  - New helper → update [docs/PLUGINS.md §4](PLUGINS.md)
  - New lifecycle → update [docs/PLUGINS.md §2](PLUGINS.md)
  - New SDK utility → update [docs/PLUGINS.md §5](PLUGINS.md)
  - New platform → update the setup section in [README.md](../README.md)
- [ ] No secrets committed.
- [ ] Log levels + messages in new code are appropriate (debug for dev info, info for lifecycle, warn for recoverable, error for failure).

---

## 14. Core anti-patterns

| Anti-pattern | Why it's wrong | Alternative |
|---|---|---|
| Hard-coding platforms in the router (`if msg.platform === "whatsapp"`) | The router learns about platforms; the abstraction leaks | Adapters normalize; the router stays platform-agnostic |
| Plugins importing directly from `core/db/index.ts` | Tightly coupled to the DB implementation | Use `ctx.helpers.*` or `ctx.db` |
| Re-instantiating helpers per request | Wasteful, loses internal state | Helpers are single exported consts, stateless |
| `Date.now()` / `Math.random()` scattered through helpers | Non-deterministic for tests | Inject a clock/rng, or document it |
| Auto-reloading plugins by clearing `require.cache` | Risks leaked listeners/timers from the old load | Restart the bot, or implement a proper teardown protocol |
| Mutating `msg` in middleware (`msg.text = msg.text.toLowerCase()`) | Downstream plugins assume `msg` is immutable | Add a new field (e.g. `msg.normalizedText`) or pass via `ctx` |
| Global state at module top level (beyond caches) | Leaks across tests, hard to reason about | Encapsulate in a factory/class |
| `try/catch` swallowing without logging | Invisible bugs | `try/catch` + at least `ctx.log.error(...)` |

---

## 15. Quick reference

| Want to… | Open these files |
|---|---|
| Add a `Msg` field | [core/types.ts](../core/types.ts) + every adapter |
| Add global middleware | [core/middleware/](../core/middleware/) + `middleware/index.ts` |
| Add a lifecycle event | [core/types.ts](../core/types.ts) + [core/router.ts](../core/router.ts) + adapter |
| Add `ctx.helpers.x` | [core/types.ts](../core/types.ts) + [core/helpers/](../core/helpers/) |
| Add a platform | [core/platforms/](../core/platforms/) + the `Platform` type + `config.ts` + `index.ts` |
| Add a plugin utility | [core/plugin-sdk.ts](../core/plugin-sdk.ts) |
| Change routing logic | [core/router.ts](../core/router.ts) ⚠️ sensitive |
| Change plugin discovery | [core/loader.ts](../core/loader.ts) + [scripts/copy-manifests.mjs](../scripts/copy-manifests.mjs) |
| Add an env var | [core/types.ts](../core/types.ts) + [core/config.ts](../core/config.ts) + [.env.example](../.env.example) |
| Swap the DB | [core/db/index.ts](../core/db/index.ts) (don't change the interfaces in `types.ts`) |
| Boot order | [core/index.ts](../core/index.ts) |
