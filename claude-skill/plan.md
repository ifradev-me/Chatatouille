# Plan — `bot-test-plugin-builder` Claude Skill

> **Tujuan**: skill yang di-upload ke claude.ai (web app). Ketika user request "bikin plugin untuk bot-test", skill ini pandu mereka end-to-end: specification → plan → file generation → automated tests → tar.gz siap drop ke `plugins/`.

---

## 1. Metadata

```yaml
name: bot-test-plugin-builder
description: |
  Scaffolds a complete plugin for the bot-test framework (a multi-platform
  modular WhatsApp/Telegram bot with hot-pluggable handlers). Use this skill
  when the user wants to create, scaffold, generate, or build a new plugin
  for bot-test. Asks targeted specs, drafts plan.md for approval, generates
  plugin.json + TypeScript handler + optional middleware, runs Python-based
  validation + routing simulation tests, and packages everything as a tarball
  ready to drop into the bot's `plugins/` directory.
version: 0.1.0
```

`description` is the routing signal — must mention WHAT (scaffold bot-test plugin) and WHEN (user wants to create/build a plugin for bot-test).

---

## 2. File layout

```
bot-test-plugin-builder/
├── SKILL.md                         # entry point — short procedure + routing
├── references/
│   ├── plugin-format.md             # plugin.json schema, all fields incl. platforms[], match.threshold
│   ├── lifecycle-hooks.md           # handle/onMedia/onJoin/onLeave + Msg shape (incl. WA quirks)
│   ├── ctx-api.md                   # ctx.reply, ctx.helpers.{user,history,session,conversation}, ctx.matched
│   ├── conversation-flow.md         # multi-step pattern, TTL, force, cancel convention
│   ├── middleware-pattern.md        # local middleware: file + plugin.json wiring
│   ├── sdk-utilities.md             # definePlugin, match, retry, formatMessage, createRateLimit, createHealthCheck
│   └── examples/
│       ├── 01-keyword-simple.md     # FAQ-style (ctx.matched switch)
│       ├── 02-regex-simple.md       # command-style regex
│       ├── 03-conversation-flow.md  # order multi-step
│       ├── 04-media-handler.md      # onMedia
│       └── 05-event-handler.md      # onJoin/onLeave welcome
├── scripts/
│   ├── validate_plugin_json.py      # JSON schema validation (pure stdlib)
│   ├── parse_index_ts.py            # static analysis: default export + hooks declared
│   ├── sim_router.py                # mock router: keyword fuzzy + regex + conv lock; runs scenarios
│   └── package_tarball.py           # tar.gz of plugin folder, strips dev artifacts
├── templates/
│   ├── plugin.json.tmpl
│   ├── index-keyword.ts.tmpl
│   ├── index-regex.ts.tmpl
│   ├── index-conversation.ts.tmpl
│   ├── index-media.ts.tmpl
│   ├── index-event.ts.tmpl
│   └── middleware.ts.tmpl
└── tests/
    ├── README.md                    # how to run: `python -m pytest tests/`
    ├── conftest.py                  # shared fixtures (tmp workspace, sample manifests)
    ├── test_validate_plugin_json.py # schema validator: pass/fail cases
    ├── test_parse_index_ts.py       # static parser: detects missing default export, mismatched hooks
    ├── test_sim_router.py           # mock router scenarios for each template
    ├── test_templates_render.py     # template substitution produces valid output
    ├── test_package_tarball.py      # tarball builds, contains expected files, excludes dev artifacts
    └── fixtures/                    # tiny sample plugin folders for tests to consume
        ├── valid-keyword/
        ├── valid-conversation/
        ├── invalid-missing-name/
        └── invalid-bad-threshold/
```

All `.tmpl` files use plain `{{ placeholder }}` syntax — substituted via Python `str.replace` (no Jinja2 dependency).

Tests live **inside** the skill folder so they ship in the tarball — anyone who extracts the skill can re-run `pytest tests/` to verify integrity.

---

## 3. Skill workflow (what `SKILL.md` instructs Claude to do)

Procedural, 7 steps:

1. **Confirm environment**: claude.ai sandbox with code_execution tool. No filesystem outside workspace.

2. **Interview user** (up to 4 questions via clarification message, not all at once — sequential as info emerges):
   - Plugin name & purpose (1-line)
   - Trigger: keyword fuzzy (with values), regex, fallback `all`, or event-only (onJoin/onLeave/onMedia)
   - Behavior: single-shot reply OR multi-step conversation flow (asks for step list)
   - Optional: local middleware? npm deps? platform whitelist?

3. **Draft `plan.md`** in workspace describing the to-be-generated plugin. Include:
   - Plugin name + folder
   - Manifest content (match config, platforms, middleware references)
   - Hook surface (which lifecycle hooks)
   - State machine sketch (if conversation flow)
   - File list
   - Test scenarios that will be run

   Show plan.md inline. Stop and wait for explicit user approval. If the user
   requests changes, revise plan.md, re-present, and wait again — loop until
   approved.

4. **Generate files** on approval:
   - Pick appropriate template per trigger/behavior combo
   - Substitute placeholders
   - Write to workspace at `<plugin-name>/`

5. **Run tests** via `scripts/*.py`:
   - `validate_plugin_json.py <path>` — checks: `name` matches folder, `enabled` boolean, `match.type` in enum, `values` array for keyword/regex, `threshold` in [0,1], `platforms` subset of {whatsapp,telegram,discord}, middleware filenames exist (if declared).
   - `parse_index_ts.py <path>` — regex-based static check: file has `export default`, declares hooks matching the match.type (e.g. keyword/regex/all + `handle` for "message"; `all` + `onMedia` for media-only).
   - `sim_router.py <path>` — instantiates a Python mock of the router. Feeds synthetic `Msg` objects from test scenarios (defined in plan.md by Claude). Asserts which hook ran + reply text patterns (case-insensitive contains).
   - Report pass/fail summary to user.
   - On failure: fix the generated files and re-run (bounded loop, max 3 attempts; then stop and consult the user). Packaging never happens with failing tests.

6. **Package**: `package_tarball.py <plugin-folder>` → writes `<plugin-name>.tar.gz` in workspace.

7. **Deliver**: response includes:
   - Tarball reference (claude.ai user can download from artifact)
   - Extraction instructions: `tar -xzf <name>.tar.gz -C bot-test/plugins/`
   - Restart command: `npm run dev`
   - Caveat list: TypeScript compilation only verified locally, npm deps need install if listed

---

## 4. Templates — what each generates

| Template | Use case | Hooks |
|---|---|---|
| `index-keyword.ts.tmpl` | FAQ / keyword reply | `handle` with `switch (ctx.matched?.keyword)` |
| `index-regex.ts.tmpl` | Command-style trigger | `handle` with regex extract |
| `index-conversation.ts.tmpl` | Multi-step wizard | `handle` with conversation flow, cancel, steps |
| `index-media.ts.tmpl` | Image/video/audio processor | `onMedia` only, match: all |
| `index-event.ts.tmpl` | Welcome/farewell | `onJoin`/`onLeave` only, match: all |
| `middleware.ts.tmpl` | Local middleware | `MiddlewareFn` skeleton |

All templates use `definePlugin` from SDK + pull types from `../../core/types.js` (relative to bot's `plugins/` location). They cite `ctx.helpers.user.findOrCreate(msg.from, ctx.platform)` style (per-platform) — matching the latest core API.

---

## 5. Test design (skill's internal test suite — runs in claude.ai sandbox)

**Why Python?** claude.ai sandbox is Python-first; no Node/tsc available. We validate STRUCTURE and SIMULATE routing logic — actual TS compilation happens when user runs the bot locally.

**Tests covered:**

| Test | Validates |
|---|---|
| `validate_plugin_json.py` | Manifest schema, value ranges, platform names, threshold in range, internal consistency (e.g., values[] required when type=keyword/regex). |
| `parse_index_ts.py` | `export default` present; hooks declared consistent with `match.type` (e.g., keyword/regex → `handle`); no obvious syntax errors via brace matching; references to `ctx.helpers.*` use new `(from, platform)` signature. |
| `sim_router.py` | Mocks router: global middleware order, conversation lock priority, fuzzy keyword winner, regex iteration, fallback `all`. Uses `difflib.SequenceMatcher` as cheap dice approximation. Conversation state machine simulated per step. |

**Scenarios per template:**

- Keyword: positive trigger ("harga"), positive typo ("hrga" → still hits at threshold 0.6), negative ("xyz" → no match).
- Regex: positive ("order ayam"), negative ("xyz"), edge (empty after strip).
- Conversation: entry → ask_qty (valid number) → confirm → exit. Cancel branch. TTL expiry skipped (out of scope).
- Media: image msg event → onMedia fires; text msg → ignored.
- Event: join event → onJoin fires.

---

## 6. Limitations communicated to user

The skill's final delivery message must explicitly state:

1. **No TypeScript compile** in sandbox. Use `npm run typecheck` locally to catch type errors.
2. **No npm install**. If `package.json` is generated for plugin-local deps, user must `cd plugins/<name> && npm install` after extracting.
3. **No live WhatsApp test**. Test suite simulates routing only — actual behavior depends on Baileys + database state.
4. **Skill is version-pinned** to bot-test core API as of 2026-05. If `core/types.ts` evolves (new helpers, signature changes), the skill must be regenerated.

---

## 7. Out of scope (intentionally not in this skill)

- Auto-uploading the plugin to a remote repo.
- Modifying any `core/*` file.
- Generating tests for the user's plugin to ship (separate concern).
- Database migrations from plugin (plugin uses `ctx.db.save("orders", ...)` generic path; bespoke schema = user adds migration manually).
- Push notification API (#7 in ROADMAP — future).

---

## 8. Delivery acceptance (what "done" looks like)

- `claude-skill/bot-test-plugin-builder/` folder exists with all files in §2.
- `bot-test-plugin-builder/tests/` covers happy paths for each template + at least 1 failure scenario per validator.
- All tests pass when run with `cd claude-skill/bot-test-plugin-builder && python -m pytest tests/`.
- `claude-skill/bot-test-plugin-builder.tar.gz` is produced by running the skill's own `package_tarball.py` on its folder (self-packaging sanity check). The tarball **includes** `tests/` so anyone extracting can re-verify.
- This `plan.md` is preserved alongside as design record (NOT inside the tarball — it's our dev artifact).
