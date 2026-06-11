# Claude Prompt — Build a New Plugin

> 🇬🇧 English · 🇮🇩 [Bahasa Indonesia](CLAUDE_PROMPT.id.md)

Copy-paste the prompt below into Claude (Claude Code, claude.ai, or the API), fill in the `{{ ... }}` parts, and send. Claude generates a complete `plugins/plugin-{{name}}/` folder with `plugin.json` + `index.ts` following this repo's rules.

> Prerequisite: run the prompt at the repo **root** (the folder containing `core/`, `plugins/`, `docs/`). Claude will read [PLUGINS.md](PLUGINS.md), [CORE.md](CORE.md), and [core/types.ts](../core/types.ts) before writing code.

---

## A. Short prompt (one-shot)

Use this when the plugin idea is clear and you just need the code.

```
Please build a new plugin for the bot in this repo.

Specification:
- Plugin name: plugin-{{kebab-case-name}}
- What it does: {{short description — 1-2 sentences}}
- Trigger (when the plugin fires): {{e.g.: keyword "price", "shipping" / regex "^order\s+.+" / fallback "all" / onJoin event}}
- Target platform: {{whatsapp / telegram / all}}
- Response type: {{static / dynamic / llm}}
- Multi-step state needed? {{yes — describe the steps / no}}
- Own database tables needed? {{no / yes — describe what data is stored}}
- npm dependencies needed? {{no / list them: sharp, axios, etc.}}
- Local middleware needed? {{no / describe the validation required}}

Before writing code:
1. Read docs/PLUGINS.md end to end — follow ALL conventions there.
2. Read core/types.ts for the PluginDef, Msg, Ctx signatures.
3. Look at the 1-2 existing plugins in plugins/ closest to this use case as style references.

Hard rules:
- Self-contained: NEVER import from plugins/other-plugin/. Reusable logic → core/helpers/ or an SDK utility.
- NEVER touch core/router.ts or core/loader.ts.
- Use msg.from as the primary key (NOT msg.phoneNumber / msg.lid).
- Pass ctx.platform in ALL helpers.user.* and helpers.history.get/clear calls.
- Wrap all I/O (fetch/DB) in retry() + try/catch with ctx.log.error.
- createHealthCheck() / rate limiters are called at module top level, NOT inside hooks.
- Own tables? createPluginDb(import.meta) + migrations/ in the plugin folder (PLUGINS.md §8). NEVER add plugin migrations to core/db/migrations/. Queries always parameterized ($1, $2).
- conversation.enter() REQUIRES a TTL — never infinite.
- Strict TypeScript — no `any` except for msg.raw.
- Use definePlugin() from core/plugin-sdk.js.

Deliverables:
1. plugins/plugin-{{kebab-case-name}}/plugin.json
2. plugins/plugin-{{kebab-case-name}}/index.ts
3. (if needed) plugins/plugin-{{kebab-case-name}}/middleware/*.ts
4. (if needed) plugins/plugin-{{kebab-case-name}}/migrations/*.sql
5. (if needed) plugins/plugin-{{kebab-case-name}}/package.json + install command

After generating:
- Run `npm run typecheck` and fix any errors.
- Show 2-3 example trigger messages that should match, plus examples that should NOT match (to verify routing).
- Show the §12 PLUGINS.md checklist, tick what's done, leave TODOs for the rest.
```

---

## B. Interactive prompt (when the idea is still rough)

Use this when you only have a vague idea and want Claude to help shape it.

```
I want to build a new bot plugin in this repo, but the spec isn't fixed yet. Rough idea:

"{{free-form idea — e.g. 'a plugin that answers product prices from a database', 'a per-user reminder plugin', 'a plugin that resizes images users send'}}"

Your job:
1. Read docs/PLUGINS.md and docs/CORE.md first to understand the architecture.
2. Ask me ONLY the critical unknowns (3 questions max):
   - The right trigger (which keywords? regex? fallback?)
   - Is multi-step state (conversation) needed?
   - Any external API / DB / npm dependency?
3. After I answer, summarize the final spec in 1 paragraph and ASK for my confirmation.
4. Once I confirm, generate the plugin following Prompt A above.

Do not write code before the spec is confirmed.
```

---

## C. Example fills for Prompt A

### Example 1 — price FAQ (keyword + static reply)

```
Plugin name: plugin-price
What it does: answers product price questions from a static map { "coffee": 15000, "tea": 10000 }.
Trigger: keyword "price", "cost", "how much"
Target platform: all
Response type: static
Multi-step state needed? no
Own database tables needed? no
npm dependencies needed? no
Local middleware needed? no
```

### Example 2 — order wizard (regex + conversation)

```
Plugin name: plugin-order
What it does: takes an order, asks quantity, confirms, saves to the DB.
Trigger: regex "^order\s+.+"
Target platform: whatsapp
Response type: dynamic
Multi-step state needed? yes — steps ask_qty → confirm → save. Cancel via "cancel" / "/cancel". TTL 5 minutes.
Own database tables needed? yes — orders (item, qty, status) in the plugin's own schema
npm dependencies needed? no
Local middleware needed? yes — validateFormat: reject when nothing follows "order ".
```

### Example 3 — image resize (onMedia + npm dep)

```
Plugin name: plugin-image-resize
What it does: when a user sends an image, resize to 800px and send it back.
Trigger: match "all" (only implements onMedia, so text never reaches it).
Target platform: all
Response type: dynamic
Multi-step state needed? no
Own database tables needed? no
npm dependencies needed? sharp ^0.33
Local middleware needed? no
```

---

## D. Tips for better results from Claude

- **Name a similar existing plugin** ("like plugin-faq but with a DB lookup instead of a hardcoded map"). Claude will read it as a style reference.
- **Spell out the error cases to handle**, not just the happy path ("if qty isn't a number, reply with an error and stay on the same step").
- **If using an LLM/n8n/external API**, name the env vars involved (`N8N_WEBHOOK_URL`, `OPENAI_API_KEY`, …) — Claude will read from `ctx.config` instead of raw `process.env` when the config loader already has it.
- **After Claude finishes**, have it run `npm run typecheck` and **send one test message** through a dev runner if available — don't just assume it works.

---

## E. Common anti-patterns (tell Claude when you see them)

| Anti-pattern | Correction |
|---|---|
| Imports from `plugins/plugin-x/...` | Move to `core/helpers/` or make it an SDK utility |
| `process.env.X` in the middle of a hook | Use `ctx.config.X` |
| `helpers.user.findOrCreate(msg.from)` without the platform | Must pass `ctx.platform` as the 2nd arg |
| `createHealthCheck()` inside a hook | Move it to module top level |
| `conversation.enter()` without a TTL | TTL is required (see §4 PLUGINS.md) |
| `msg.phoneNumber` as a DB key | Switch to `msg.from` |
| Plugin migrations placed in `core/db/migrations/` | Move to `plugins/<name>/migrations/` (see §8 PLUGINS.md) |
| User input interpolated into SQL strings | Parameterized queries (`$1, $2`) |
| `any` in TypeScript | Use the types from `core/types.ts` |

---

## F. Using claude.ai (website) — without repo access

Claude on the website **cannot read local files**. You must provide the context manually.

### Fast path (recommended) — upload files

1. Open a new chat at [claude.ai](https://claude.ai).
2. Click **attach** (📎) and upload these files from the repo:
   - `docs/PLUGINS.md` ← required, this is the rulebook
   - `core/types.ts` ← required, the Msg/Ctx/PluginDef signatures
   - `core/plugin-sdk.ts` ← required, the `definePlugin`, `retry`, … utilities
   - 1 example plugin closest to your use case, e.g. `plugins/plugin-faq/index.ts` + `plugin.json`
3. Paste **Prompt A** from above, fill in the `{{ ... }}` placeholders.
4. Add this line at the top of the prompt (overrides the "read files" instructions, since web Claude has no tools):

   ```
   The context is in the attached files (PLUGINS.md, types.ts, plugin-sdk.ts, example plugin).
   Don't ask me for repo access — work from the attachments only.
   Output directly as code blocks with file-path headers, e.g.:

       // plugins/plugin-mine/plugin.json
       { ... }

       // plugins/plugin-mine/index.ts
       ...
   ```

5. After Claude generates, **copy each code block manually** into local files. Create the folder yourself:

   ```bash
   mkdir plugins/plugin-mine
   # paste plugin.json and index.ts into your editor
   ```

6. Run `npm run typecheck` locally — if there are errors, paste them back to Claude to fix.

### Minimal version (if you'd rather not upload)

For a simple plugin (keyword + text reply) you can paste the contents of `PLUGINS.md` straight into the chat. But it burns a lot of context and Claude may miss details. **More reliable: upload files.**

### Using Projects on claude.ai (best for repeat use)

If you build plugins for this repo often:

1. On claude.ai, create a new **Project**, e.g. "Bot Plugin Generator".
2. **Project knowledge**: upload `PLUGINS.md`, `CORE.md`, `core/types.ts`, `core/plugin-sdk.ts`, and 2-3 example plugins once.
3. **Project custom instructions**: paste the "Hard rules" + "Anti-patterns" from this document.
4. From then on, each new chat in that Project only needs the short **Prompt A** — Claude already has the context.

> Re-upload the knowledge whenever the architecture changes (PLUGINS.md updated, new fields in types.ts) — otherwise Claude generates code against stale rules.

### Differences vs Claude Code (CLI/IDE)

| Aspect | claude.ai (web) | Claude Code |
|---|---|---|
| Repo file access | Manual upload | Automatic via `Read`/`Grep` |
| Writing files to disk | Manual copy-paste | Direct `Write` into folders |
| Running `typecheck` | You run it in a terminal | Claude runs it via `Bash` |
| Fix-error loop | Paste error → wait for fix → retry | Automatic until green |
| Best for | One-off plugins / learning the architecture | Fast iteration on an active project |

For a non-trivial plugin (multi-step, middleware, npm deps), Claude Code inside this repo is far faster than web copy-paste round-trips.

---

## G. References
- Full rules: [PLUGINS.md](PLUGINS.md)
- Core architecture: [CORE.md](CORE.md)
- Roadmap: [ROADMAP.md](ROADMAP.md)
- Type definitions: [core/types.ts](../core/types.ts)
- SDK: [core/plugin-sdk.ts](../core/plugin-sdk.ts)
- Example plugins: [plugins/](../plugins/)
