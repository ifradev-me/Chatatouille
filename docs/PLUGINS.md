# Building Plugins

> 🇬🇧 English · 🇮🇩 [Bahasa Indonesia](PLUGINS.id.md)

A plugin is a unit of features. Self-contained — all of its code, config, middleware, migrations, and dependencies live in one folder. Add, replace, or remove plugins **without touching `core/`**.

---

## TL;DR — a new plugin in 3 steps

```
plugins/plugin-mine/
├── plugin.json     ← manifest: when this plugin fires
└── index.ts        ← the logic
```

1. Create the folder `plugins/plugin-mine/`.
2. Fill in `plugin.json` (when the plugin fires) + `index.ts` (what it does).
3. Restart the bot. Done.

```bash
npm run dev    # auto-reload during development
# or
npm run build && npm start
```

---

## 1. `plugin.json` — manifest

Minimum:

```json
{
  "name": "plugin-mine",
  "enabled": true,
  "match": { "type": "keyword", "values": ["hello"] }
}
```

### Field reference

| Field | Required | Description |
|---|---|---|
| `name` | ✓ | Unique plugin identifier. Should match the folder name. |
| `enabled` | ✓ | `true` active, `false` skipped by the loader. |
| `match` | ✓ | When the plugin fires. See details below. |
| `platforms` | — | Platform whitelist (`["whatsapp"]`, `["whatsapp","telegram"]`). Absent → all platforms. `[]` → never runs (loader warns). |
| `middleware` | — | Array of file names (without `.ts`) from the plugin's `middleware/` folder. |
| `response` | — | Informational only (`static` / `dynamic` / `llm`). Core does not use it for routing. |

### `platforms` — restrict a plugin to specific platforms (optional)

```json
{ "platforms": ["whatsapp"] }                  // WA only
{ "platforms": ["whatsapp", "telegram"] }      // WA + Telegram
// field absent → all platforms (backward compatible)
```

The router checks `msg.platform` before matching — if the message's platform is not in the whitelist, the plugin is skipped before `match` is even evaluated. Good for plugins that use platform-specific APIs (e.g. WA group admin) or regional features.

### `match.type` — when a plugin matches

| Type | Matches when… | Example values |
|---|---|---|
| `keyword` | **Fuzzy match** (dice coefficient) — a token in `msg.text` resembles one of the values. Default threshold 0.6. Override per plugin via `match.threshold`. | `["price", "shipping"]` |
| `regex` | `msg.text` matches a regex (case-insensitive) | `["^order\\s+.+"]` |
| `intent` | **TODO: not implemented** — manifests with this type are skipped by the router. Don't use. | — |
| `all` | always matches. Use for **fallbacks** (LLM, welcome) | — |

**Router execution order**:
1. Global middleware
2. **Conversation lock** — if the user is in an active flow, dispatch to the owner plugin (see §4 `ctx.helpers.conversation` + the pattern in §9).
3. **Fuzzy keyword** (centralized) — token-wise sortMatch across all `type: "keyword"` plugins. The plugin with the highest score above its threshold wins.
4. `regex` + `all` loop — first plugin that matches wins.

```json
{
  "name": "plugin-faq",
  "enabled": true,
  "match": {
    "type": "keyword",
    "values": ["price", "shipping", "stock"],
    "threshold": 0.65
  }
}
```

Typo-tolerant: `"price"` matches `"pricee"`, `"prce"`, `"what's the price?"` — no exact match required.

> **Fuzzy match note**: scoring works **per token**. For multi-word keywords (e.g. `"good morning"`), prefer `type: "regex"` or split into 2 keywords. Tokens are produced by splitting on whitespace + punctuation.

A plugin triggered via fuzzy match receives `ctx.matched = { keyword, score }` — useful for logging/internal branching.

> Tip: `match: all` is safe for plugins that **only** implement `onMedia`/`onJoin`/`onLeave` — the router dispatches by `msg.event`, so plain text messages never reach them.

---

## 2. `index.ts` — plugin logic

A plugin **must** `export default` an object with at least one **lifecycle hook**.

### Lifecycle hooks

| Hook | Fires when… | `msg.event` |
|---|---|---|
| `handle` | plain text message | `"message"` |
| `onMedia` | message with image/video/file/audio | `"media"` |
| `onJoin` | user joins a group | `"join"` |
| `onLeave` | user leaves a group | `"leave"` |

A plugin does **not** need to implement all of them. Only what's relevant.

### Form 1 — simplest (just reply with text)

```ts
// plugins/plugin-hello/index.ts
import type { PluginDef } from "../../core/types.js";

const hello: PluginDef = {
  async handle(msg, ctx) {
    await ctx.reply(`Hello, ${msg.pushName ?? "friend"}!`);
  },
};

export default hello;
```

### Form 2 — with the `definePlugin` SDK (structure validation + shortcut)

```ts
// plugins/plugin-hello/index.ts
import { definePlugin } from "../../core/plugin-sdk.js";

export default definePlugin(async (msg, ctx) => {
  await ctx.reply(`Hello, ${msg.pushName ?? "friend"}!`);
});
```

A single function is auto-wrapped into `{ handle: fn }`. For multiple hooks, pass an object:

```ts
export default definePlugin({
  async handle(msg, ctx)  { /* … */ },
  async onMedia(msg, ctx) { /* … */ },
  async onJoin(msg, ctx)  { /* … */ },
});
```

---

## 3. `Msg` — what a plugin receives

```ts
{
  id: string,
  platform: "whatsapp" | "telegram" | "discord",
  from: string,            // stable ID — use this for DB/session/history
  phoneNumber?: string,    // E.164 without "+", WA only & only when known
  lid?: string,            // "xxxxx@lid", WA only
  pushName?: string,       // display name on the platform
  groupId: string | null,  // null in private chats
  isGroup: boolean,
  fromMe: boolean,         // the bot must not reply to itself
  text: string,
  media: { type, url, mimeType } | null,
  event: "message" | "media" | "join" | "leave",
  timestamp: number,
  raw: unknown             // original platform message (escape hatch)
}
```

**Rules**:
- Plugins **must** use `msg.from` for identity (DB lookups, session, history). **Never** use `msg.phoneNumber` or `msg.lid` as a primary key — both can be empty or change between WhatsApp updates.
- `msg.raw` is an escape hatch — use it only when you genuinely need platform-specific data that hasn't been normalized.
- If `msg.fromMe === true`, the global `auth` middleware has already called `ctx.stop()`. The plugin won't be invoked — but double-checking is harmless.

---

## 4. `Ctx` — the plugin's toolbox

```ts
ctx.reply(text)                    // reply with text (quoted to the original message)
ctx.replyMedia(url, caption?)      // reply with media (local file path or URL)
ctx.platform                       // "whatsapp" | "telegram" | "discord"
ctx.config                         // parsed process.env
ctx.log                            // pino logger (trace/debug/info/warn/error)
ctx.db                             // raw DB client (rarely needed — prefer helpers)
ctx.helpers.user                   // per-platform user CRUD (findOrCreate, ban, isBanned)
ctx.helpers.history                // per-platform chat history (get, append, clear)
ctx.helpers.session                // in-memory per-user state (optional TTL)
ctx.helpers.conversation           // multi-step flow lock (see below)
ctx.matched                        // set by the router on fuzzy hits: { keyword, score }
ctx.stop()                         // halt the middleware chain (for middleware)
ctx.stopped                        // true once stop() has been called
```

### `ctx.helpers.conversation` — multi-step flows

A conversation is a state machine that **locks** the router to one plugin while the user is in a flow. While active, every message from that user is dispatched straight to the owner plugin — normal matching is bypassed. Ideal for wizards, step-by-step orders, form filling, etc.

```ts
ctx.helpers.conversation.enter(
  msg.from,
  ctx.platform,
  "plugin-order",                     // owner plugin name (usually yourself)
  { step: "ask_qty", item: "kopi" },  // initial state
  5 * 60_000,                         // TTL — REQUIRED (5 minutes)
  // { force: true }                  // optional — override another active flow (admin)
);

const active = ctx.helpers.conversation.current<{ step: string; item: string }>(msg.from, ctx.platform);
ctx.helpers.conversation.update(msg.from, ctx.platform, { ...active!.state, qty: 2 });
ctx.helpers.conversation.exit(msg.from, ctx.platform);
```

**Rules**:
- **TTL is required** in `enter()`. Never infinite — if the user abandons the flow, it auto-expires.
- **The plugin handles cancel itself** — convention: check for `"cancel"` / `"/cancel"` in `handle`, then call `exit()`.
- **State is in-memory** — lost on bot restart. For durable data (e.g. a confirmed order), persist to the DB via `ctx.helpers.history` / `ctx.db.save()` / your own tables (§8).
- **Each plugin has its own flow** — plugin A's flow is independent of plugin B's. Store key: `${platform}:${from}`.
- **`update()` does not reset the TTL.** To extend, call `enter()` again with `force: true` + the new state.

Full example: [§9 Patterns — Multi-step order flow](#9-common-patterns).

### Using `ctx.helpers`

> **User & history lookups are PER PLATFORM.** WA `"628123"` ≠ Telegram `"628123"`.
> Always pass `ctx.platform` (or `msg.platform`) as the second argument.

```ts
// auto-register if missing
const user = await ctx.helpers.user.findOrCreate(msg.from, ctx.platform);

// ban check
if (await ctx.helpers.user.isBanned(msg.from, ctx.platform)) return;

// store history (append reads the platform from msg, no need to pass it)
await ctx.helpers.history.append(msg, "user");
await ctx.helpers.history.append(msg, "bot", "my reply");

// fetch the last 10 messages
const last = await ctx.helpers.history.get(msg.from, ctx.platform, { limit: 10 });

// transient state with a 1-minute TTL
ctx.helpers.session.set(msg.from, { step: "confirm", item: "kopi" }, 60_000);
const state = ctx.helpers.session.get<{ step: string; item: string }>(msg.from);
ctx.helpers.session.clear(msg.from);
```

> **Session note**: unlike `user`/`history`/`conversation`, `session` is keyed by `from` only — **not** per platform. If your plugin runs on multiple platforms and needs isolation, build the key manually: `ctx.helpers.session.set(`${ctx.platform}:${msg.from}`, ...)`. For multi-step flows, prefer `conversation` (already per platform).

---

## 5. SDK utilities — `core/plugin-sdk.ts`

Import only what you need:

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

| Util | Purpose |
|---|---|
| `definePlugin(impl)` | Validation + auto-wrap a function into `{ handle }`. |
| `createPluginDb(import.meta)` | Plugin-owned PostgreSQL — isolated schema + migrations in the plugin folder. See [§8](#8-plugins-with-their-own-postgresql-tables). |
| `match(a, b, threshold=0.6)` | Fuzzy boolean check (dice coefficient). For internal branching, e.g. checking `"yes"` / `"no"` in a conversation flow. |
| `formatMessage(tmpl, vars)` | Replace `{{ key }}` in a string. |
| `retry(fn, times=3)` | Exponential backoff (200ms → 400ms → 800ms). |
| `createRateLimit(max, windowMs)` | Per-plugin limiter, returns `(key) => boolean`. |
| `createHealthCheck(url, intervalMs=30s)` | Background HEAD probe, returns `() => boolean`. Call **once** at top level, **not** per message. |
| `checkHealth(url)` | One-off HEAD check. |

### Combined example

```ts
// plugins/plugin-ai/index.ts
import { definePlugin, createHealthCheck, retry, formatMessage } from "../../core/plugin-sdk.js";

// runs once at load time — not on every message
const isHealthy = createHealthCheck(process.env.AI_URL!);

export default definePlugin(async (msg, ctx) => {
  if (!isHealthy()) {
    await ctx.reply("The AI service is currently unavailable.");
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
    formatMessage("Hi {{ name }}, the AI says: {{ reply }}", {
      name: msg.pushName ?? "friend",
      reply: data.reply,
    }),
  );
});
```

---

## 6. Plugin-local middleware

Unlike **global middleware** (runs for every message), **local middleware** only runs when this plugin matched. Good for format validation, plugin-specific quotas, etc.

### Structure

```
plugins/plugin-order/
├── index.ts
├── plugin.json
└── middleware/
    ├── validateFormat.ts
    └── checkStock.ts
```

### Register in `plugin.json`

```json
{
  "name": "plugin-order",
  "enabled": true,
  "match": { "type": "regex", "values": ["^order\\s+.+"] },
  "middleware": ["validateFormat", "checkStock"]
}
```

Array order = execution order. Once all local middleware passes, the hook (`handle`/`onMedia`/etc.) runs.

### Writing middleware

```ts
// plugins/plugin-order/middleware/validateFormat.ts
import type { MiddlewareFn } from "../../../core/types.js";

const validate: MiddlewareFn = async (msg, ctx) => {
  const rest = msg.text.replace(/^order\s+/i, "").trim();
  if (!rest) {
    await ctx.reply("Wrong format. Type: order [product]");
    ctx.stop();   // halt the chain — the hook & remaining middleware are skipped
  }
};

export default validate;
```

**Rules**:
- `export default` an async function with the signature `(msg, ctx) => Promise<void>`.
- Call `ctx.stop()` to halt execution (the hook will not run).
- You may send a reply before `stop()` — typically an error message.

---

## 7. Plugins with npm dependencies

A plugin may have its own `package.json` so its dependencies don't pollute the root.

### Structure

```
plugins/plugin-image/
├── index.ts
├── plugin.json
└── package.json     ← scoped dependencies
```

### Plugin `package.json`

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

### Dynamic import (recommended)

Use `await import()` inside the hook so the bot still boots even if the dependency isn't installed yet:

```ts
import { definePlugin } from "../../core/plugin-sdk.js";

export default definePlugin({
  async onMedia(msg, ctx) {
    if (msg.media?.type !== "image") return;

    let sharp;
    try {
      sharp = (await import("sharp")).default;
    } catch {
      ctx.log.warn("[plugin-image] sharp is not installed");
      return;
    }

    // use sharp…
  },
});
```

---

## 8. Plugins with their own PostgreSQL tables

A plugin can own real Postgres tables **without touching `core/db/` at all** — fully self-contained: handler + manifest + migrations live in the plugin folder, and all of its tables live in a **Postgres schema owned by the plugin**.

### When to use what

| Need | Use |
|---|---|
| Ad-hoc event/log storage without a schema | `ctx.db.save("collection", data)` → `events` table (JSONB) |
| Transient state (losing it on restart is fine) | `ctx.helpers.session` / `ctx.helpers.conversation` |
| Real tables: typed columns, indexes, constraints | **`createPluginDb` + a `migrations/` folder** (this section) |

### Structure

```
plugins/plugin-notes/
├── plugin.json
├── index.ts
└── migrations/
    └── 001_20260611_000000_1781136000_init.sql
```

### How the isolation works

- At boot — after core migrations — the runner applies any unapplied `plugins/<name>/migrations/*.sql` (only for plugins with `enabled: true`).
- Each file runs in a **transaction** with `search_path = <schema>, public`. The schema is the plugin name with `-` replaced by `_` (`plugin-notes` → `plugin_notes`), created automatically.
- A plain `CREATE TABLE notes (...)` → becomes `plugin_notes.notes`. Name collisions with core (the `public` schema) or other plugins are impossible.
- Tracked in the `_migrations` table, namespaced: `plugin-notes/001_....sql`.
- **A failed migration → the plugin is excluded from routing** (the bot still boots; the error is clearly logged). Fix the SQL and restart.

### Querying from the handler

```ts
import { definePlugin, createPluginDb } from "../../core/plugin-sdk.js";

interface NoteRow { id: string; text: string; created_at: Date; }

// import.meta → the plugin name is derived from the folder name (no typos/drift).
// Call ONCE at top level; the pool is created lazily on first query.
const db = createPluginDb(import.meta);

export default definePlugin(async (msg, ctx) => {
  // The table "notes" resolves to plugin_notes.notes via the connection's search_path.
  const { rows } = await db.query<NoteRow>(
    "SELECT id, text, created_at FROM notes WHERE from_id = $1 AND platform = $2 ORDER BY created_at DESC LIMIT 5",
    [msg.from, msg.platform],
  );
  // ...
});
```

### Transactions

```ts
await db.tx(async (q) => {
  const { rows } = await q<{ id: string }>(
    "INSERT INTO orders (from_id, item) VALUES ($1, $2) RETURNING id",
    [msg.from, item],
  );
  await q("INSERT INTO order_events (order_id, type) VALUES ($1, 'created')", [rows[0].id]);
});
// a throw inside the callback → automatic ROLLBACK.
```

### Rules

- **Migration filenames follow the core format**: `[seq]_[YYYYMMDD]_[HHMMSS]_[epoch_s]_[description].sql`. The filename is the key in `_migrations` — **never rename** after it has been applied.
- **Never write schema qualifiers** (`public.x`, `other_plugin.x`) in migrations — let `search_path` do the work.
- **Never query another plugin's schema** — that breaks self-containment. Need to share data between plugins? That's a signal the data belongs to core: propose a helper in `core/helpers/` (see [CORE.md §4](CORE.md)).
- Reading core tables (`public.users`, `public.history`) is **allowed but discouraged** — prefer `ctx.helpers.*`; querying directly couples you to core's internal schema, which can change.
- **Always use parameterized queries** (`$1, $2`) — never interpolate user input into SQL strings.
- `createPluginDb()` belongs at **module top level**, not inside a hook (same rule as `createHealthCheck`).

### Clean uninstall

Every trace of the plugin lives in its folder + one schema — removing a plugin leaves no debris:

```sql
DROP SCHEMA plugin_notes CASCADE;
DELETE FROM _migrations WHERE filename LIKE 'plugin-notes/%';
```

then delete the `plugins/plugin-notes/` folder.

Live end-to-end example: [plugins/plugin-notes/](../plugins/plugin-notes/).

---

## 9. Common patterns

### Multi-step flow (using conversation)

One plugin handles the whole flow. While the user is in the flow, the router locks onto this plugin — every message arrives via `handle` until the flow exits.

```ts
// plugins/plugin-order
import { definePlugin, match } from "../../core/plugin-sdk.js";

type OrderState =
  | { step: "ask_qty"; item: string }
  | { step: "confirm"; item: string; qty: number };

export default definePlugin(async (msg, ctx) => {
  const active = ctx.helpers.conversation.current<OrderState>(msg.from, ctx.platform);

  // Plugin convention: support cancel anywhere.
  if (match(msg.text, "cancel") || msg.text === "/cancel") {
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
    await ctx.reply("Order cancelled.");
    return;
  }

  // Entry point (not in a flow yet) — triggered via the fuzzy keyword "order".
  if (!active) {
    const item = msg.text.replace(/^order\s+/i, "").trim() || "(unnamed)";
    ctx.helpers.conversation.enter(
      msg.from,
      ctx.platform,
      "plugin-order",
      { step: "ask_qty", item } satisfies OrderState,
      5 * 60_000,
    );
    await ctx.reply(`Ordering "${item}". How many?`);
    return;
  }

  // Step: ask_qty
  if (active.state.step === "ask_qty") {
    const qty = parseInt(msg.text, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      await ctx.reply("Quantity must be a number > 0. Try again.");
      return;
    }
    ctx.helpers.conversation.update(
      msg.from,
      ctx.platform,
      { step: "confirm", item: active.state.item, qty } satisfies OrderState,
    );
    await ctx.reply(`Confirm ${qty}x ${active.state.item}? (yes / no)`);
    return;
  }

  // Step: confirm
  if (active.state.step === "confirm") {
    if (match(msg.text, "yes")) {
      await ctx.db.save("orders", { item: active.state.item, qty: active.state.qty, from: msg.from });
      await ctx.reply(`Order for ${active.state.qty}x ${active.state.item} placed!`);
    } else {
      await ctx.reply("Order cancelled.");
    }
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
  }
});
```

### Group welcome message

```ts
// plugins/plugin-welcome
// match: all is safe because it only implements onJoin/onLeave
export default definePlugin({
  async onJoin(msg, ctx) {
    if (!msg.isGroup) return;
    await ctx.reply(`Welcome, ${msg.pushName ?? msg.from}!`);
  },
});
```

### Forwarding to an external LLM (n8n / OpenAI / Anthropic)

```ts
// plugins/plugin-ai — fallback (match: all) — keep it last in plugins/
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

## 10. WhatsApp notes (Baileys v7 / LID)

On WhatsApp, `msg.from` follows these rules:

- **Prefers LID** (Linked Identity) — more consistent across groups and survives phone-number changes.
- Falls back to PN (phone number) when the LID is not yet known.
- Always **domain-stripped** — plugins receive `"6281234567890"` or `"123456789"` (LID), never `"...@s.whatsapp.net"` or `"...@lid"`.

Additional fields when needed:

- `msg.phoneNumber` — E.164 phone number without `+` (when known).
- `msg.lid` — full LID `"xxxxx@lid"` (when known).
- `msg.addressingMode` — `"lid"` or `"pn"` (this chat's addressing mode).
- `msg.remoteJid` — raw remoteJid (advanced use cases only).

Plugins that aim to be **portable across platforms** should only use `msg.from`, `msg.pushName`, `msg.text`, `msg.media`.

---

## 11. Don'ts

- ❌ **Don't** import files from another plugin (`plugins/plugin-x/...`). Plugins must be self-contained. To share logic, put it in `core/helpers/` or make it an SDK utility.
- ❌ **Don't** touch `core/router.ts` or `core/loader.ts` for ordinary plugin features. Routing already handles every case via `match` + lifecycle hooks.
- ❌ **Don't** keep global state at module top level except per-process caches (rate limiter, health check). Never store user data there — use `ctx.helpers.session` or the DB.
- ❌ **Don't** call `createHealthCheck()` inside a hook — that spawns a new interval per message. Call it once at module top level.
- ❌ **Don't** forget to `await` every `ctx.reply()` / `ctx.helpers.*`. Everything is async.
- ❌ **Don't** use `msg.phoneNumber` as a primary key — on WA the same user can appear with no PN (LID-only addressing). `msg.from` is always present.
- ❌ **Don't** query another plugin's schema (`SELECT ... FROM other_plugin.table`) or add plugin migrations to `core/db/migrations/` — plugin tables live in their own schema via [§8](#8-plugins-with-their-own-postgresql-tables).

---

## 12. Checklist before committing a new plugin

- [ ] Folder `plugins/plugin-name/` with `plugin.json` + `index.ts`.
- [ ] `plugin.json` has `name`, `enabled: true`, `match`.
- [ ] `index.ts` `export default`s an object with at least one lifecycle hook.
- [ ] First reply within ~2 seconds (if longer, send a "hang on…" message first).
- [ ] Errors are `try/catch`ed — at minimum log via `ctx.log.error(...)`; never let the plugin fail silently.
- [ ] External I/O (fetch/DB) uses `retry()` + a timeout.
- [ ] npm dependencies: local `package.json` + `npm install` in the plugin folder.
- [ ] Own tables: migration in `migrations/` (correct filename format), all queries parameterized, no schema qualifiers in SQL.
- [ ] Manual test: send a trigger message, verify the bot replies as expected.
- [ ] `npm run typecheck` passes.

---

## 13. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Plugin never fires | `enabled: false`, wrong `match`, or another specific plugin matches first. |
| `middleware not found` warning at boot / error when the plugin matches | Name in `plugin.json` → `middleware` doesn't match a file in `middleware/`. No `.ts` suffix. |
| Group messages don't arrive | Check `msg.isGroup` & make sure the plugin doesn't filter on `groupId === null`. |
| The LLM (fallback) plugin catches messages a specific plugin should handle | Make sure the specific plugin implements the hook for that event — if the hook is missing, the router moves on to the next plugin. |
| `ctx.replyMedia` fails | Local file paths must be absolute or relative to the bot's CWD. URLs must be reachable from the bot's server. |
| Session lost between messages | Sessions are in-memory — gone on restart. For durable state, use the DB. |
| Plugin doesn't run + `migration failed` in the log | The SQL in `migrations/` errored — the plugin is excluded from routing at boot. Fix the file (don't rename applied ones), restart. |
| `relation "x" does not exist` in plugin queries | Migration hasn't run (newly enabled plugin? restart the bot) or the query uses a wrong schema qualifier — write plain table names. |

---

## 14. Quick reference

- Architecture & file layout: [CORE.md](CORE.md) §0
- Type definitions: [core/types.ts](../core/types.ts)
- SDK source: [core/plugin-sdk.ts](../core/plugin-sdk.ts)
- Router: [core/router.ts](../core/router.ts)
- Global middleware: [core/middleware/](../core/middleware/)
- Example plugins: [plugins/](../plugins/)
