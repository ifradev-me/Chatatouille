---
name: bot-test-plugin-builder
description: |
  Scaffolds a complete plugin for the bot-test framework — a multi-platform
  modular WhatsApp/Telegram bot with hot-pluggable handlers. Activate when the
  user wants to create, scaffold, generate, or build a new plugin for bot-test.
  Asks targeted specifications, drafts plan.md for explicit approval, generates
  plugin.json + a TypeScript handler (plus optional local middleware), runs
  static + simulated-router tests, and packages everything as a tar.gz ready to
  drop into the bot's `plugins/` directory.
version: 0.1.0
license: MIT
---

# bot-test-plugin-builder

A Claude skill that walks the user through building a plugin for the **bot-test** bot framework end-to-end. The framework is a Node/TypeScript multi-platform bot (WhatsApp via Baileys v7, Telegram via grammy) with a plugin loader, fuzzy keyword routing, multi-step conversation flows, and per-platform user identity.

## When to activate

User says any of:
- "buatin plugin untuk bot-test"
- "bikin plugin baru"
- "scaffold a bot plugin"
- "create a plugin that does X" (in context of bot-test)

Do **not** activate for: editing core/, modifying the bot runtime, deploying the bot, or non-bot-test plugin requests.

## Constraints

- Run inside the claude.ai code execution sandbox (Python 3, no Node).
- Workspace is ephemeral — all artifacts must be produced as files for download.
- Tests verify **structure and routing logic**, not TypeScript compilation. The user must run `npm run typecheck` locally after extracting.
- npm dependencies declared in a plugin's `package.json` are listed but not installed — the user runs `npm install` themselves.

## Procedure

Follow these steps in order. Stop and wait for the user between steps where indicated.

### Step 1 — Interview

Ask the user up to **4** clarifying questions (sequential — not all at once). Cover:

1. **Plugin folder name** (kebab-case, e.g. `plugin-greeting`). Default: derive from purpose.
2. **Trigger** — pick one:
   - `keyword` (fuzzy) with 1+ values + optional threshold (default 0.6)
   - `regex` with 1+ patterns
   - `all` (fallback — only with event-only hooks: `onMedia`, `onJoin`, `onLeave`)
3. **Behavior**:
   - Single-shot reply, OR
   - Multi-step conversation flow (ask for step list: `[ask_qty, confirm]`, etc.)
4. **Optional**: local middleware? npm dependencies? `platforms[]` whitelist? own database tables (durable structured data → see `references/plugin-database.md`)?

Read `references/plugin-format.md` if you need to remind yourself of valid options.

### Step 2 — Draft `plan.md`

Read `references/lifecycle-hooks.md`, `references/ctx-api.md`, and the most relevant example in `references/examples/` for the chosen pattern. Then write `plan.md` to the workspace describing:

- Plugin name and final folder name
- Full `plugin.json` content (planned, not generated yet)
- Which hooks the index.ts will declare
- State machine (if conversation flow): step names, transitions, exit conditions
- Local middleware files (if any) with one-line purpose each
- npm dependencies (if any)
- Test scenarios that will be run

Print plan.md inline. **STOP** and wait for the user's verdict:

- **Approved** ("ok", "approve", "lanjut", "go", etc.) → proceed to Step 3.
- **Edit requested** (anything else that changes the spec) → revise `plan.md`, print the updated plan inline, and **STOP again**. Repeat this revise-and-re-present loop until the user explicitly approves. Never proceed on silence or a partial answer.

### Step 3 — Generate files

On approval, choose the matching template from `templates/` (see §templates below) and substitute placeholders. Write to workspace at `<plugin-name>/`:

- `<plugin-name>/plugin.json`
- `<plugin-name>/index.ts`
- `<plugin-name>/middleware/<name>.ts` for each local middleware (if any)
- `<plugin-name>/migrations/001_<YYYYMMDD>_<HHMMSS>_<epoch_s>_init.sql` (only if own DB tables — follow `references/plugin-database.md`)
- `<plugin-name>/package.json` (only if npm deps declared)

Template selection table:

| Trigger | Behavior | Template |
|---|---|---|
| keyword | single-shot | `index-keyword.ts.tmpl` |
| regex | single-shot | `index-regex.ts.tmpl` |
| keyword OR regex | conversation flow | `index-conversation.ts.tmpl` |
| all | onMedia only | `index-media.ts.tmpl` |
| all | onJoin/onLeave | `index-event.ts.tmpl` |

If the user wants something that doesn't match a template (mix of hooks, custom logic), pick the closest template and hand-edit before writing.

### Step 4 — Run tests

Execute three scripts in order against the generated plugin folder:

```bash
python scripts/validate_plugin_json.py <plugin-folder>
python scripts/parse_index_ts.py <plugin-folder>
python scripts/sim_router.py <plugin-folder>
```

Each prints a JSON report. Aggregate results into a markdown summary for the user (pass/fail per test, with errors if any).

**If any test fails**: investigate, fix the generated files, and re-run all three scripts. Loop this fix-and-re-test cycle up to **3 attempts**. Still failing after 3? **STOP**: show the user the remaining errors, your diagnosis, and the options (change the spec, accept a reduced scope, or abort). Never proceed to packaging with failing tests.

### Step 5 — Package

```bash
python scripts/package_tarball.py <plugin-folder>
```

This produces `<plugin-name>.tar.gz` in the workspace.

### Step 6 — Deliver

Reply to the user with:

1. Confirmation that all tests passed.
2. Link/reference to the tar.gz artifact (claude.ai exposes the workspace file for download).
3. Extraction & install instructions:

   ```bash
   tar -xzf <plugin-name>.tar.gz -C path/to/bot-test/plugins/
   cd path/to/bot-test
   npm run typecheck    # verify TS compiles
   npm run dev          # restart bot
   ```

4. Caveats (always include):
   - TS compilation only verified locally.
   - If `package.json` was generated for plugin-local deps, `cd plugins/<name> && npm install`.
   - Conversation flows have a TTL — flows expire if the user goes idle.
   - If `migrations/` was generated: tables are created automatically at next bot boot, in the plugin's own Postgres schema; check the boot log for `[migrate] applied`.

## Reference index

Load on demand — do not pre-load everything:

| File | When to read |
|---|---|
| `references/plugin-format.md` | Step 1, when validating user's choices against the schema. |
| `references/lifecycle-hooks.md` | Step 2, when planning which hooks to declare + Msg shape. |
| `references/ctx-api.md` | Step 2-3, when planning reply/helpers usage. |
| `references/conversation-flow.md` | Step 2-3, only if behavior = multi-step flow. |
| `references/middleware-pattern.md` | Step 2-3, only if local middleware requested. |
| `references/plugin-database.md` | Step 2-3, only if the plugin owns DB tables (migrations + `createPluginDb`). |
| `references/sdk-utilities.md` | Step 3, when picking utilities to import. |
| `references/examples/0X-*.md` | Step 2, pick the one matching the chosen trigger/behavior. |

## Templates

The seven templates in `templates/` use `{{ placeholder }}` substitution (plain Python `str.replace`). See `references/plugin-format.md` for the complete placeholder list per template.

## Testing

The skill's own tests live in `tests/` and are bundled in the delivered tarball. Run anywhere:

```bash
cd bot-test-plugin-builder
python -m pytest tests/
```

These tests cover the validators, parsers, sim_router, template rendering, and packaging — not the user's generated plugin (that's covered by Step 4 scripts).
