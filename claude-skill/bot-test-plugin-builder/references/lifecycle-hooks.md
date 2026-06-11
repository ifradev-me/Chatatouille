# Lifecycle hooks & `Msg` shape

Every plugin exports a default object with one or more lifecycle hooks. The router dispatches based on `msg.event`.

## The hooks

| Hook | Triggered by | `msg.event` |
|---|---|---|
| `handle` | Text message arrives | `"message"` |
| `onMedia` | Media (image/video/file/audio) arrives | `"media"` |
| `onJoin` | User joins a group | `"join"` |
| `onLeave` | User leaves a group | `"leave"` |

A plugin only implements the hooks it cares about. If a plugin has `match.type: "all"` but only `onMedia`, normal text messages never reach it — the router's `getHook()` returns undefined and the loop continues to the next plugin.

## Signature

```ts
(msg: Msg, ctx: Ctx) => Promise<void>
```

Both arguments mandatory. Plugins should not throw — wrap risky calls in try/catch and `ctx.log.error()` instead. Router does have a safety try/catch but plugin-level handling produces better messages.

## `Msg` shape

```ts
interface Msg {
  id: string;                  // platform-unique
  platform: "whatsapp" | "telegram" | "discord";
  from: string;                // stable per-platform identifier
  phoneNumber?: string;        // WA only, E.164 without "+"
  lid?: string;                // WA only, "xxxxx@lid"
  addressingMode?: "lid" | "pn"; // WA only
  remoteJid?: string;          // adapter-internal (do not use directly)
  pushName?: string;           // display name from platform (undefined on join/leave events for WA)
  groupId: string | null;      // null in private chats
  isGroup: boolean;
  fromMe: boolean;             // bot's own messages already filtered by middleware
  text: string;                // "" for media/join/leave events
  media: { type: "image" | "video" | "file" | "audio"; url: string; mimeType?: string } | null;
  event: "message" | "media" | "join" | "leave";
  timestamp: number;           // unix ms
  raw: unknown;                // platform-specific original (escape hatch)
}
```

## Identity rules (cross-platform)

- **`msg.from` is the only stable identifier.** Always use it as the primary key for DB lookups, sessions, history, conversation state.
- **Do NOT use `msg.phoneNumber` as a primary key.** On WA, a user can appear with PN missing (LID-only addressing). On Telegram and Discord it's not populated.
- Users are namespaced **per platform**. `helpers.user.find(msg.from, msg.platform)` — same `from` on WA vs Telegram = two different users.

## Platform-specific notes

### WhatsApp (Baileys v7)

- `from` prefers LID over PN. Strip domain (`@lid` / `@s.whatsapp.net`) is done by the adapter.
- For `onJoin` / `onLeave`: `pushName` is **always undefined** (event doesn't carry it). Fall back to `msg.from`.
- `msg.raw` on join/leave is the group-participants event object, NOT a WAMessage.

### Telegram (grammy)

- `from` is the numeric user ID as a string.
- `pushName` = display name (first + last, or username fallback).
- `msg.raw` is the grammy `Message` object (or the update object on join/leave).

## Hooks vs. `match.type` compatibility

| `match.type` | Hooks that make sense |
|---|---|
| `keyword` | `handle` |
| `regex` | `handle` |
| `all` | `onMedia`, `onJoin`, `onLeave` (and `handle` for fallback purposes) |

`match: { type: "all" }` plugins with `handle` will catch everything that no specific plugin matched — they're the fallback layer (typical use: LLM plugin).
