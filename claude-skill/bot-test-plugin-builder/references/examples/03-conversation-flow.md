# Example: multi-step conversation flow

Order flow: trigger → ask item (if missing) → ask quantity → confirm → save.

## `plugin.json`

```json
{
  "name": "plugin-order",
  "enabled": true,
  "match": {
    "type": "keyword",
    "values": ["order", "pesan"],
    "threshold": 0.55
  }
}
```

> Threshold 0.55 so common typos like `"ordr"`, `"oder"`, `"pesn"` still trigger.

## `index.ts`

```ts
import { definePlugin, createRateLimit, formatMessage, match } from "../../core/plugin-sdk.js";

const limiter = createRateLimit(5, 60_000);

type OrderState =
  | { step: "ask_item" }
  | { step: "ask_qty"; item: string }
  | { step: "confirm"; item: string; qty: number };

const TTL_MS = 5 * 60_000;
const TRIGGERS = ["order", "pesan"];

// Strip leading trigger word (fuzzy-tolerant).
function extractItem(text: string): string {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length === 0) return "";
  if (TRIGGERS.some((t) => match(tokens[0], t, 0.55))) {
    return tokens.slice(1).join(" ").trim();
  }
  return text.trim();
}

export default definePlugin(async (msg, ctx) => {
  const active = ctx.helpers.conversation.current<OrderState>(msg.from, ctx.platform);

  // Universal cancel.
  if (active && (match(msg.text, "batal") || msg.text.toLowerCase() === "/cancel")) {
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
    await ctx.reply("Order cancelled.");
    return;
  }

  // Entry.
  if (!active) {
    if (!limiter(msg.from)) {
      await ctx.reply("Too many requests. Try again in a minute.");
      return;
    }
    const item = extractItem(msg.text);
    if (!item) {
      ctx.helpers.conversation.enter(
        msg.from, ctx.platform, "plugin-order",
        { step: "ask_item" } satisfies OrderState,
        TTL_MS,
      );
      await ctx.reply("What would you like to order?");
      return;
    }
    ctx.helpers.conversation.enter(
      msg.from, ctx.platform, "plugin-order",
      { step: "ask_qty", item } satisfies OrderState,
      TTL_MS,
    );
    await ctx.reply(`Got "${item}". How many?`);
    return;
  }

  if (active.state.step === "ask_item") {
    const item = msg.text.trim();
    if (!item) {
      await ctx.reply("Item name cannot be empty.");
      return;
    }
    ctx.helpers.conversation.update(
      msg.from, ctx.platform,
      { step: "ask_qty", item } satisfies OrderState,
    );
    await ctx.reply(`Got "${item}". How many?`);
    return;
  }

  if (active.state.step === "ask_qty") {
    const qty = parseInt(msg.text, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      await ctx.reply("Quantity must be a positive number.");
      return;
    }
    ctx.helpers.conversation.update(
      msg.from, ctx.platform,
      { step: "confirm", item: active.state.item, qty } satisfies OrderState,
    );
    await ctx.reply(`Confirm ${qty}× ${active.state.item}? (yes / no)`);
    return;
  }

  if (active.state.step === "confirm") {
    if (match(msg.text, "yes") || match(msg.text, "ya")) {
      const order = await ctx.db.save("orders", {
        from: msg.from,
        platform: ctx.platform,
        item: active.state.item,
        qty: active.state.qty,
      });
      await ctx.reply(
        formatMessage("Order #{{ id }} placed: {{ qty }}× {{ item }}.", {
          id: String(order.id).slice(0, 8),
          qty: active.state.qty,
          item: active.state.item,
        }),
      );
    } else {
      await ctx.reply("Order cancelled.");
    }
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
  }
});
```

## Key points

- **Single hook** (`handle`) covers all steps — branched by `active.state.step`.
- **Universal cancel** at the top — handled regardless of step.
- **Rate limit at entry only** — once in flow, the user can take their time.
- **TTL** (5 min) — flow auto-expires if user goes idle.
- **`db.save("orders", ...)`** — generic JSONB storage in the `events` table. For a typed `orders` schema, the user would add a migration (out of skill scope).
