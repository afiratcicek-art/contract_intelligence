"""Citation-index filter — intelligence ask (server-side grounding)."""
from backend.services.intelligence_service import filter_citation_indices


def test_filter_citation_indices_keeps_valid_unique_order():
    assert filter_citation_indices([1, 3, 2, 3, "x", 0, 99], 3) == [1, 3, 2]


def test_filter_citation_indices_empty():
    assert filter_citation_indices([], 5) == []
    assert filter_citation_indices([1, 2], 0) == []
