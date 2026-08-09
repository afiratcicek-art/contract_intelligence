"""assert_project_storage_path birim testleri — SEC-H4 storage-path scoping guard.

Saf fonksiyon: boş/traversal/cross-project path'leri, service_role storage
çağrısından ÖNCE reddeder. DB yok, mock yok. Path-scoping invariant'ını
regresyona karşı kilitler.
"""
import pytest

from backend.utils.file_handler import assert_project_storage_path


def test_valid_path_returns_normalized():
    assert assert_project_storage_path("proj1/file.docx", "proj1") == "proj1/file.docx"


def test_backslashes_normalized_to_forward():
    assert assert_project_storage_path("proj1\\sub\\file.docx", "proj1") == "proj1/sub/file.docx"


def test_leading_slash_stripped():
    assert assert_project_storage_path("/proj1/file.docx", "proj1") == "proj1/file.docx"


def test_empty_storage_path_rejected():
    with pytest.raises(ValueError):
        assert_project_storage_path("", "proj1")


def test_empty_project_id_rejected():
    with pytest.raises(ValueError):
        assert_project_storage_path("proj1/file.docx", "")


def test_parent_traversal_rejected():
    with pytest.raises(ValueError):
        assert_project_storage_path("proj1/../proj2/secret.docx", "proj1")


def test_leading_traversal_rejected():
    with pytest.raises(ValueError):
        assert_project_storage_path("../proj1/file.docx", "proj1")


def test_cross_project_prefix_rejected():
    with pytest.raises(ValueError):
        assert_project_storage_path("proj2/file.docx", "proj1")


def test_prefix_partial_match_rejected():
    # "proj1abc/" proje "proj1" için kapsam sağlamamalı — trailing-slash bunu korur
    with pytest.raises(ValueError):
        assert_project_storage_path("proj1abc/file.docx", "proj1")
