# `plugin.json` — manifest schema

Every plugin needs a `plugin.json` at the root of its folder.

## Required fields

| Field | Type | Notes |
|---|---|---|
| `name` | string | Plugin identifier. **Must match the folder name.** Convention: `plugin-<purpose>` in kebab-case. |
| `enabled` | boolean | `false` → loader skips the plugin entirely. |
| `match` | object | When the plugin's `handle` hook fires. See below. |

## Optional fields

| Field | Type | Notes |
|---|---|---|
| `platforms` | `string[]` | Whitelist. Subset of `["whatsapp", "telegram", "discord"]`. Absent → all platforms. Empty array `[]` → never runs (loader logs a warning). |
| `middleware` | `string[]` | Local middleware file names (without `.ts`). Files live in `<plugin>/middleware/`. Run in array order before the hook. |
| `response` | `{ "type": "static" \| "dynamic" \| "llm" }` | Informational only — core does not use this. |

## `match` object

```json
{
  "type": "keyword" | "regex" | "all",
  "values": ["..."],
  "threshold": 0.6
}
```

- `type` — selects routing strategy:
  - `keyword` → **fuzzy** match via dice coefficient. Token-wise. Trigger fires when any token in `msg.text` matches any value at or above `threshold`.
  - `regex` → exact regex match (case-insensitive) against `msg.text`.
  - `all` → always matches. Only use with event-only hooks (`onMedia`, `onJoin`, `onLeave`); a `handle` hook with `match.type: "all"` becomes the fallback for unhandled text messages.
  - `intent` → **reserved**, currently not implemented. Manifests using this are silently skipped at runtime. Don't generate this type.
- `values` — required when `type` is `keyword` or `regex`. Array of strings. Lowercased internally for keyword matching.
- `threshold` — optional, only meaningful when `type: "keyword"`. Float in `[0, 1]`. Default 0.6. Lower = more permissive (typos tolerated), higher = stricter.

## Routing order in the bot's router

When a message arrives, the bot runs these stages in order:

1. Global middleware (logger → ratelimit → auth → welcome)
2. **Conversation lock** — if the user is mid-flow, dispatch to the flow's owner plugin, bypassing matching.
3. **Fuzzy keyword** (centralized) — winner of `sortMatch()` across all `type: "keyword"` plugins.
4. **Regex + all** loop — first plugin whose match returns true wins.

The plugin builder skill should be aware: `match.type: "keyword"` plugins compete in a global fuzzy contest, so threshold tuning matters when multiple keyword plugins share similar words.

## Validation rules (used by `scripts/validate_plugin_json.py`)

| Rule | Failure message |
|---|---|
| `name` is non-empty kebab-case | `name must be non-empty kebab-case (lowercase, dashes)` |
| `enabled` is boolean | `enabled must be true or false` |
| `match.type` ∈ {keyword, regex, all, intent} | `match.type must be keyword/regex/all (intent is reserved)` |
| `match.values` is non-empty array when type ∈ {keyword, regex} | `match.values required for keyword/regex` |
| `match.threshold` ∈ [0, 1] when present | `threshold must be between 0 and 1` |
| `platforms` (if present) is subset of known | `platforms contains unknown value: <x>` |
| `middleware` files exist in `middleware/` | `middleware "<name>" not found` |

Folder name = `name` field is **enforced** — mismatch is a hard error.

## Example manifests

```json
// Keyword plugin (FAQ)
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

```json
// Fuzzy keyword with custom threshold
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

```json
// Regex command
{
  "name": "plugin-track",
  "enabled": true,
  "match": {
    "type": "regex",
    "values": ["^track\\s+\\w+"]
  }
}
```

```json
// Event-only welcome
{
  "name": "plugin-welcome",
  "enabled": true,
  "match": { "type": "all" }
}
```

```json
// Platform-scoped, with middleware
{
  "name": "plugin-admin",
  "enabled": true,
  "platforms": ["whatsapp"],
  "match": { "type": "regex", "values": ["^/admin\\s"] },
  "middleware": ["isAdmin"]
}
```
