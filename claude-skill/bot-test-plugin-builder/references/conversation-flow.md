# Multi-step conversation flow

For wizards, order forms, surveys — anything requiring multiple back-and-forth turns with the same user.

## How it works

When a plugin calls `conversation.enter(...)`, the **router locks** all subsequent messages from that `(user, platform)` to the owner plugin. Other plugins are bypassed until the flow exits.

State is keyed by `${platform}:${from}` — meaning:
- Same user on WhatsApp vs Telegram = two separate flows.
- Only **one flow per user per platform** active at a time.

## API

```ts
ctx.helpers.conversation.enter(
  from: string,
  platform: Platform,
  pluginName: string,
  state: unknown,
  ttlMs: number,                  // REQUIRED — no infinite flows
  opts?: { force?: boolean }      // force=true overrides an existing flow (admin)
): void;

ctx.helpers.conversation.update(
  from: string,
  platform: Platform,
  state: unknown                  // TTL is NOT reset
): void;

ctx.helpers.conversation.current<T>(
  from: string,
  platform: Platform
): { plugin: string; state: T } | null;

ctx.helpers.conversation.exit(from: string, platform: Platform): void;
```

## Standard plugin shape (single hook handles all states)

```ts
type FlowState =
  | { step: "ask_a"; ... }
  | { step: "ask_b"; ... }
  | { step: "confirm"; ... };

export default definePlugin(async (msg, ctx) => {
  const active = ctx.helpers.conversation.current<FlowState>(msg.from, ctx.platform);

  // Universal cancel.
  if (active && (match(msg.text, "batal") || msg.text.toLowerCase() === "/cancel")) {
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
    await ctx.reply("Cancelled.");
    return;
  }

  // Entry path (no flow yet) — initial trigger via match config.
  if (!active) {
    ctx.helpers.conversation.enter(
      msg.from, ctx.platform, "<plugin-name>",
      { step: "ask_a", ... } satisfies FlowState,
      5 * 60_000, // 5 minute TTL
    );
    await ctx.reply("First question?");
    return;
  }

  // Branch per step.
  if (active.state.step === "ask_a") { ... }
  if (active.state.step === "ask_b") { ... }
  if (active.state.step === "confirm") {
    // ...do final action...
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
  }
});
```

## Conventions

1. **Cancel keyword**: every flow plugin handles `"batal"` (fuzzy, via `match()`) and `"/cancel"` (literal) → `exit()`. The skill should always include this branch.
2. **TTL**: 5 minutes (`5 * 60_000`) is the standard for short forms. Long-running flows (questionnaires) up to 30 minutes. Never infinite.
3. **State shape**: prefer discriminated union (`step: "x" | "y"`) — TypeScript narrows correctly in `if` branches.
4. **Re-entry**: if the user triggers the flow keyword again while already in a flow, decide: silently update state, ignore, or re-enter with `{ force: true }`. Default: ignore (`enter()` without force is a no-op when a flow exists).
5. **Force override** = admin use case (one plugin needs to kick another out). Rarely used.

## Caveats

- `update()` does **not** reset TTL. If the flow has many steps, set TTL generously at `enter()` time, or call `enter(..., force: true)` to refresh.
- Flow state is **in-memory** in the bot process — lost on restart. For durable progress (e.g., committing the order to DB), call `ctx.db.save(...)` along the way and treat session state as transient UI state.
- `match: { type: "all" }` plugins **cannot** trigger entry via plain matching — they're fallbacks. Use `keyword` or `regex` for the trigger word.
