# Test suite — `bot-test-plugin-builder`

These tests verify the skill's own scripts and templates work correctly. They run in any Python 3.10+ environment.

## Run

```bash
cd bot-test-plugin-builder
python -m pytest tests/ -v
```

No external dependencies required — uses Python stdlib only (no `pytest` is required either; falls back to the bundled `unittest` mode if pytest isn't installed; see below).

If pytest is not available:

```bash
python -m unittest discover tests/ -v
```

## Coverage

| Test file | What it covers |
|---|---|
| `test_validate_plugin_json.py` | Schema validator — passes on valid fixtures, fails with correct errors on broken ones. |
| `test_parse_index_ts.py` | Static parser — detects `export default`, hooks, legacy API warnings, brace balance. |
| `test_sim_router.py` | Mock router — keyword fuzzy, regex, fallback `all`, conversation lock, platform whitelist. |
| `test_templates_render.py` | Template substitution produces output that validates + parses cleanly. |
| `test_package_tarball.py` | Tarball build — produces a valid `.tar.gz` with correct structure, exclusions honored. |

## Fixtures

`fixtures/` holds tiny sample plugins:

- `valid-keyword/` — passes all validators (FAQ-style).
- `valid-conversation/` — multi-step flow with cancel.
- `valid-event/` — onJoin/onLeave handler.
- `invalid-missing-name/` — schema fail case.
- `invalid-bad-threshold/` — threshold out of range.
