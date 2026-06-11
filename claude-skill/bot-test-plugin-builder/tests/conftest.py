"""Shared pytest fixtures + path setup."""

from __future__ import annotations

import sys
from pathlib import Path

# Make `scripts/` importable as top-level modules in tests.
SKILL_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

import pytest  # noqa: E402


@pytest.fixture
def fixtures_dir() -> Path:
    return Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def skill_root() -> Path:
    return SKILL_ROOT
