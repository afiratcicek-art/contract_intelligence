"""_assert_template_in_project birim testleri — cross-project IDOR guard.

delete/get yollarında şablonun path'teki projeye ait olduğunu doğrular;
uyuşmazlıkta NotFoundError (404). Saf; DB/mock yok.
"""
import pytest

from backend.core.exceptions import NotFoundError
from backend.routers.document_authoring import _assert_template_in_project


def test_matching_project_passes():
    _assert_template_in_project({"project_id": "proj1"}, "proj1")


def test_mismatched_project_raises_not_found():
    with pytest.raises(NotFoundError):
        _assert_template_in_project({"project_id": "proj2"}, "proj1")


def test_missing_project_id_key_raises_not_found():
    with pytest.raises(NotFoundError):
        _assert_template_in_project({}, "proj1")
