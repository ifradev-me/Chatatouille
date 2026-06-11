from pathlib import Path

from parse_index_ts import parse, declared_hooks, has_export_default, braces_balanced


def test_valid_keyword_parses(fixtures_dir: Path):
    report = parse(fixtures_dir / "valid-keyword")
    assert report["ok"], report
    assert "handle" in report["hooks"]


def test_valid_conversation_parses(fixtures_dir: Path):
    report = parse(fixtures_dir / "valid-conversation")
    assert report["ok"], report
    assert "handle" in report["hooks"]


def test_valid_event_parses(fixtures_dir: Path):
    report = parse(fixtures_dir / "valid-event")
    assert report["ok"], report
    assert {"onJoin", "onLeave"} <= set(report["hooks"])


def test_missing_default_export(tmp_path: Path):
    folder = tmp_path / "no-default"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name":"no-default","enabled":true,"match":{"type":"all"}}', encoding="utf-8"
    )
    (folder / "index.ts").write_text(
        "const x = { async handle(){} }; // no export default",
        encoding="utf-8",
    )
    report = parse(folder)
    assert not report["ok"]
    assert any("export default" in e for e in report["errors"])


def test_no_hooks_declared(tmp_path: Path):
    folder = tmp_path / "no-hooks"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name":"no-hooks","enabled":true,"match":{"type":"all"}}', encoding="utf-8"
    )
    (folder / "index.ts").write_text("export default {};", encoding="utf-8")
    report = parse(folder)
    assert not report["ok"]
    assert any("hook" in e.lower() for e in report["errors"])


def test_keyword_missing_handle(tmp_path: Path):
    folder = tmp_path / "kw-no-handle"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name":"kw-no-handle","enabled":true,"match":{"type":"keyword","values":["x"]}}',
        encoding="utf-8",
    )
    (folder / "index.ts").write_text(
        "export default { async onMedia(){} };",
        encoding="utf-8",
    )
    report = parse(folder)
    assert not report["ok"]
    # Either "no hooks" passes but expectation check should flag missing handle.
    msg = " ".join(report["errors"])
    assert "handle" in msg or "hook" in msg


def test_legacy_helper_call_warning(tmp_path: Path):
    folder = tmp_path / "legacy"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name":"legacy","enabled":true,"match":{"type":"keyword","values":["x"]}}',
        encoding="utf-8",
    )
    (folder / "index.ts").write_text(
        """
        export default {
          async handle(msg, ctx) {
            const u = await ctx.helpers.user.find(msg.from);  // missing platform!
            await ctx.reply("hi");
          }
        };
        """,
        encoding="utf-8",
    )
    report = parse(folder)
    assert any("legacy" in w for w in report["warnings"])


def test_braces_balanced_helper():
    assert braces_balanced("function x() { return {a:1}; }")
    assert braces_balanced('const a = "{}"; const b = `{`;')
    assert not braces_balanced("function x() { return; ")


def test_declared_hooks_finds_all_styles():
    src = """
        export default {
          async handle(msg, ctx) {},
          onMedia: async (m, c) => {},
          onJoin: function(m, c) {},
        };
    """
    hooks = declared_hooks(src)
    assert "handle" in hooks
    assert "onMedia" in hooks
    assert "onJoin" in hooks


def test_has_export_default_simple():
    assert has_export_default("export default {};")
    assert has_export_default("export default definePlugin({});")
    assert not has_export_default("const x = {};")
