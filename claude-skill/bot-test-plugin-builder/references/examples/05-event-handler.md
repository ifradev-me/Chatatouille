# Example: join/leave handler

Welcome / farewell messages when users join or leave a group.

## `plugin.json`

```json
{
  "name": "plugin-welcome",
  "enabled": true,
  "match": { "type": "all" }
}
```

## `index.ts`

```ts
import { definePlugin } from "../../core/plugin-sdk.js";

export default definePlugin({
  async onJoin(msg, ctx) {
    if (!msg.isGroup) return;  // defensive — group events always have isGroup=true
    const name = msg.pushName ?? msg.from;
    await ctx.reply(`Welcome, ${name}!`);
  },

  async onLeave(msg, ctx) {
    const name = msg.pushName ?? msg.from;
    await ctx.reply(`Goodbye, ${name}.`);
  },
});
```

## Platform notes

### WhatsApp

- `msg.pushName` is **always undefined** for join/leave events — Baileys doesn't include push names in `group-participants.update`. Fall back to `msg.from` (a LID/PN string).
- `msg.text` is `""`.
- `msg.raw` is the raw event object, NOT a WAMessage — the adapter handles this internally so `ctx.reply` works correctly.

### Telegram

- `msg.pushName` is populated (first name + last name, or username).
- `new_chat_members` and `left_chat_member` events trigger `onJoin` / `onLeave` respectively.
- For multiple members added at once, the adapter fires `onJoin` once per member.

## Why `match: all` is safe here

The router dispatches based on `msg.event`. Since this plugin only declares `onJoin` / `onLeave`, normal text messages (event `"message"`) bypass it — `getHook(plugin, "message")` returns undefined and the router moves on.

## NOT for first-contact welcome

This pattern is for **group events**. To greet a user the first time they DM the bot, use the global `welcome` middleware (already in core: `core/middleware/welcome.ts`) which flips a `welcomed` flag on the user row. Don't try to bolt that onto a plugin.
