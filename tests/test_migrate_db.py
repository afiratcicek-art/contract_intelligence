"""DB-free unit tests for scripts._db + adopt plan (R-2/R-3 / ADR-0002)."""
import pytest

from scripts._db import load_migration_url, redact
from scripts.migrate import Migration, plan_adopt


def test_redact_masks_password_keeps_user_host_db():
    raw = "postgresql://alice:s3cret@db.example:5432/clauseiq"
    out = redact(raw)
    assert "s3cret" not in out
    assert "***" in out
    assert "alice" in out
    assert "db.example" in out
    assert "5432" in out
    assert "clauseiq" in out
    assert out.startswith("postgresql://")


def test_redact_passwordless_url_unchanged():
    raw = "postgresql://alice@db.example:5432/clauseiq"
    assert redact(raw) == raw


def test_redact_malformed_credentialish_string_does_not_leak():
    raw = "not-a-url://user:hunter2@somewhere"
    out = redact(raw)
    assert "hunter2" not in out


def test_redact_plain_non_url_passthrough():
    assert redact("just-a-word") == "just-a-word"


def test_load_migration_url_returns_value(monkeypatch):
    secret = "postgresql://u:p@h/db"

    def fake_dotenv_values(_path):
        return {"MIGRATION_DATABASE_URL": secret}

    monkeypatch.setattr("scripts._db.dotenv_values", fake_dotenv_values)
    assert load_migration_url() == secret


def test_load_migration_url_missing_raises_without_leaking(monkeypatch):
    def fake_dotenv_values(_path):
        return {}

    monkeypatch.setattr("scripts._db.dotenv_values", fake_dotenv_values)
    with pytest.raises(RuntimeError) as excinfo:
        load_migration_url()
    msg = str(excinfo.value)
    assert "MIGRATION_DATABASE_URL" in msg
    assert "postgresql://" not in msg
    assert "PASSWORD" not in msg
    assert "s3cret" not in msg


def _m(version: str, checksum: str = "abc") -> Migration:
    return Migration(version=version, filename=f"{version}_x.sql", checksum=checksum)


def test_plan_adopt_empty_applied_all_to_insert():
    discovered = [_m("001"), _m("002"), _m("003")]
    to_insert, drift = plan_adopt(discovered, {})
    assert to_insert == discovered
    assert drift == []


def test_plan_adopt_partial_applied_matching_checksum():
    discovered = [_m("001", "h1"), _m("002", "h2"), _m("003", "h3")]
    applied = {"001": "h1"}
    to_insert, drift = plan_adopt(discovered, applied)
    assert [m.version for m in to_insert] == ["002", "003"]
    assert drift == []


def test_plan_adopt_drift_excludes_version_from_insert():
    discovered = [_m("001", "disk-hash"), _m("002", "h2")]
    applied = {"001": "other-hash"}
    to_insert, drift = plan_adopt(discovered, applied)
    assert drift == ["001"]
    assert [m.version for m in to_insert] == ["002"]
    assert "001" not in [m.version for m in to_insert]
