"""TB-20 — verify_project_access membership cache.

Locks the five security constraints from TECHNICAL_DEBT.md:
  1. key is user_id + project_id (not project_id alone)
  2. JWT-scoped db client is never stored; rebuilt per request
  3. TTL <= 60s
  4. invalidate_access_cache drops the entry (membership mutation)
  5. in-memory / per-worker is documented; this test is single-process

No network. Fake PostgREST client + in-process cache.
"""
from uuid import uuid4

import pytest

from backend.core.cache import cache_delete_prefix, cache_get, cache_set
from backend.core.dependencies import (
    _ACCESS_CACHE_TTL,
    _access_cache_key,
    invalidate_access_cache,
    verify_project_access,
)
from backend.core.exceptions import NotFoundError


PROJECT_A = uuid4()
USER_A = str(uuid4())
USER_B = str(uuid4())
TENANT = str(uuid4())


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, db, table_name):
        self._db = db
        self._table = table_name
        self._filters = {}

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def single(self):
        return self

    def execute(self):
        self._db.execute_count += 1
        self._db.tokens_on_execute.append(self._db.token)
        row = self._db.rows.get(self._table)
        if row is None:
            return _FakeResult(None)
        for col, val in self._filters.items():
            if str(row.get(col)) != str(val):
                return _FakeResult(None)
        return _FakeResult(row)


class FakeAuthedDB:
    """One JWT-scoped client. execute_count is the round-trip meter."""

    def __init__(self, token: str, rows: dict):
        self.token = token
        self.rows = rows
        self.execute_count = 0
        self.tokens_on_execute = []

    def table(self, name: str):
        return _FakeQuery(self, name)


@pytest.fixture(autouse=True)
def _isolate_access_cache():
    cache_delete_prefix("access:")
    yield
    cache_delete_prefix("access:")


def _user(user_id: str, token: str) -> dict:
    return {
        "id": user_id,
        "tenant_id": TENANT,
        "is_active": True,
        "_meta": {"token": token},
    }


def _rows(*, role="cm", is_active=True, tenant=TENANT, project_id=None):
    pid = str(project_id or PROJECT_A)
    return {
        "projects": {"id": pid, "tenant_id": tenant, "is_deleted": False},
        "project_members": {
            "user_id": USER_A,
            "project_id": pid,
            "project_role": role,
            "is_active": is_active,
        },
    }


def _patch_db(monkeypatch, factory):
    monkeypatch.setattr("backend.core.dependencies.get_authed_db", factory)


def test_access_ttl_is_at_most_60_seconds():
    assert 0 < _ACCESS_CACHE_TTL <= 60


def test_cache_key_contains_user_and_project_not_project_alone():
    key = _access_cache_key(USER_A, str(PROJECT_A))
    assert USER_A in key
    assert str(PROJECT_A) in key
    assert key.startswith("access:")
    assert key != f"access:{PROJECT_A}"
    assert key != str(PROJECT_A)


def test_cache_hit_skips_membership_queries_but_rebuilds_db(monkeypatch):
    clients: list[FakeAuthedDB] = []

    def factory(token: str):
        db = FakeAuthedDB(token, _rows())
        clients.append(db)
        return db

    _patch_db(monkeypatch, factory)
    user = _user(USER_A, "tok-1")

    first = verify_project_access(PROJECT_A, current_user=user)
    second = verify_project_access(PROJECT_A, current_user=user)

    assert first["member"]["project_role"] == "cm"
    assert second["member"]["project_role"] == "cm"
    # Miss: 2 queries (project + member). Hit: 0 queries on the second client.
    assert clients[0].execute_count == 2
    assert clients[1].execute_count == 0
    # Constraint 2: a new client per call, never a cached db object.
    assert first["db"] is not second["db"]
    assert clients[0].token == "tok-1"
    assert clients[1].token == "tok-1"


def test_two_users_do_not_share_an_access_entry(monkeypatch):
    def factory(token: str):
        pid = str(PROJECT_A)
        uid = USER_A if token == "tok-a" else USER_B
        return FakeAuthedDB(
            token,
            {
                "projects": {"id": pid, "tenant_id": TENANT, "is_deleted": False},
                "project_members": {
                    "user_id": uid,
                    "project_id": pid,
                    "project_role": "cm" if token == "tok-a" else "viewer",
                    "is_active": True,
                },
            },
        )

    _patch_db(monkeypatch, factory)
    a = verify_project_access(PROJECT_A, current_user=_user(USER_A, "tok-a"))
    b = verify_project_access(PROJECT_A, current_user=_user(USER_B, "tok-b"))
    assert a["member"]["project_role"] == "cm"
    assert b["member"]["project_role"] == "viewer"
    assert _access_cache_key(USER_A, str(PROJECT_A)) != _access_cache_key(
        USER_B, str(PROJECT_A)
    )


def test_cached_payload_does_not_contain_db(monkeypatch):
    _patch_db(monkeypatch, lambda token: FakeAuthedDB(token, _rows()))
    verify_project_access(PROJECT_A, current_user=_user(USER_A, "tok-1"))
    stored = cache_get(_access_cache_key(USER_A, str(PROJECT_A)))
    assert stored is not None
    assert "db" not in stored
    assert "member" in stored
    assert stored["member"]["project_role"] == "cm"


def test_mutating_returned_member_does_not_poison_cache(monkeypatch):
    _patch_db(monkeypatch, lambda token: FakeAuthedDB(token, _rows()))
    user = _user(USER_A, "tok-1")
    first = verify_project_access(PROJECT_A, current_user=user)
    first["member"]["project_role"] = "viewer"
    second = verify_project_access(PROJECT_A, current_user=user)
    assert second["member"]["project_role"] == "cm"


def test_denied_access_is_not_cached(monkeypatch):
    empty = {"projects": None, "project_members": None}

    def factory(token: str):
        return FakeAuthedDB(token, empty)

    _patch_db(monkeypatch, factory)
    with pytest.raises(NotFoundError):
        verify_project_access(PROJECT_A, current_user=_user(USER_A, "tok-1"))
    assert cache_get(_access_cache_key(USER_A, str(PROJECT_A))) is None


def test_invalidate_drops_cached_membership(monkeypatch):
    _patch_db(monkeypatch, lambda token: FakeAuthedDB(token, _rows()))
    user = _user(USER_A, "tok-1")
    verify_project_access(PROJECT_A, current_user=user)
    assert cache_get(_access_cache_key(USER_A, str(PROJECT_A))) is not None
    invalidate_access_cache(USER_A, str(PROJECT_A))
    assert cache_get(_access_cache_key(USER_A, str(PROJECT_A))) is None


def test_inactive_cached_member_is_not_served(monkeypatch):
    """Defense: a stale is_active=False payload must not grant access."""
    key = _access_cache_key(USER_A, str(PROJECT_A))
    cache_set(
        key,
        {
            "member": {
                "user_id": USER_A,
                "project_role": "cm",
                "is_active": False,
            }
        },
        30,
    )
    db = FakeAuthedDB("tok-1", _rows(is_active=False))
    _patch_db(monkeypatch, lambda token: db)
    with pytest.raises(NotFoundError):
        verify_project_access(PROJECT_A, current_user=_user(USER_A, "tok-1"))
    assert db.execute_count == 2


def test_update_member_and_add_member_call_invalidate():
    """Wiring invariant — source, not runtime. Breaks if the call is removed."""
    from pathlib import Path

    src = Path("backend/routers/projects.py").read_text(encoding="utf-8")
    assert "invalidate_access_cache" in src
    assert src.count("invalidate_access_cache(") >= 2
