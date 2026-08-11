"""DB-free unit tests for scripts.migrate (R-1 / ADR-0002)."""
from pathlib import Path

import pytest

from scripts.migrate import (
    detect_drift,
    discover_migrations,
    plan_pending,
)


def _write_sql(dir_path: Path, name: str, body: str = "-- noop\n") -> Path:
    path = dir_path / name
    path.write_text(body, encoding="utf-8")
    return path


def test_discover_migrations_int_sorted(tmp_path: Path):
    _write_sql(tmp_path, "001_a.sql")
    _write_sql(tmp_path, "003_b.sql")
    _write_sql(tmp_path, "002_c.sql")
    found = discover_migrations(tmp_path)
    assert [m.version for m in found] == ["001", "002", "003"]
    assert [m.filename for m in found] == ["001_a.sql", "002_c.sql", "003_b.sql"]


def test_discover_migrations_allows_version_gaps(tmp_path: Path):
    _write_sql(tmp_path, "039_x.sql")
    _write_sql(tmp_path, "043_y.sql")
    found = discover_migrations(tmp_path)
    assert [m.version for m in found] == ["039", "043"]


def test_checksum_deterministic_and_content_sensitive(tmp_path: Path):
    _write_sql(tmp_path, "001_a.sql", "alpha\n")
    first = discover_migrations(tmp_path)[0]
    again = discover_migrations(tmp_path)[0]
    assert first.checksum == again.checksum

    _write_sql(tmp_path, "001_a.sql", "beta\n")
    changed = discover_migrations(tmp_path)[0]
    assert changed.checksum != first.checksum


def test_discover_migrations_rejects_bad_filename(tmp_path: Path):
    _write_sql(tmp_path, "bad_name.sql")
    with pytest.raises(ValueError, match="bad_name\\.sql"):
        discover_migrations(tmp_path)


def test_plan_pending_empty_partial_full(tmp_path: Path):
    _write_sql(tmp_path, "001_a.sql")
    _write_sql(tmp_path, "002_b.sql")
    _write_sql(tmp_path, "003_c.sql")
    discovered = discover_migrations(tmp_path)

    assert plan_pending(discovered, set()) == discovered
    assert [m.version for m in plan_pending(discovered, {"001"})] == ["002", "003"]
    assert plan_pending(discovered, {"001", "002", "003"}) == []


def test_detect_drift_matching_and_mismatched(tmp_path: Path):
    _write_sql(tmp_path, "001_a.sql", "same\n")
    _write_sql(tmp_path, "002_b.sql", "other\n")
    discovered = discover_migrations(tmp_path)
    by_v = {m.version: m.checksum for m in discovered}

    assert detect_drift(discovered, dict(by_v)) == []
    drifted = detect_drift(
        discovered,
        {"001": by_v["001"], "002": "deadbeef" * 8},
    )
    assert drifted == ["002"]
