"""Package a generated plugin folder as <plugin-name>.tar.gz.

Usage:
    python package_tarball.py <plugin-folder> [output-dir]

Excludes: node_modules/, *.log, .DS_Store, __pycache__/, .git/.
Writes to current directory (or output-dir if given). Prints the absolute path.
"""

from __future__ import annotations

import sys
import tarfile
from pathlib import Path


EXCLUDE_DIRS = {"node_modules", "__pycache__", ".git", "dist", ".pytest_cache"}
EXCLUDE_FILE_SUFFIXES = (".log", ".pyc")
EXCLUDE_FILE_NAMES = {".DS_Store", "Thumbs.db"}


def should_exclude(member_path: Path, base: Path) -> bool:
    rel = member_path.relative_to(base)
    for part in rel.parts:
        if part in EXCLUDE_DIRS:
            return True
    if rel.name in EXCLUDE_FILE_NAMES:
        return True
    if rel.suffix.lower() in EXCLUDE_FILE_SUFFIXES:
        return True
    return False


def package(plugin_dir: Path, output_dir: Path) -> Path:
    if not plugin_dir.is_dir():
        raise SystemExit(f"not a directory: {plugin_dir}")

    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{plugin_dir.name}.tar.gz"

    with tarfile.open(output, "w:gz") as tar:
        for path in sorted(plugin_dir.rglob("*")):
            if should_exclude(path, plugin_dir):
                continue
            # arcname keeps the plugin folder as the tar root, so extraction
            # produces <plugin-name>/... directly.
            arcname = plugin_dir.name + "/" + str(path.relative_to(plugin_dir)).replace("\\", "/")
            tar.add(path, arcname=arcname, recursive=False)

    return output


def main() -> int:
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print("usage: package_tarball.py <plugin-folder> [output-dir]", file=sys.stderr)
        return 2

    plugin_dir = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve() if len(sys.argv) == 3 else Path.cwd()

    output = package(plugin_dir, output_dir)
    print(str(output))
    return 0


if __name__ == "__main__":
    sys.exit(main())
