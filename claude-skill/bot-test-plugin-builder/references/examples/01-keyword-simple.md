# Example: keyword FAQ plugin

Single-shot replies based on which keyword the router matched. Branches via `ctx.matched.keyword` — NOT `msg.text.includes(...)`, because the router uses fuzzy matching and typos must still hit the right branch.

## `plugin.json`

```json
{
  "name": "plugin-faq",
  "enabled": true,
  "match": {
    "type": "keyword",
    "values": ["price", "shipping", "stock"],
    "threshold": 0.6
  }
}
```

## `index.ts`

```ts
import type { PluginDef } from "../../core/types.js";

const faq: PluginDef = {
  async handle(msg, ctx) {
    switch (ctx.matched?.keyword) {
      case "price":
        await ctx.reply("Our prices start at $10.");
        return;
      case "shipping":
        await ctx.reply("Free shipping on orders over $50.");
        return;
      case "stock":
        await ctx.reply("Stock updates daily. Tell me the product name.");
        return;
      default:
        // Defensive — should not happen since router only dispatches on fuzzy hit.
        ctx.log.warn({ text: msg.text }, "[plugin-faq] dispatched without ctx.matched");
    }
  },
};

export default faq;
```

## Why `ctx.matched`?

- User types `"prce"` (typo) → router fuzzy-matches `"price"` → `ctx.matched.keyword === "price"`.
- Branching on `msg.text.includes("price")` would return `false` for `"prce"` → plugin replies nothing.

## Threshold tuning

- 0.6 (default): tolerant — `"prce"`, `"hrga"` pass.
- 0.7+: strict — only obvious matches.
- 0.5: very tolerant — risks false positives across keywords.
