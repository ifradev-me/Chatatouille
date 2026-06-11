# Example: regex command plugin

Single-shot regex-triggered command. Use when you need precise pattern matching (not fuzzy) — e.g., `/admin <action>`, `^echo .+`.

## `plugin.json`

```json
{
  "name": "plugin-echo",
  "enabled": true,
  "match": {
    "type": "regex",
    "values": ["^echo\\s+.+"]
  }
}
```

## `index.ts`

```ts
import { definePlugin } from "../../core/plugin-sdk.js";

export default definePlugin(async (msg, ctx) => {
  const payload = msg.text.replace(/^echo\s+/i, "").trim();
  if (!payload) return;  // belt-and-suspenders; regex already required content
  await ctx.reply(payload);
});
```

## Notes

- Regex matching is **case-insensitive** (`i` flag is added by the router).
- Multiple values are OR'd — first match wins:
  ```json
  "values": ["^echo\\s+.+", "^say\\s+.+"]
  ```
- For command-style triggers where users will typo (`echoo`, `eko`), consider `type: "keyword"` instead — fuzzy is more forgiving.
- The regex source is JSON-escaped: `\s` → `\\s`, `\d` → `\\d`, etc.

## When to choose regex over keyword

| Want | Choose |
|---|---|
| Tolerant trigger word, optional arguments | `keyword` (fuzzy, lower threshold) |
| Strict command syntax `/cmd arg arg` | `regex` |
| Pattern extraction from start of message | `regex` |
| FAQ-style "any mention of word X" | `keyword` |
