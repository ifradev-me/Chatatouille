# `Ctx` — toolbox available inside hooks

```ts
interface Ctx {
  platform: "whatsapp" | "telegram" | "discord";
  reply(text: string): Promise<void>;
  replyMedia(url: string, caption?: string): Promise<void>;
  db: DbClient;
  config: Config;
  log: Logger;                     // pino-style: log.info(obj, "msg")
  helpers: {
    user: UserHelpers;
    history: HistoryHelpers;
    session: SessionHelpers;
    conversation: ConversationHelpers;
  };
  stop(): void;                    // halt middleware chain
  stopped: boolean;
  matched?: { keyword: string; score: number };  // set by router on fuzzy hit
}
```

## `ctx.reply` & `ctx.replyMedia`

```ts
await ctx.reply("Hello!");
await ctx.replyMedia("/tmp/photo.jpg", "Caption here");  // local path or URL
```

Both are async. Always `await` them — if you don't, the reply queues against following work and ordering breaks.

## `ctx.helpers.user` — per-platform CRUD

```ts
// All methods require (from, platform). Pass ctx.platform or msg.platform.
await ctx.helpers.user.findOrCreate(msg.from, ctx.platform, { name: msg.pushName });
await ctx.helpers.user.find(msg.from, ctx.platform);
await ctx.helpers.user.update(msg.from, ctx.platform, { name: "New" });
await ctx.helpers.user.ban(msg.from, ctx.platform);
await ctx.helpers.user.isBanned(msg.from, ctx.platform);
```

The `auth` global middleware already calls `findOrCreate` before the plugin runs, so the user is guaranteed to exist by the time your hook fires.

## `ctx.helpers.history` — per-platform conversation log

```ts
await ctx.helpers.history.append(msg, "user");
await ctx.helpers.history.append(msg, "bot", "the reply text");
const recent = await ctx.helpers.history.get(msg.from, ctx.platform, { limit: 10 });
await ctx.helpers.history.clear(msg.from, ctx.platform);
```

`append` reads `msg.platform` automatically. `get` and `clear` require explicit `(from, platform)`.

## `ctx.helpers.session` — in-memory state with TTL

```ts
ctx.helpers.session.set(msg.from, { step: "x", item: "y" }, 60_000);  // TTL 60s
const state = ctx.helpers.session.get<{ step: string; item: string }>(msg.from);
ctx.helpers.session.clear(msg.from);
ctx.helpers.session.has(msg.from);
```

Lost on bot restart. For durable state, use DB.

> For multi-step flows, prefer `helpers.conversation` over raw `helpers.session` — see `conversation-flow.md`.

## `ctx.helpers.conversation` — multi-step flow lock

Used to lock the router to a single plugin during a flow. See `conversation-flow.md` for the full API.

## `ctx.matched` — fuzzy hit metadata

When the router triggers a plugin via fuzzy keyword match, `ctx.matched` is populated:

```ts
{ keyword: "price", score: 0.78 }
```

Branch on `ctx.matched?.keyword` (NOT on `msg.text.includes(...)`) for FAQ-style plugins — `includes` misses typos that the router accepted.

## `ctx.db.save(collection, data)` — generic ad-hoc storage

```ts
const order = await ctx.db.save("orders", { from: msg.from, item: "kopi", qty: 2 });
// order.id is a UUID; row stored in `events` table with collection="orders"
```

For real typed tables, the plugin can own its migrations and Postgres schema via `createPluginDb` — see `plugin-database.md`.

## `ctx.log` — structured logging

```ts
ctx.log.debug({ x: 1 }, "checking");
ctx.log.info({ orderId: order.id }, "order created");
ctx.log.warn({ from: msg.from }, "rate limited");
ctx.log.error({ err: e.message }, "external API failed");
```

Pino-style: first arg is structured fields, second is the message.

## `ctx.stop()` — used in middleware, not in hooks

`stop()` halts the rest of the middleware chain. In a hook (`handle`/`onMedia`/etc.) it has no effect on the current hook — `await` ends execution naturally. Use only in middleware files.
