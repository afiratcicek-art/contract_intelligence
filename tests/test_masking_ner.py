"""Opt-in GLiNER NER tests (S2a / ADR-0004). CI skip — gliner requirements-dev'de yok.

İlk koşu ~800MB model indirir (urchade/gliner_multi-v2.1). Ali local koşar, CI koşmaz.
"""
import pytest

pytest.importorskip("gliner")

from backend.services.masking_service import detect_identity_spans


def test_detect_finds_org():
    spans = detect_identity_spans(
        "Notice from Acme Construction Ltd to Beta Engineering"
    )
    assert any(label == "organization" for _text, label in spans)
    assert any("Acme" in text for text, _label in spans)


def test_empty_text_returns_empty():
    assert detect_identity_spans("") == []
    assert detect_identity_spans("a") == []
