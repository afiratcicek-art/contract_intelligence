"""Authoring router unit tests — IDOR guard + TB-55 chrome cleanup.

delete/get yollarında şablonun path'teki projeye ait olduğunu doğrular;
uyuşmazlıkta NotFoundError (404). Chrome cleanup her path'i izole eder
ki bir Storage hatası audit log'u atlamasın. Saf; DB yok.
"""
import pytest

from backend.core.exceptions import NotFoundError
from backend.routers.document_authoring import (
    _assert_template_in_project,
    _delete_chrome_best_effort,
)


def test_matching_project_passes():
    _assert_template_in_project({"project_id": "proj1"}, "proj1")


def test_mismatched_project_raises_not_found():
    with pytest.raises(NotFoundError):
        _assert_template_in_project({"project_id": "proj2"}, "proj1")


def test_missing_project_id_key_raises_not_found():
    with pytest.raises(NotFoundError):
        _assert_template_in_project({}, "proj1")


def test_chrome_cleanup_continues_after_storage_error(monkeypatch):
    seen: list[str] = []

    def boom(path: str, project_id: str) -> None:
        seen.append(path)
        raise RuntimeError("already gone")

    monkeypatch.setattr(
        "backend.routers.document_authoring.delete_document", boom
    )
    _delete_chrome_best_effort(
        ["proj1/header.png", "proj1/footer.png"],
        "proj1",
        template_id="tpl-1",
    )
    assert seen == ["proj1/header.png", "proj1/footer.png"]


def test_chrome_cleanup_skips_empty_path_list(monkeypatch):
    def boom(path: str, project_id: str) -> None:
        raise AssertionError("delete_document must not run")

    monkeypatch.setattr(
        "backend.routers.document_authoring.delete_document", boom
    )
    _delete_chrome_best_effort([], "proj1", template_id="tpl-1")
