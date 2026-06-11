"""Validate a generated plugin's plugin.json against bot-test's schema.

Usage:
    python validate_plugin_json.py <plugin-folder>

Exits 0 on pass, 1 on fail. Always prints a JSON report to stdout.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


KNOWN_PLATFORMS = {"whatsapp", "telegram", "discord"}
ALLOWED_MATCH_TYPES = {"keyword", "regex", "all", "intent"}
KEBAB_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")


def validate(plugin_dir: Path) -> tuple[list[str], dict[str, Any] | None]:
    errors: list[str] = []
    manifest_path = plugin_dir / "plugin.json"
    if not manifest_path.is_file():
        return [f"plugin.json not found in {plugin_dir}"], None

    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [f"plugin.json is not valid JSON: {e}"], None

    if not isinstance(data, dict):
        return ["plugin.json must contain a JSON object"], None

    # name
    name = data.get("name")
    if not isinstance(name, str) or not name:
        errors.append("name must be a non-empty string")
    elif not KEBAB_RE.match(name):
        errors.append(f"name '{name}' must be kebab-case (lowercase, dashes)")
    elif name != plugin_dir.name:
        errors.append(f"name '{name}' must match folder name '{plugin_dir.name}'")

    # enabled
    enabled = data.get("enabled")
    if not isinstance(enabled, bool):
        errors.append("enabled must be a boolean")

    # match
    match = data.get("match")
    if not isinstance(match, dict):
        errors.append("match must be an object")
    else:
        mtype = match.get("type")
        if mtype not in ALLOWED_MATCH_TYPES:
            errors.append(
                f"match.type '{mtype}' must be one of {sorted(ALLOWED_MATCH_TYPES)}"
            )
        elif mtype == "intent":
            errors.append("match.type 'intent' is reserved and not implemented; use keyword or regex")

        if mtype in {"keyword", "regex"}:
            values = match.get("values")
            if not isinstance(values, list) or not values:
                errors.append(f"match.values is required for type '{mtype}' and must be non-empty array")
            elif not all(isinstance(v, str) and v for v in values):
                errors.append("match.values must be array of non-empty strings")

        threshold = match.get("threshold")
        if threshold is not None:
            if not isinstance(threshold, (int, float)) or isinstance(threshold, bool):
                errors.append("match.threshold must be a number")
            elif not (0.0 <= float(threshold) <= 1.0):
                errors.append(f"match.threshold {threshold} must be between 0 and 1")
            elif mtype != "keyword":
                errors.append("match.threshold only applies when type is 'keyword'")

    # platforms
    platforms = data.get("platforms")
    if platforms is not None:
        if not isinstance(platforms, list):
            errors.append("platforms must be an array")
        else:
            if len(platforms) == 0:
                errors.append("platforms is empty array — plugin will never run (remove the field instead)")
            for p in platforms:
                if p not in KNOWN_PLATFORMS:
                    errors.append(f"platforms contains unknown value '{p}' (allowed: {sorted(KNOWN_PLATFORMS)})")

    # middleware
    middleware = data.get("middleware")
    if middleware is not None:
        if not isinstance(middleware, list) or not all(isinstance(m, str) for m in middleware):
            errors.append("middleware must be an array of strings")
        else:
            mw_dir = plugin_dir / "middleware"
            for mw_name in middleware:
                candidates = [mw_dir / f"{mw_name}.ts", mw_dir / f"{mw_name}.js", mw_dir / f"{mw_name}.mjs"]
                if not any(c.is_file() for c in candidates):
                    errors.append(f"middleware '{mw_name}' file not found in {mw_dir}/")

    # response (informational only — no hard fail)
    response = data.get("response")
    if response is not None and (
        not isinstance(response, dict) or response.get("type") not in {"static", "dynamic", "llm"}
    ):
        errors.append("response.type must be 'static', 'dynamic', or 'llm' when present")

    return errors, data


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "errors": ["usage: validate_plugin_json.py <plugin-folder>"]}))
        return 2
    plugin_dir = Path(sys.argv[1]).resolve()
    if not plugin_dir.is_dir():
        print(json.dumps({"ok": False, "errors": [f"not a directory: {plugin_dir}"]}))
        return 2

    errors, manifest = validate(plugin_dir)
    report = {
        "ok": len(errors) == 0,
        "plugin": plugin_dir.name,
        "errors": errors,
        "manifest": manifest,
    }
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
