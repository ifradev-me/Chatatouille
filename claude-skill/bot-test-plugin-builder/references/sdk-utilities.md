# `core/plugin-sdk.ts` utilities

Import what you need:

```ts
import {
  definePlugin,
  match,
  formatMessage,
  retry,
  createRateLimit,
  createHealthCheck,
  checkHealth,
  createPluginDb,   // plugin-owned Postgres — see plugin-database.md
} from "../../core/plugin-sdk.js";
```

## `definePlugin(impl)`

Wraps a plugin object or a single function, validates it has at least one hook, returns a `PluginDef`.

```ts
// Function-style: auto-wrapped to { handle: fn }
export default definePlugin(async (msg, ctx) => {
  await ctx.reply("hi");
});

// Object-style: explicit hooks
export default definePlugin({
  async handle(msg, ctx)  { /* ... */ },
  async onMedia(msg, ctx) { /* ... */ },
});
```

If neither `handle` / `onMedia` / `onJoin` / `onLeave` is present, throws at load.

## `match(a, b, threshold=0.6)`

Fuzzy boolean check using dice coefficient. Use for branch logic inside the plugin (NOT for triggering — that's `match.type: "keyword"` in plugin.json).

```ts
if (match(msg.text, "ya"))      { /* yes */ }
if (match(msg.text, "batal"))   { /* cancel */ }
if (match(msg.text, "tidak"))   { /* no */ }
```

Both strings lowercased internally. Returns `false` if either is empty.

## `formatMessage(template, vars)`

`{{ name }}` placeholder substitution.

```ts
formatMessage("Hi {{ name }}, your order is #{{ id }}.", {
  name: msg.pushName ?? "friend",
  id: order.id,
});
// → "Hi Ifrad, your order is #abc-123."
```

Unknown keys are left as `{{ key }}` (visible — helps catch typos).

## `retry(fn, times=3)`

Exponential backoff (200ms → 400ms → 800ms → ...). Use for network calls.

```ts
const res = await retry(async () => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}, 3);
```

Throws the last error if all attempts fail.

## `createRateLimit(max, windowMs)`

Returns a per-key gate function.

```ts
const limiter = createRateLimit(5, 60_000); // 5/minute per key

if (!limiter(msg.from)) {
  await ctx.reply("Too many requests.");
  return;
}
```

Independent from the global `ratelimit` middleware. Use for plugin-specific quotas (e.g., LLM call cost, expensive computation).

> Module-level state — instantiate **once** at the top of `index.ts`, not inside the hook.

## `createHealthCheck(url, intervalMs=30_000)`

Returns `() => boolean` that reflects last HEAD probe result. Background timer; `unref`'d so it doesn't block shutdown.

```ts
const isHealthy = createHealthCheck("https://api.example.com/health");

export default definePlugin(async (msg, ctx) => {
  if (!isHealthy()) {
    await ctx.reply("Service offline.");
    return;
  }
  // ...
});
```

> Module-level — call **once** outside the hook.

## `checkHealth(url)`

One-shot async HEAD check. Returns `Promise<boolean>`. Use when you need a single fresh probe and don't want a background timer.

```ts
if (!(await checkHealth(process.env.API_URL!))) {
  await ctx.reply("Service offline.");
  return;
}
```

## `createPluginDb(import.meta)`

Plugin-owned PostgreSQL: isolated schema + migrations in the plugin folder. Full guide: `plugin-database.md`. Call **once** at module top level (pool is lazy).

## Anti-patterns

- ❌ Calling `createHealthCheck` inside a hook → spawns a new timer every message.
- ❌ Calling `createRateLimit` inside a hook → resets the counter every message.
- ❌ Calling `createPluginDb` inside a hook → call it once at module top level.
- ❌ Calling `match(a, b)` to decide routing — that's the router's job. Use it only for in-hook branching.
- ❌ Awaiting `retry()` with no upper bound — `times` ≤ 5 is reasonable.
