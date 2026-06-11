from pathlib import Path

from sim_router import Plugin, Msg, ConversationStore, route, dice_similarity, tokenize


def test_dice_similarity_basics():
    assert dice_similarity("price", "price") == 1.0
    assert dice_similarity("price", "prce") > 0.5  # toleran typo
    assert dice_similarity("apple", "banana") < 0.3
    assert dice_similarity("", "x") == 0.0


def test_tokenize_splits_correctly():
    assert tokenize("hello world!") == ["hello", "world"]
    assert tokenize("Price: $10/box") == ["price", "10", "box"]
    assert tokenize("") == []


def test_keyword_positive(fixtures_dir: Path):
    plugin = Plugin.load(fixtures_dir / "valid-keyword")
    decision = route(Msg(text="price please"), [plugin])
    assert decision.plugin == "valid-keyword"
    assert decision.via == "keyword"


def test_keyword_typo_still_matches(fixtures_dir: Path):
    plugin = Plugin.load(fixtures_dir / "valid-keyword")
    # "prce" vs "price" should clear default 0.6 threshold via difflib ratio.
    decision = route(Msg(text="prce?"), [plugin])
    assert decision.plugin == "valid-keyword", f"got {decision}"


def test_keyword_negative(fixtures_dir: Path):
    plugin = Plugin.load(fixtures_dir / "valid-keyword")
    decision = route(Msg(text="totally unrelated"), [plugin])
    assert decision.plugin is None


def test_keyword_above_threshold_only(tmp_path: Path):
    """Custom threshold isolates matches."""
    folder = tmp_path / "strict"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name":"strict","enabled":true,"match":{"type":"keyword","values":["banana"],"threshold":0.95}}',
        encoding="utf-8",
    )
    (folder / "index.ts").write_text("export default { async handle(){} };", encoding="utf-8")
    plugin = Plugin.load(folder)
    # "banaaa" vs "banana" ~ 0.83 → below 0.95.
    decision = route(Msg(text="banaaa"), [plugin])
    assert decision.plugin is None
    # Exact match passes.
    decision = route(Msg(text="banana"), [plugin])
    assert decision.plugin == "strict"


def test_regex_match(tmp_path: Path):
    folder = tmp_path / "reg"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name":"reg","enabled":true,"match":{"type":"regex","values":["^echo\\\\s+.+"]}}',
        encoding="utf-8",
    )
    (folder / "index.ts").write_text("export default { async handle(){} };", encoding="utf-8")
    plugin = Plugin.load(folder)
    assert route(Msg(text="echo hello"), [plugin]).plugin == "reg"
    assert route(Msg(text="hello"), [plugin]).plugin is None


def test_all_event_only_plugin(fixtures_dir: Path):
    plugin = Plugin.load(fixtures_dir / "valid-event")
    # Text message → no dispatch (no `handle` declared).
    assert route(Msg(text="hello"), [plugin]).plugin is None
    # Join event → onJoin fires.
    decision = route(Msg(text="", event="join"), [plugin])
    assert decision.plugin == "valid-event"
    assert decision.hook == "onJoin"
    # Leave event.
    decision = route(Msg(text="", event="leave"), [plugin])
    assert decision.hook == "onLeave"


def test_conversation_lock_overrides_matching(fixtures_dir: Path):
    plugin = Plugin.load(fixtures_dir / "valid-conversation")
    conv = ConversationStore()
    conv.enter("u1", "whatsapp", "valid-conversation", {"step": "ask"}, 60_000)
    # Even if text doesn't match keyword "start", router dispatches to flow owner.
    decision = route(Msg(text="qty 2", from_="u1"), [plugin], conv)
    assert decision.plugin == "valid-conversation"
    assert decision.via == "conversation"


def test_conversation_lock_isolated_per_platform(fixtures_dir: Path):
    plugin = Plugin.load(fixtures_dir / "valid-conversation")
    conv = ConversationStore()
    conv.enter("u1", "whatsapp", "valid-conversation", {"step": "ask"}, 60_000)
    # Same from on a different platform = no lock.
    decision = route(Msg(text="random", from_="u1", platform="telegram"), [plugin], conv)
    assert decision.plugin is None


def test_conversation_force_overrides(fixtures_dir: Path):
    plugin = Plugin.load(fixtures_dir / "valid-conversation")
    conv = ConversationStore()
    conv.enter("u1", "whatsapp", "valid-conversation", {"step": "ask"}, 60_000)
    conv.enter("u1", "whatsapp", "different-plugin", {"x": 1}, 60_000, force=True)
    assert conv.current("u1", "whatsapp")["plugin"] == "different-plugin"


def test_platform_whitelist(tmp_path: Path):
    folder = tmp_path / "wa-only"
    folder.mkdir()
    (folder / "plugin.json").write_text(
        '{"name":"wa-only","enabled":true,"platforms":["whatsapp"],"match":{"type":"keyword","values":["go"]}}',
        encoding="utf-8",
    )
    (folder / "index.ts").write_text("export default { async handle(){} };", encoding="utf-8")
    plugin = Plugin.load(folder)
    assert route(Msg(text="go", platform="whatsapp"), [plugin]).plugin == "wa-only"
    assert route(Msg(text="go", platform="telegram"), [plugin]).plugin is None


def test_multiple_plugins_keyword_winner_takes(tmp_path: Path):
    """When 2 keyword plugins both could match, highest-score wins."""
    a = tmp_path / "a"
    b = tmp_path / "b"
    for d, kw in [(a, "apple"), (b, "banana")]:
        d.mkdir()
        (d / "plugin.json").write_text(
            f'{{"name":"{d.name}","enabled":true,"match":{{"type":"keyword","values":["{kw}"]}}}}',
            encoding="utf-8",
        )
        (d / "index.ts").write_text("export default { async handle(){} };", encoding="utf-8")
    plugins = [Plugin.load(a), Plugin.load(b)]
    decision = route(Msg(text="apple please"), plugins)
    assert decision.plugin == "a"
