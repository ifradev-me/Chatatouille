"""Static parser for a plugin's index.ts.

Regex-based, NOT a real TS parser. Designed to catch obvious omissions:
  - missing `export default`
  - missing hooks consistent with the manifest's match.type
  - usage of deprecated single-arg helpers (ctx.helpers.user.find(msg.from) without platform)
  - balanced braces (rough)

Usage:
    python parse_index_ts.py <plugin-folder>
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


HOOKS = ("handle", "onMedia", "onJoin", "onLeave")


def _strip_comments(src: str) -> str:
    """Remove // line comments and /* block */ comments so they don't mislead regex."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    src = re.sub(r"//[^\n]*", "", src)
    return src


def has_export_default(src: str) -> bool:
    return re.search(r"\bexport\s+default\b", _strip_comments(src)) is not None


# definePlugin(async (msg, ctx) => {...})  OR  definePlugin(function (...) {...})
# Single-function form — implicit `handle`.
_DEFINE_PLUGIN_FUNCTION_FORM = re.compile(
    r"definePlugin\s*\(\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function\b)",
    re.MULTILINE,
)


def declared_hooks(src: str) -> list[str]:
    src = _strip_comments(src)
    found = []
    for hook in HOOKS:
        # Match `handle(...)`, `async handle(...)`, `handle:`, `async handle:`, `handle = ...`
        pat = rf"(?:^|[\s,{{])(?:async\s+)?{hook}\s*(?:\(|:\s*(?:async\s*)?(?:\(|function))"
        if re.search(pat, src, re.MULTILINE):
            found.append(hook)
    # Detect function-form definePlugin → implicit `handle`.
    if "handle" not in found and _DEFINE_PLUGIN_FUNCTION_FORM.search(src):
        found.append("handle")
    return found


def detect_legacy_helper_calls(src: str) -> list[str]:
    """Heuristic for old API (single-arg without platform).

    Old: ctx.helpers.user.find(msg.from)
    New: ctx.helpers.user.find(msg.from, ctx.platform)
    """
    warnings = []
    # find/update/ban/isBanned + helpers.history.get/clear
    suspects = [
        ("user.find", r"ctx\.helpers\.user\.find\s*\(\s*[^,)]+\)"),
        ("user.update", r"ctx\.helpers\.user\.update\s*\(\s*[^,)]+,\s*\{[^,]"),
        ("user.ban", r"ctx\.helpers\.user\.ban\s*\(\s*[^,)]+\)"),
        ("user.isBanned", r"ctx\.helpers\.user\.isBanned\s*\(\s*[^,)]+\)"),
        ("history.get", r"ctx\.helpers\.history\.get\s*\(\s*[^,)]+\s*(?:,\s*\{[^,]*)?\)"),
        ("history.clear", r"ctx\.helpers\.history\.clear\s*\(\s*[^,)]+\)"),
    ]
    for label, pat in suspects:
        if re.search(pat, src):
            warnings.append(f"possible legacy single-arg call: {label} (should pass ctx.platform as 2nd arg)")
    return warnings


def braces_balanced(src: str) -> bool:
    # Strip strings and comments very crudely so braces inside them don't throw us off.
    stripped = re.sub(r"//[^\n]*", "", src)
    stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.DOTALL)
    stripped = re.sub(r"`(?:\\.|[^`\\])*`", "", stripped)
    stripped = re.sub(r"'(?:\\.|[^'\\])*'", "", stripped)
    stripped = re.sub(r"\"(?:\\.|[^\"\\])*\"", "", stripped)
    return stripped.count("{") == stripped.count("}")


def expected_hooks(match_type: str, has_conversation: bool) -> set[str]:
    """Which hooks should at minimum exist given the match type."""
    if match_type in {"keyword", "regex"}:
        return {"handle"}
    if match_type == "all":
        # Could be onMedia / onJoin / onLeave / handle (fallback). At least one event hook.
        return set()  # no specific requirement; caller checks "at least one hook"
    return set()


def parse(plugin_dir: Path) -> dict:
    errors: list[str] = []
    warnings: list[str] = []

    index_path = None
    for candidate in ("index.ts", "index.js", "index.mjs"):
        p = plugin_dir / candidate
        if p.is_file():
            index_path = p
            break

    if index_path is None:
        return {
            "ok": False,
            "errors": [f"index.ts (or .js/.mjs) not found in {plugin_dir}"],
            "warnings": warnings,
        }

    src = index_path.read_text(encoding="utf-8")

    if not has_export_default(src):
        errors.append("no `export default` found in index file")

    hooks = declared_hooks(src)
    if not hooks:
        errors.append("no lifecycle hook declared (need at least one of: handle, onMedia, onJoin, onLeave)")

    # Cross-check with manifest if present.
    manifest_path = plugin_dir / "plugin.json"
    if manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = None

        if manifest:
            mt = manifest.get("match", {}).get("type")
            expected = expected_hooks(mt, False)
            missing = expected - set(hooks)
            if missing:
                errors.append(
                    f"match.type='{mt}' requires hook(s) {sorted(missing)}; declared: {hooks}"
                )

    if not braces_balanced(src):
        errors.append("braces appear unbalanced in index file (rough check; may be false positive)")

    warnings.extend(detect_legacy_helper_calls(src))

    return {
        "ok": len(errors) == 0,
        "hooks": hooks,
        "errors": errors,
        "warnings": warnings,
        "file": index_path.name,
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "errors": ["usage: parse_index_ts.py <plugin-folder>"]}))
        return 2
    plugin_dir = Path(sys.argv[1]).resolve()
    if not plugin_dir.is_dir():
        print(json.dumps({"ok": False, "errors": [f"not a directory: {plugin_dir}"]}))
        return 2

    report = parse(plugin_dir)
    report["plugin"] = plugin_dir.name
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
