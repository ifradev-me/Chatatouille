"""Mock router for behavioural smoke tests.

Reproduces the bot's routing decision logic in Python:
  - fuzzy keyword via difflib.SequenceMatcher (dice approximation)
  - regex match (case-insensitive)
  - `all` fallback
  - simple conversation lock (single user, in-memory)

Given a plugin folder and a list of scenarios, asserts which routing decision
would be made — NOT whether the TS hook produces the right reply (we can't
execute TS in the sandbox).

Used in two ways:
  1. As a library (imported by tests/test_sim_router.py).
  2. As a CLI (`python sim_router.py <plugin-folder>`) — runs a default
     "smoke" scenario set derived from the manifest.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional


# ─── routing logic ────────────────────────────────────────────────────────────


def dice_similarity(a: str, b: str) -> float:
    """Approximate dice coefficient using SequenceMatcher.ratio()."""
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


_TOKEN_SPLIT = re.compile(r"[\s,.!?;:\"'()\[\]{}<>/\\|@#$%^&*=+~`-]+")


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN_SPLIT.split(text.lower()) if t]


@dataclass
class Plugin:
    name: str
    folder: Path
    match_type: str
    values: list[str] = field(default_factory=list)
    threshold: float = 0.6
    platforms: Optional[list[str]] = None
    hooks: set[str] = field(default_factory=set)

    @classmethod
    def load(cls, folder: Path) -> "Plugin":
        manifest = json.loads((folder / "plugin.json").read_text(encoding="utf-8"))
        match = manifest.get("match", {})
        return cls(
            name=manifest["name"],
            folder=folder,
            match_type=match.get("type", "all"),
            values=[v.lower() for v in match.get("values", [])],
            threshold=float(match.get("threshold", 0.6)),
            platforms=manifest.get("platforms"),
            hooks=_detect_hooks(folder),
        )


_DEFINE_PLUGIN_FUNCTION_FORM = re.compile(
    r"definePlugin\s*\(\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function\b)",
    re.MULTILINE,
)


def _detect_hooks(folder: Path) -> set[str]:
    """Re-uses parse_index_ts logic minimally."""
    for cand in ("index.ts", "index.js", "index.mjs"):
        p = folder / cand
        if p.is_file():
            src = p.read_text(encoding="utf-8")
            # Strip comments so // export default isn't picked up.
            src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
            src = re.sub(r"//[^\n]*", "", src)
            hooks = set()
            for hook in ("handle", "onMedia", "onJoin", "onLeave"):
                pat = rf"(?:^|[\s,{{])(?:async\s+)?{hook}\s*(?:\(|:\s*(?:async\s*)?(?:\(|function))"
                if re.search(pat, src, re.MULTILINE):
                    hooks.add(hook)
            # Function-form definePlugin → implicit handle.
            if "handle" not in hooks and _DEFINE_PLUGIN_FUNCTION_FORM.search(src):
                hooks.add("handle")
            return hooks
    return set()


@dataclass
class Msg:
    text: str
    event: str = "message"  # "message" | "media" | "join" | "leave"
    platform: str = "whatsapp"
    from_: str = "test-user"
    is_group: bool = False


@dataclass
class RouteDecision:
    plugin: Optional[str]   # name of plugin dispatched, or None
    hook: Optional[str]     # hook fired, or None
    via: str                # "conversation" | "keyword" | "regex" | "all" | "none"
    score: Optional[float] = None
    keyword: Optional[str] = None


# Hook needed for each event.
_HOOK_BY_EVENT = {"message": "handle", "media": "onMedia", "join": "onJoin", "leave": "onLeave"}


class ConversationStore:
    """Minimal stand-in for ctx.helpers.conversation."""

    def __init__(self):
        self._store: dict[str, dict] = {}

    def _key(self, from_: str, platform: str) -> str:
        return f"__conv__:{platform}:{from_}"

    def enter(self, from_: str, platform: str, plugin: str, state, ttl_ms: int, force: bool = False) -> None:
        k = self._key(from_, platform)
        if not force and k in self._store:
            return
        self._store[k] = {"plugin": plugin, "state": state}

    def current(self, from_: str, platform: str):
        return self._store.get(self._key(from_, platform))

    def exit(self, from_: str, platform: str) -> None:
        self._store.pop(self._key(from_, platform), None)


def route(msg: Msg, plugins: list[Plugin], conv: ConversationStore | None = None) -> RouteDecision:
    """Routing logic. Returns which plugin would handle this msg."""
    conv = conv or ConversationStore()

    # 1. Conversation lock.
    active = conv.current(msg.from_, msg.platform)
    if active:
        owner = next((p for p in plugins if p.name == active["plugin"]), None)
        if owner is not None:
            needed = _HOOK_BY_EVENT.get(msg.event)
            if needed and needed in owner.hooks:
                return RouteDecision(plugin=owner.name, hook=needed, via="conversation")

    # 2. Fuzzy keyword (only for "message" event).
    if msg.event == "message" and msg.text:
        best: Optional[RouteDecision] = None
        tokens = tokenize(msg.text)
        for plugin in plugins:
            if plugin.match_type != "keyword":
                continue
            if plugin.platforms is not None and msg.platform not in plugin.platforms:
                continue
            for token in tokens:
                for kw in plugin.values:
                    score = dice_similarity(token, kw)
                    if score < plugin.threshold:
                        continue
                    if best is None or score > (best.score or 0):
                        best = RouteDecision(
                            plugin=plugin.name,
                            hook="handle" if "handle" in plugin.hooks else None,
                            via="keyword",
                            score=score,
                            keyword=kw,
                        )
        if best and best.hook:
            return best

    # 3. Regex + all loop.
    for plugin in plugins:
        if plugin.match_type == "keyword":
            continue  # handled above
        if plugin.platforms is not None and msg.platform not in plugin.platforms:
            continue

        matches = False
        if plugin.match_type == "all":
            matches = True
        elif plugin.match_type == "regex":
            for pat in plugin.values:
                try:
                    if re.search(pat, msg.text or "", re.IGNORECASE):
                        matches = True
                        break
                except re.error:
                    continue

        if not matches:
            continue

        needed = _HOOK_BY_EVENT.get(msg.event)
        if needed and needed in plugin.hooks:
            return RouteDecision(plugin=plugin.name, hook=needed, via=plugin.match_type)

    return RouteDecision(plugin=None, hook=None, via="none")


# ─── CLI ──────────────────────────────────────────────────────────────────────


def default_scenarios(plugin: Plugin) -> list[tuple[str, Msg, dict]]:
    """Generate baseline scenarios from the manifest. Returns (label, msg, expectation)."""
    scenarios: list[tuple[str, Msg, dict]] = []

    if plugin.match_type == "keyword" and plugin.values:
        # Positive — exact keyword.
        kw = plugin.values[0]
        scenarios.append((
            f"positive: text matches keyword '{kw}'",
            Msg(text=kw),
            {"plugin": plugin.name, "via": "keyword"},
        ))
        # Negative — random text.
        scenarios.append((
            "negative: unrelated text",
            Msg(text="xyzzy nonsense"),
            {"plugin": None},
        ))

    elif plugin.match_type == "regex" and plugin.values:
        # Generate from regex if possible — fall back to a literal-ish probe.
        pat = plugin.values[0]
        probe = pat.replace("^", "").replace("$", "").replace(".+", "thing").replace("\\s+", " ").replace("\\s", " ")
        probe = re.sub(r"\\\.", ".", probe)
        scenarios.append((
            f"positive: text matches regex '{pat}'",
            Msg(text=probe),
            {"plugin": plugin.name, "via": "regex"},
        ))
        scenarios.append((
            "negative: empty text",
            Msg(text=""),
            {"plugin": None},
        ))

    elif plugin.match_type == "all":
        if "onMedia" in plugin.hooks:
            scenarios.append((
                "positive: media event",
                Msg(text="", event="media"),
                {"plugin": plugin.name, "via": "all", "hook": "onMedia"},
            ))
            scenarios.append((
                "negative: text-only event (onMedia not triggered)",
                Msg(text="hello"),
                {"plugin": None},
            ))
        if "onJoin" in plugin.hooks:
            scenarios.append((
                "positive: join event",
                Msg(text="", event="join", is_group=True),
                {"plugin": plugin.name, "via": "all", "hook": "onJoin"},
            ))
        if "onLeave" in plugin.hooks:
            scenarios.append((
                "positive: leave event",
                Msg(text="", event="leave", is_group=True),
                {"plugin": plugin.name, "via": "all", "hook": "onLeave"},
            ))

    return scenarios


def run_scenarios(plugin: Plugin, scenarios: list[tuple[str, Msg, dict]]) -> dict:
    results = []
    for label, msg, expect in scenarios:
        decision = route(msg, [plugin])
        actual = {"plugin": decision.plugin, "via": decision.via, "hook": decision.hook}
        ok = all(actual.get(k) == v for k, v in expect.items())
        results.append({
            "label": label,
            "expected": expect,
            "actual": actual,
            "ok": ok,
        })
    return {
        "ok": all(r["ok"] for r in results),
        "scenarios": results,
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "errors": ["usage: sim_router.py <plugin-folder>"]}))
        return 2

    plugin_dir = Path(sys.argv[1]).resolve()
    try:
        plugin = Plugin.load(plugin_dir)
    except Exception as e:
        print(json.dumps({"ok": False, "errors": [f"failed to load plugin: {e}"]}))
        return 2

    scenarios = default_scenarios(plugin)
    if not scenarios:
        print(json.dumps({
            "ok": True,
            "warnings": ["no scenarios derivable from manifest; skipping"],
            "plugin": plugin.name,
        }))
        return 0

    report = run_scenarios(plugin, scenarios)
    report["plugin"] = plugin.name
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
