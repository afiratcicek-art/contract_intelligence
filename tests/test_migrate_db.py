"""DB-free unit tests for scripts._db (R-2 / ADR-0002)."""
import pytest

from scripts._db import load_migration_url, redact


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
