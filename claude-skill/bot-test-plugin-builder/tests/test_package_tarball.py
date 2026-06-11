import tarfile
from pathlib import Path

from package_tarball import package, should_exclude, EXCLUDE_DIRS


def _make_sample_plugin(folder: Path):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "plugin.json").write_text(
        '{"name":"' + folder.name + '","enabled":true,"match":{"type":"all"}}',
        encoding="utf-8",
    )
    (folder / "index.ts").write_text("export default { async onJoin(){} };", encoding="utf-8")
    # Junk that must be excluded.
    (folder / "node_modules").mkdir()
    (folder / "node_modules" / "garbage.js").write_text("// noise", encoding="utf-8")
    (folder / ".DS_Store").write_text("noise", encoding="utf-8")
    (folder / "debug.log").write_text("noise", encoding="utf-8")


def test_package_builds_tarball(tmp_path: Path):
    plugin = tmp_path / "my-plug"
    _make_sample_plugin(plugin)
    out = package(plugin, tmp_path)

    assert out.exists()
    assert out.suffix == ".gz"
    assert out.name == "my-plug.tar.gz"


def test_tarball_contains_expected_files(tmp_path: Path):
    plugin = tmp_path / "my-plug"
    _make_sample_plugin(plugin)
    out = package(plugin, tmp_path)

    with tarfile.open(out, "r:gz") as tar:
        names = tar.getnames()

    # Plugin folder is the tar root.
    assert "my-plug/plugin.json" in names
    assert "my-plug/index.ts" in names


def test_tarball_excludes_dev_artifacts(tmp_path: Path):
    plugin = tmp_path / "my-plug"
    _make_sample_plugin(plugin)
    out = package(plugin, tmp_path)

    with tarfile.open(out, "r:gz") as tar:
        names = tar.getnames()

    assert not any("node_modules" in n for n in names)
    assert not any(".DS_Store" in n for n in names)
    assert not any(n.endswith(".log") for n in names)


def test_should_exclude_helper(tmp_path: Path):
    base = tmp_path / "p"
    base.mkdir()
    (base / "node_modules").mkdir()
    (base / "node_modules" / "x.js").write_text("", encoding="utf-8")
    assert should_exclude(base / "node_modules" / "x.js", base)

    (base / "ok.ts").write_text("", encoding="utf-8")
    assert not should_exclude(base / "ok.ts", base)


def test_package_includes_subfolders(tmp_path: Path):
    plugin = tmp_path / "with-mw"
    _make_sample_plugin(plugin)
    (plugin / "middleware").mkdir()
    (plugin / "middleware" / "check.ts").write_text("// mw", encoding="utf-8")

    out = package(plugin, tmp_path)
    with tarfile.open(out, "r:gz") as tar:
        names = tar.getnames()

    assert "with-mw/middleware/check.ts" in names


def test_exclude_dirs_constant_sane():
    """Sanity: critical exclusions are listed."""
    for d in {"node_modules", "__pycache__", ".git", "dist"}:
        assert d in EXCLUDE_DIRS
