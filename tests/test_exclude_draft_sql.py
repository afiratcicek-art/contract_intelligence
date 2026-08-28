"""TB-56: draft exclusion is pushed to PostgREST (.neq), not a Python filter.

Picker/list paths used to pull limit=500 then drop drafts in a comprehension.
That still transferred draft rows. These tests lock the SQL-side filter and
keep the round-trip count at one (not N+1).
"""
from backend.repositories.correspondence_repository import CorrespondenceRepository
from backend.repositories.rfi_repository import RFIRepository


class _RecordingQuery:
    def __init__(self, ops: list, data: list):
        self._ops = ops
        self._data = data

    def __getattr__(self, name):
        def _chain(*args, **kwargs):
            self._ops.append((name, args, kwargs))
            return self

        return _chain

    def execute(self):
        self._ops.append(("execute", (), {}))
        return type("R", (), {"data": self._data})()


class _RecordingDB:
    def __init__(self, data=None):
        self.ops: list = []
        self._data = data if data is not None else []

    def table(self, name):
        self.ops.append(("table", (name,), {}))
        return _RecordingQuery(self.ops, self._data)


def _neq_status(ops: list, value: str) -> bool:
    return any(
        name == "neq" and args == ("status", value) for name, args, _kwargs in ops
    )


def test_rfi_list_pushes_draft_exclusion_to_sql():
    db = _RecordingDB()
    RFIRepository(db).list_by_project("proj1", limit=500, exclude_status="draft")
    assert _neq_status(db.ops, "draft")
    assert sum(1 for name, _, _ in db.ops if name == "execute") == 1


def test_corr_list_pushes_draft_exclusion_to_sql():
    db = _RecordingDB()
    CorrespondenceRepository(db).list_by_project(
        "proj1", limit=500, exclude_status="draft"
    )
    assert _neq_status(db.ops, "draft")
    assert sum(1 for name, _, _ in db.ops if name == "execute") == 1


def test_rfi_list_omits_neq_when_exclude_status_unset():
    db = _RecordingDB()
    RFIRepository(db).list_by_project("proj1", limit=100)
    assert not _neq_status(db.ops, "draft")
