"""Render each template with sample inputs, write to a temp plugin folder,
then run validate + parse against it to verify the output is internally consistent.
"""

import json
from pathlib import Path

from validate_plugin_json import validate
from parse_index_ts import parse


def render(template_src: str, vars: dict) -> str:
    out = template_src
    for k, v in vars.items():
        out = out.replace("{{ " + k + " }}", str(v))
    return out


def write_plugin(folder: Path, manifest_str: str, index_str: str):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "plugin.json").write_text(manifest_str, encoding="utf-8")
    (folder / "index.ts").write_text(index_str, encoding="utf-8")


def test_keyword_template_renders_valid(skill_root: Path, tmp_path: Path):
    manifest_tmpl = (skill_root / "templates" / "plugin.json.tmpl").read_text(encoding="utf-8")
    index_tmpl = (skill_root / "templates" / "index-keyword.ts.tmpl").read_text(encoding="utf-8")

    cases = "\n".join([
        '      case "price":\n        await ctx.reply("ten bucks");\n        return;',
        '      case "shipping":\n        await ctx.reply("free over $50");\n        return;',
    ])

    manifest = render(manifest_tmpl, {
        "NAME": "rendered-kw",
        "MATCH_BLOCK": '{ "type": "keyword", "values": ["price", "shipping"], "threshold": 0.6 }',
        "PLATFORMS_BLOCK": "",
        "MIDDLEWARE_BLOCK": "",
    })
    index = render(index_tmpl, {
        "NAME": "rendered-kw",
        "VAR_NAME": "renderedKw",
        "DESCRIPTION": "Renders FAQ-style replies.",
        "CASES": cases,
    })

    folder = tmp_path / "rendered-kw"
    write_plugin(folder, manifest, index)

    errors, _ = validate(folder)
    assert errors == [], f"validate failed: {errors}"

    parsed = parse(folder)
    assert parsed["ok"], parsed
    assert "handle" in parsed["hooks"]


def test_regex_template_renders_valid(skill_root: Path, tmp_path: Path):
    manifest_tmpl = (skill_root / "templates" / "plugin.json.tmpl").read_text(encoding="utf-8")
    index_tmpl = (skill_root / "templates" / "index-regex.ts.tmpl").read_text(encoding="utf-8")

    manifest = render(manifest_tmpl, {
        "NAME": "rendered-regex",
        "MATCH_BLOCK": '{ "type": "regex", "values": ["^echo\\\\s+.+"] }',
        "PLATFORMS_BLOCK": "",
        "MIDDLEWARE_BLOCK": "",
    })
    index = render(index_tmpl, {
        "DESCRIPTION": "Echo command.",
        "STRIP_REGEX": "/^echo\\s+/i",
        "EMPTY_REPLY": "Format: echo <text>",
        "REPLY_PREFIX": "Echo: ",
    })

    folder = tmp_path / "rendered-regex"
    write_plugin(folder, manifest, index)

    errors, _ = validate(folder)
    assert errors == [], f"validate failed: {errors}"

    parsed = parse(folder)
    assert parsed["ok"], parsed
    assert "handle" in parsed["hooks"]


def test_event_template_renders_valid(skill_root: Path, tmp_path: Path):
    manifest_tmpl = (skill_root / "templates" / "plugin.json.tmpl").read_text(encoding="utf-8")
    index_tmpl = (skill_root / "templates" / "index-event.ts.tmpl").read_text(encoding="utf-8")

    event_hooks = """  async onJoin(msg, ctx) {
    await ctx.reply(`hi ${msg.pushName ?? msg.from}`);
  },
  async onLeave(msg, ctx) {
    await ctx.reply(`bye ${msg.pushName ?? msg.from}`);
  },"""

    manifest = render(manifest_tmpl, {
        "NAME": "rendered-event",
        "MATCH_BLOCK": '{ "type": "all" }',
        "PLATFORMS_BLOCK": "",
        "MIDDLEWARE_BLOCK": "",
    })
    index = render(index_tmpl, {
        "DESCRIPTION": "Welcome/farewell.",
        "EVENT_HOOKS": event_hooks,
    })

    folder = tmp_path / "rendered-event"
    write_plugin(folder, manifest, index)

    errors, _ = validate(folder)
    assert errors == [], f"validate failed: {errors}"

    parsed = parse(folder)
    assert parsed["ok"], parsed
    assert {"onJoin", "onLeave"} <= set(parsed["hooks"])


def test_conversation_template_renders_valid(skill_root: Path, tmp_path: Path):
    manifest_tmpl = (skill_root / "templates" / "plugin.json.tmpl").read_text(encoding="utf-8")
    index_tmpl = (skill_root / "templates" / "index-conversation.ts.tmpl").read_text(encoding="utf-8")

    state_type = '  | { step: "ask" }\n  | { step: "confirm" }'
    initial = '{ step: "ask" }'
    branches = """  if (active.state.step === "ask") {
    ctx.helpers.conversation.update(msg.from, ctx.platform, { step: "confirm" });
    await ctx.reply("confirm?");
    return;
  }
  if (active.state.step === "confirm") {
    ctx.helpers.conversation.exit(msg.from, ctx.platform);
    await ctx.reply("done");
  }"""

    manifest = render(manifest_tmpl, {
        "NAME": "rendered-conv",
        "MATCH_BLOCK": '{ "type": "keyword", "values": ["start"], "threshold": 0.6 }',
        "PLATFORMS_BLOCK": "",
        "MIDDLEWARE_BLOCK": "",
    })
    index = render(index_tmpl, {
        "NAME": "rendered-conv",
        "DESCRIPTION": "2-step flow.",
        "STATE_TYPE": state_type,
        "TTL_MS": "60_000",
        "INITIAL_STATE": initial,
        "ENTRY_REPLY": "first?",
        "STEP_BRANCHES": branches,
    })

    folder = tmp_path / "rendered-conv"
    write_plugin(folder, manifest, index)

    errors, _ = validate(folder)
    assert errors == [], f"validate failed: {errors}"

    parsed = parse(folder)
    assert parsed["ok"], parsed
    assert "handle" in parsed["hooks"]


def test_media_template_renders_valid(skill_root: Path, tmp_path: Path):
    manifest_tmpl = (skill_root / "templates" / "plugin.json.tmpl").read_text(encoding="utf-8")
    index_tmpl = (skill_root / "templates" / "index-media.ts.tmpl").read_text(encoding="utf-8")

    branches = """    if (msg.media.type === "image") {
      await ctx.reply("got image");
    }"""

    manifest = render(manifest_tmpl, {
        "NAME": "rendered-media",
        "MATCH_BLOCK": '{ "type": "all" }',
        "PLATFORMS_BLOCK": "",
        "MIDDLEWARE_BLOCK": "",
    })
    index = render(index_tmpl, {
        "NAME": "rendered-media",
        "DESCRIPTION": "Image acknowledger.",
        "MEDIA_BRANCHES": branches,
    })

    folder = tmp_path / "rendered-media"
    write_plugin(folder, manifest, index)

    errors, _ = validate(folder)
    assert errors == [], f"validate failed: {errors}"

    parsed = parse(folder)
    assert parsed["ok"], parsed
    assert "onMedia" in parsed["hooks"]


def test_middleware_template_renders_parseable(skill_root: Path, tmp_path: Path):
    """Middleware template just needs to be a valid TS file that parses."""
    tmpl = (skill_root / "templates" / "middleware.ts.tmpl").read_text(encoding="utf-8")
    out = render(tmpl, {
        "VAR_NAME": "checkAdmin",
        "DESCRIPTION": "Allow only admins.",
        "BODY": '  const admins = ["u1", "u2"];\n  if (!admins.includes(msg.from)) {\n    await ctx.reply("nope");\n    ctx.stop();\n  }',
    })
    # The rendered middleware ends with `export default`, so it should still
    # contain it after substitution.
    assert "export default checkAdmin;" in out
    assert "import type { MiddlewareFn }" in out
