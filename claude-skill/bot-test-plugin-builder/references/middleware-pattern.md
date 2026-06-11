# Local middleware

A plugin can have its own middleware that runs **before** its hook fires. Different from **global middleware** (logger/ratelimit/auth/welcome) which runs for every message regardless of plugin.

Local middleware is good for: format validation, plugin-specific quota, admin checks, parameter parsing, etc.

## File layout

```
plugins/plugin-foo/
├── plugin.json
├── index.ts
└── middleware/
    ├── validateFormat.ts
    └── isAdmin.ts
```

## Wire it in `plugin.json`

```json
{
  "name": "plugin-foo",
  "enabled": true,
  "match": { "type": "regex", "values": ["^/admin\\s"] },
  "middleware": ["isAdmin", "validateFormat"]
}
```

Order in the array = execution order. After all middleware passes, the hook runs.

## Signature

```ts
import type { MiddlewareFn } from "../../../core/types.js";

const isAdmin: MiddlewareFn = async (msg, ctx) => {
  const ADMINS = ["628xxx", "628yyy"];
  if (!ADMINS.includes(msg.from)) {
    await ctx.reply("Admin only.");
    ctx.stop();           // halts chain — hook does NOT run
  }
};

export default isAdmin;
```

`MiddlewareFn = (msg: Msg, ctx: Ctx) => Promise<void>`.

## Behavior

- Middleware runs in array order: `[a, b, c]` → a, then b, then c, then hook.
- Calling `ctx.stop()` sets `ctx.stopped = true`. The router checks after each middleware:
  ```ts
  for (const mw of plugin.middleware ?? []) {
    await mw(msg, ctx);
    if (ctx.stopped) return;     // hook is skipped
  }
  ```
- Middleware can `await ctx.reply(...)` before stopping — that's the standard pattern for error messages.
- Middleware should **not** read or modify `ctx.matched` — that's set by the router before middleware runs and is the plugin's view of the routing decision.

## Generating middleware in this skill

When the user requests middleware, ask:
- Name (kebab or camelCase — file will be `<name>.ts`)
- Purpose in one line (used as the file's top comment)
- Should it `ctx.stop()` on failure (default yes) or just log?

Generate from `templates/middleware.ts.tmpl`, place in `<plugin>/middleware/<name>.ts`, add the name (without `.ts`) to `plugin.json` → `middleware` array.

## Common patterns

```ts
// Format validation
const validateFormat: MiddlewareFn = async (msg, ctx) => {
  const after = msg.text.replace(/^order\s+/i, "").trim();
  if (!after) {
    await ctx.reply("Format: order <item>");
    ctx.stop();
  }
};
```

```ts
// Per-plugin rate limit (different from global ratelimit)
import { createRateLimit } from "../../../core/plugin-sdk.js";
const limiter = createRateLimit(3, 60_000);  // 3/minute per user
const quota: MiddlewareFn = async (msg, ctx) => {
  if (!limiter(msg.from)) {
    await ctx.reply("Slow down.");
    ctx.stop();
  }
};
```

```ts
// Admin whitelist
const isAdmin: MiddlewareFn = async (msg, ctx) => {
  const admins = (process.env.ADMINS ?? "").split(",");
  if (!admins.includes(msg.from)) {
    ctx.log.warn({ from: msg.from }, "non-admin tried admin command");
    ctx.stop();   // silent — don't tell non-admin the command exists
  }
};
```
