"""P-B6: detect_identity_spans windowing (F1). CI-hermetic — fake GLiNER, no model download."""
from __future__ import annotations

import re

import pytest

from backend.services import masking_service as ms
from backend.services.masking_service import detect_identity_spans

_SPLIT_RE = re.compile(r"\w+(?:[-_]\w+)*|\S")
_BURIED = "Northwind Placeholder Ltd."
_SHORT_ORG = "Acme Construction Ltd"
_OVERLAP_ORG = "Zenith Contracting LLC"


class _Cfg:
    def __init__(self, max_len: int = 384):
        self.max_len = max_len


class _Splitter:
    def __call__(self, text: str):
        for m in _SPLIT_RE.finditer(text):
            yield m.group(), m.start(), m.end()


class _DP:
    words_splitter = _Splitter()


class _FakeGliner:
    """Simulates GLiNER word-token truncation at config.max_len."""

    def __init__(self, entities: list[tuple[str, str]], max_len: int = 384, fail=None):
        self.config = _Cfg(max_len)
        self.data_processor = _DP()
        self.entities = list(entities)
        self.fail = fail
        self.predict_calls: list[str] = []
        self.batch_calls: list[list[str]] = []

    def _scan(self, text: str, truncate_to: int | None = None) -> list[dict]:
        toks = list(self.data_processor.words_splitter(text))
        visible = text
        if truncate_to is not None and len(toks) > truncate_to:
            visible = text[: toks[truncate_to - 1][2]]
        hits = []
        for name, label in self.entities:
            if name in visible:
                hits.append({"text": name, "label": label})
        return hits

    def predict_entities(self, text, labels, threshold=0.5, **kwargs):
        self.predict_calls.append(text)
        if self.fail is not None:
            raise self.fail
        return self._scan(text, truncate_to=self.config.max_len)

    def batch_predict_entities(self, texts, labels, threshold=0.5, **kwargs):
        self.batch_calls.append(list(texts))
        if self.fail is not None:
            raise self.fail
        return [self._scan(t, truncate_to=self.config.max_len) for t in texts]


def _pad(n: int) -> str:
    return " ".join(f"word{i:04d}" for i in range(n))


def _install(monkeypatch, fake: _FakeGliner) -> _FakeGliner:
    monkeypatch.setattr(ms, "_get_ner_model", lambda: fake)
    return fake


def test_pb6_a_buried_entity_detected(monkeypatch):
    """(a) Entity past the 384-token truncation point is returned."""
    fake = _install(monkeypatch, _FakeGliner([(_BURIED, "organization")]))
    text = _pad(400) + f" The contractor is {_BURIED} of Riyadh."
    whole = fake._scan(text, truncate_to=fake.config.max_len)
    assert not any(h["text"] == _BURIED for h in whole)
    spans = detect_identity_spans(text)
    assert any(t == _BURIED for t, _l in spans)
    assert fake.batch_calls
    assert fake.predict_calls == []


def test_pb6_b_short_text_unchanged(monkeypatch):
    """(b) Short-text output matches the pre-windowing predict_entities path."""
    fake = _install(
        monkeypatch,
        _FakeGliner([(_SHORT_ORG, "organization"), ("Beta Engineering", "organization")]),
    )
    short = f"Notice from {_SHORT_ORG} to Beta Engineering"
    direct = [(p["text"], p["label"]) for p in fake.predict_entities(short, ms._IDENTITY_LABELS)]
    fake.predict_calls.clear()
    got = detect_identity_spans(short)
    assert got == direct
    assert fake.predict_calls == [short]
    assert fake.batch_calls == []


def test_pb6_c_overlap_union_keeps_entity(monkeypatch):
    """(c) Entity in the overlap of two windows is not lost."""
    fake = _install(monkeypatch, _FakeGliner([(_OVERLAP_ORG, "organization")]))
    # WINDOW = 384-64 = 320; place entity near token 300 so it sits in overlap (40).
    text = _pad(300) + f" {_OVERLAP_ORG} " + _pad(80)
    short = f"{_OVERLAP_ORG} submitted a claim"
    short_spans = detect_identity_spans(short)
    assert short_spans == [(_OVERLAP_ORG, "organization")]
    fake.predict_calls.clear()
    fake.batch_calls.clear()
    long_spans = detect_identity_spans(text)
    assert (_OVERLAP_ORG, "organization") in long_spans
    assert fake.batch_calls
    windows = fake.batch_calls[0]
    assert len(windows) >= 2
    in_first = _OVERLAP_ORG in windows[0]
    in_second = _OVERLAP_ORG in windows[1]
    assert in_first and in_second


def test_pb6_d_inference_error_propagates(monkeypatch):
    """(d) Inference failure is not swallowed (INV-MASK-3 fail-closed)."""
    err = RuntimeError("ner-down")
    _install(monkeypatch, _FakeGliner([(_SHORT_ORG, "organization")], fail=err))
    with pytest.raises(RuntimeError, match="ner-down"):
        detect_identity_spans(f"{_SHORT_ORG} issued a notice")
    with pytest.raises(RuntimeError, match="ner-down"):
        detect_identity_spans(_pad(400) + f" {_SHORT_ORG}")


def test_pb6_empty_still_empty(monkeypatch):
    fake = _install(monkeypatch, _FakeGliner([(_SHORT_ORG, "organization")]))
    assert detect_identity_spans("") == []
    assert detect_identity_spans("a") == []
    assert fake.predict_calls == []
    assert fake.batch_calls == []
