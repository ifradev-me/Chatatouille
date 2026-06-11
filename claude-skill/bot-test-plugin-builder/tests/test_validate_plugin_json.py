from pathlib import Path

from validate_plugin_json import validate


def test_valid_keyword_passes(fixtures_dir: Path):
    errors, manifest = validate(fixtures_dir / "valid-keyword")
    assert errors == []
    assert manifest is not None
    assert manifest["name"] == "valid-keyword"


def test_valid_conversation_passes(fixtures_dir: Path):
    errors, _ = validate(fixtures_dir / "valid-conversation")
    assert errors == []


def test_valid_event_passes(fixtures_dir: Path):
    errors, _ = validate(fixtures_dir / "valid-event")
    assert errors == []


def test_missing_name_fails(fixtures_dir: Path):
    errors, _ = validate(fixtures_dir / "invalid-missing-name")
    assert any("name" in e.lower() for e in errors)


def test_bad_threshold_fails(fixtures_dir: Path):
    errors, _ = validate(fixtures_dir / "invalid-bad-threshold")
    assert any("threshold" in e.lower() for e in errors)


def test_folder_name_mismatch(tmp_path: Path):
    """name field must match folder name."""
    folder = tmp_path / "my-plugin"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name": "different-name", "enabled": true, "match": {"type": "all"}}',
        encoding="utf-8",
    )
    errors, _ = validate(folder)
    assert any("match folder name" in e for e in errors)


def test_intent_type_rejected(tmp_path: Path):
    folder = tmp_path / "intent-plug"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name": "intent-plug", "enabled": true, "match": {"type": "intent", "values": ["x"]}}',
        encoding="utf-8",
    )
    errors, _ = validate(folder)
    assert any("intent" in e.lower() for e in errors)


def test_platforms_unknown_value(tmp_path: Path):
    folder = tmp_path / "wrong-platform"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name": "wrong-platform", "enabled": true, "platforms": ["slack"], "match": {"type": "all"}}',
        encoding="utf-8",
    )
    errors, _ = validate(folder)
    assert any("slack" in e for e in errors)


def test_keyword_without_values_fails(tmp_path: Path):
    folder = tmp_path / "no-values"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name": "no-values", "enabled": true, "match": {"type": "keyword"}}',
        encoding="utf-8",
    )
    errors, _ = validate(folder)
    assert any("values" in e.lower() for e in errors)


def test_middleware_file_missing(tmp_path: Path):
    folder = tmp_path / "mw-missing"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name": "mw-missing", "enabled": true, "middleware": ["ghost"], "match": {"type": "all"}}',
        encoding="utf-8",
    )
    errors, _ = validate(folder)
    assert any("ghost" in e for e in errors)


def test_middleware_file_present(tmp_path: Path):
    folder = tmp_path / "mw-ok"
    folder.mkdir()
    (folder / "middleware").mkdir()
    (folder / "middleware" / "real.ts").write_text("export default async () => {};", encoding="utf-8")
    (folder / "plugin.json").write_text(
        '{"name": "mw-ok", "enabled": true, "middleware": ["real"], "match": {"type": "all"}}',
        encoding="utf-8",
    )
    errors, _ = validate(folder)
    # No middleware-related errors.
    assert not any("middleware" in e.lower() for e in errors)
