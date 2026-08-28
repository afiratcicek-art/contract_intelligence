"""Dispute Ready dossier — IDOR, numbering, CM gate, nested select, pack, chronology.

Mock supabase like test_authoring_guards / test_exclude_draft_sql. No network.
"""
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from starlette.requests import Request

from backend.core.dependencies import require_cm_role, verify_project_access
from backend.core.exceptions import ForbiddenError, NotFoundError
from backend.models.chronology import CHRONOLOGY_ENTITY_TYPES
from backend.models.dispute import NESTED_SELECT, PositionRefCreate
from backend.repositories.dispute_repository import DisputeRepository
from backend.routers.disputes import (
    _assert_dispute_in_project,
    create_dispute,
    get_dispute,
    prepare_pack,
    update_dispute,
)
from backend.routers.documents import VALID_ENTITY_TYPES
from backend.services import dispute_pack


PROJECT_A = str(uuid4())
PROJECT_B = str(uuid4())
USER_CM = str(uuid4())
DISPUTE_A = str(uuid4())


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table_name):
        self._db = db
        self._table = table_name
        self._filters = {}
        self._select = "*"
        self._single = False
        self._op = "select"
        self._payload = None

    def select(self, cols, **_k):
        self._select = cols
        self._db.selects.append((self._table, cols))
        return self

    def insert(self, data):
        self._op = "insert"
        self._payload = data
        return self

    def update(self, data):
        self._op = "update"
        self._payload = data
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, col, val):
        self._filters[col] = str(val)
        return self

    def order(self, *a, **k):
        return self

    def limit(self, n):
        return self

    def offset(self, n):
        return self

    def single(self):
        self._single = True
        return self

    def execute(self):
        self._db.execute_count += 1
        rows = self._db.tables.get(self._table, [])

        if self._op == "insert":
            row = dict(self._payload)
            row.setdefault("id", str(uuid4()))
            row.setdefault("created_at", "2026-08-27T00:00:00Z")
            rows.append(row)
            self._db.tables[self._table] = rows
            self._db.inserts.append((self._table, row))
            return _Result([row])

        if self._op == "update":
            updated = []
            for row in rows:
                if all(str(row.get(c)) == str(v) for c, v in self._filters.items()):
                    row.update(self._payload)
                    updated.append(row)
            return _Result(updated)

        if self._op == "delete":
            self._db.tables[self._table] = [
                r for r in rows
                if not all(str(r.get(c)) == str(v) for c, v in self._filters.items())
            ]
            return _Result([])

        matched = []
        for row in rows:
            if all(str(row.get(c)) == str(v) for c, v in self._filters.items()):
                matched.append(dict(row))
        if self._single:
            return _Result(matched[0] if matched else None)
        return _Result(matched)


class FakeDB:
    def __init__(self):
        self.tables: dict = {}
        self.selects: list = []
        self.inserts: list = []
        self.execute_count = 0

    def table(self, name: str):
        self.tables.setdefault(name, [])
        return _Query(self, name)


def _request() -> Request:
    return Request({
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [],
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
    })


def _create_body(title="Facade delay", origin="change"):
    body = MagicMock()
    body.source_change_id = None
    body.source_correspondence_id = None
    body.model_dump = lambda **k: {
        "title": title,
        "origin": origin,
        "status": "draft",
    }
    return body


def _cm_access(db, project_id=PROJECT_A):
    return {
        "user": {"id": USER_CM},
        "member": {"project_role": "cm", "user_id": USER_CM},
        "project_id": project_id,
        "db": db,
    }


def _engineer_access(db, project_id=PROJECT_A):
    return {
        "user": {"id": str(uuid4())},
        "member": {"project_role": "engineer", "user_id": "x"},
        "project_id": project_id,
        "db": db,
    }


def test_assert_matching_project_passes():
    _assert_dispute_in_project({"project_id": PROJECT_A}, PROJECT_A)


def test_assert_cross_project_is_404():
    with pytest.raises(NotFoundError):
        _assert_dispute_in_project({"project_id": PROJECT_A}, PROJECT_B)


def test_assert_missing_row_is_404():
    with pytest.raises(NotFoundError):
        _assert_dispute_in_project(None, PROJECT_A)


def test_get_dispute_cross_project_404():
    db = FakeDB()
    db.tables["disputes"] = [{
        "id": DISPUTE_A,
        "project_id": PROJECT_A,
        "dispute_number": "DSP-001",
        "title": "X",
        "dispute_impacts": [],
        "dispute_issues": [],
    }]
    with pytest.raises(NotFoundError):
        get_dispute(UUID(PROJECT_B), UUID(DISPUTE_A), _cm_access(db, PROJECT_B))


def test_numbering_dsp_001_then_002():
    db = FakeDB()
    repo = DisputeRepository(db)
    assert repo.next_number(PROJECT_A) == "DSP-001"
    db.tables["disputes"] = [
        {"dispute_number": "DSP-001", "project_id": PROJECT_A},
    ]
    assert repo.next_number(PROJECT_A) == "DSP-002"


def test_numbering_ignores_other_projects_and_gaps():
    db = FakeDB()
    db.tables["disputes"] = [
        {"dispute_number": "DSP-007", "project_id": PROJECT_A},
        {"dispute_number": "DSP-040", "project_id": PROJECT_B},
        {"dispute_number": "OTHER", "project_id": PROJECT_A},
    ]
    repo = DisputeRepository(db)
    assert repo.next_number(PROJECT_A) == "DSP-008"


def test_nested_get_uses_one_nested_select():
    db = FakeDB()
    db.tables["disputes"] = [{
        "id": DISPUTE_A,
        "project_id": PROJECT_A,
        "dispute_impacts": [],
        "dispute_issues": [],
    }]
    repo = DisputeRepository(db)
    row = repo.get_nested(DISPUTE_A)
    assert row["id"] == DISPUTE_A
    assert any(cols == NESTED_SELECT for _t, cols in db.selects)
    assert db.execute_count == 1


def test_chronology_entity_type_includes_dispute():
    assert "dispute" in CHRONOLOGY_ENTITY_TYPES


def test_documents_valid_entity_includes_dispute():
    assert "dispute" in VALID_ENTITY_TYPES


def test_create_does_not_auto_create_empty_chronology(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(
        "backend.routers.disputes.AuditService",
        lambda: MagicMock(),
    )
    result = create_dispute(
        _request(),
        UUID(PROJECT_A),
        _create_body(),
        _cm_access(db),
    )
    chrono_inserts = [r for t, r in db.inserts if t == "chronologies"]
    assert chrono_inserts == []
    assert result.get("chronology_id") in (None, "")
    assert result["dispute_number"] == "DSP-001"


def test_create_links_existing_change_chronology(monkeypatch):
    db = FakeDB()
    change_id = str(uuid4())
    chrono_id = str(uuid4())
    db.tables["chronologies"] = [{
        "id": chrono_id,
        "project_id": PROJECT_A,
        "entity_type": "change",
        "entity_id": change_id,
        "is_active": True,
        "title": "Change chrono",
    }]
    db.tables["changes"] = [{
        "id": change_id,
        "project_id": PROJECT_A,
    }]
    monkeypatch.setattr(
        "backend.routers.disputes.AuditService",
        lambda: MagicMock(),
    )
    body = _create_body()
    body.source_change_id = change_id
    body.model_dump = lambda **k: {
        "title": "Facade delay",
        "origin": "change",
        "status": "draft",
        "source_change_id": change_id,
    }
    result = create_dispute(
        _request(),
        UUID(PROJECT_A),
        body,
        _cm_access(db),
    )
    assert result["chronology_id"] == chrono_id
    assert result["chronology_entity_type"] == "change"
    assert [r for t, r in db.inserts if t == "chronologies"] == []


def test_second_create_gets_dsp_002(monkeypatch):
    db = FakeDB()
    db.tables["disputes"] = [{
        "id": str(uuid4()),
        "project_id": PROJECT_A,
        "dispute_number": "DSP-001",
    }]
    monkeypatch.setattr(
        "backend.routers.disputes.AuditService",
        lambda: MagicMock(),
    )
    result = create_dispute(
        _request(),
        UUID(PROJECT_A),
        _create_body("Two", "manual"),
        _cm_access(db),
    )
    assert result["dispute_number"] == "DSP-002"


def test_write_routes_use_require_cm_role():
    from backend.routers import disputes as disputes_mod

    write_methods = {"POST", "PATCH", "PUT", "DELETE"}
    gated = 0
    for route in disputes_mod.router.routes:
        methods = getattr(route, "methods", set()) or set()
        if not (methods & write_methods):
            continue
        path = getattr(route, "path", "")
        dependant = getattr(route, "dependant", None)
        deps = []
        if dependant is not None:
            deps = [d.call for d in dependant.dependencies if getattr(d, "call", None)]
        assert require_cm_role in deps, f"{methods} {path} missing require_cm_role"
        gated += 1
    assert gated >= 4


def test_get_routes_use_verify_project_access():
    from backend.routers import disputes as disputes_mod

    found = 0
    for route in disputes_mod.router.routes:
        methods = getattr(route, "methods", set()) or set()
        if "GET" not in methods or (methods & {"POST", "PATCH", "PUT", "DELETE"}):
            continue
        dependant = getattr(route, "dependant", None)
        deps = []
        if dependant is not None:
            deps = [d.call for d in dependant.dependencies if getattr(d, "call", None)]
        assert verify_project_access in deps
        found += 1
    assert found >= 2


def test_require_cm_role_rejects_engineer():
    with pytest.raises(ForbiddenError):
        require_cm_role(_engineer_access(FakeDB()))


def test_pack_does_not_import_openai_or_embedding():
    import inspect
    src = inspect.getsource(dispute_pack)
    assert "import openai" not in src
    assert "from openai" not in src
    assert "get_embedding" not in src
    assert "OpenAI" not in src
    assert "anthropic" not in src.lower()
    assert "claude_service" not in src


def test_prepare_pack_does_not_call_openai(monkeypatch):
    db = FakeDB()
    db.tables["disputes"] = [{
        "id": DISPUTE_A,
        "project_id": PROJECT_A,
        "dispute_number": "DSP-001",
        "title": "X",
        "status": "open",
        "dispute_impacts": [],
        "dispute_issues": [],
        "chronology_id": None,
    }]
    monkeypatch.setattr(
        "backend.routers.disputes.AuditService",
        lambda: MagicMock(),
    )
    monkeypatch.setattr(
        "backend.services.dispute_pack.upload_document",
        lambda *a, **k: f"{PROJECT_A}/dispute/{DISPUTE_A}/pack.docx",
    )
    result = prepare_pack(
        _request(),
        UUID(PROJECT_A),
        UUID(DISPUTE_A),
        _cm_access(db),
    )
    assert result["pack_storage_path"]
    assert result["status"] == "prepared"


def test_position_ref_xor_rejects_mixed_manual():
    with pytest.raises(ValidationError):
        PositionRefCreate(
            ref_type="manual",
            entity_id=uuid4(),
            manual_title="Letter",
        )


def test_position_ref_system_requires_target():
    with pytest.raises(ValidationError):
        PositionRefCreate(ref_type="correspondence")


def test_update_cross_project_404(monkeypatch):
    db = FakeDB()
    db.tables["disputes"] = [{
        "id": DISPUTE_A,
        "project_id": PROJECT_A,
        "title": "X",
    }]
    monkeypatch.setattr(
        "backend.routers.disputes.AuditService",
        lambda: MagicMock(),
    )
    body = MagicMock()
    body.source_change_id = None
    body.source_correspondence_id = None
    body.model_dump = lambda **k: {"title": "nope"}
    with pytest.raises(NotFoundError):
        update_dispute(
            _request(),
            UUID(PROJECT_B),
            UUID(DISPUTE_A),
            body,
            _cm_access(db, PROJECT_B),
        )
