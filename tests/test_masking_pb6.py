"""P-B6: detect_identity_spans windowing (F1). CI-hermetic — fake GLiNER, no model download."""
from __future__ import annotations

import re

import pytest

from backend.services import masking_service as ms
from backend.services.masking_service import MaskSession, detect_identity_spans

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


# --- P-B6 Emirates ID L3 (uae-emirates-id; no GLiNER) ----------------------

_EID_HYPHEN = "784-2019-1234567-1"
_EID_SPACE = "784 2019 1234567 1"
_EID_COMPACT = "784201912345671"
_KSA_NATIONAL = "1098765432"
_KSA_IQAMA = "2098765432"
_VAT_NO_784 = "310175397400003"


def test_pb6_eid_a_mask_variants():
    """(a) Hyphen / space / compact Emirates ID → ⟦EID_n⟧."""
    session = MaskSession.from_identity_map({})
    for raw in (_EID_HYPHEN, _EID_SPACE, _EID_COMPACT):
        masked = session.mask(f"Emirates ID {raw} on file.")
        assert raw not in masked, raw
        assert "⟦EID_" in masked, masked
        assert "⟦VAT_" not in masked, masked


def test_pb6_eid_b_has_leak_raw():
    """(b) has_leak flags raw Emirates ID (fail-closed, mask-symmetric)."""
    session = MaskSession.from_identity_map({})
    for raw in (_EID_HYPHEN, _EID_SPACE, _EID_COMPACT):
        assert session.has_leak(raw) is True, raw
        masked = session.mask(raw)
        assert session.has_leak(masked) is False, masked


def test_pb6_eid_c_ksa_and_vat_unchanged():
    """(c) KSA 10-digit 1/2-prefix and non-784 VAT are not swallowed by EID."""
    session = MaskSession.from_identity_map({})
    text = f"ID {_KSA_NATIONAL} Iqama {_KSA_IQAMA} VAT {_VAT_NO_784}"
    masked = session.mask(text)
    assert _KSA_NATIONAL not in masked
    assert _KSA_IQAMA not in masked
    assert _VAT_NO_784 not in masked
    assert "⟦ID_1⟧" in masked
    assert "⟦ID_2⟧" in masked
    assert "⟦VAT_1⟧" in masked
    assert "⟦EID_" not in masked


def test_pb6_eid_d_non784_15digit_is_vat():
    """(d) Random 15-digit without 784 prefix is VAT, not EID."""
    session = MaskSession.from_identity_map({})
    masked = session.mask(f"VAT {_VAT_NO_784}")
    assert _VAT_NO_784 not in masked
    assert "⟦VAT_1⟧" in masked
    assert "⟦EID_" not in masked
    assert session.has_leak(_VAT_NO_784) is True


# --- P-B6 L1b acronym auto-alias (acronym-bare) -----------------------------

_ALIAS_FULL = "Falcon Ridge Contracting W.L.L."
_ALIAS_TOKEN = "⟦CONTRACTOR⟧"
_ALIAS_ACR = "FRC"


def test_pb6_alias_a_same_token_and_next_pass():
    """(a) Registry Full Name (FRC) + later bare FRC → same token.
    Alias is mask-time (_dynamic); a later mask() on the same session
    also masks bare FRC. has_leak is not an ACR backstop (untouched)."""
    session = MaskSession.from_identity_map({_ALIAS_FULL: _ALIAS_TOKEN})
    text = (
        f"{_ALIAS_FULL} ({_ALIAS_ACR}) (hereinafter the Contractor) "
        f"shall perform the Works. Thereafter {_ALIAS_ACR} shall submit."
    )
    masked = session.mask(text)
    assert _ALIAS_FULL not in masked
    assert _ALIAS_ACR not in masked
    assert masked.count(_ALIAS_TOKEN) >= 2
    assert session._dynamic.get(_ALIAS_ACR) == _ALIAS_TOKEN
    later = session.mask(f"{_ALIAS_ACR} shall proceed.")
    assert _ALIAS_ACR not in later
    assert _ALIAS_TOKEN in later


def test_pb6_alias_b_unmasked_full_name_no_alias():
    """(b) Full Name not masked (empty registry, dummy detector) → no FRC alias."""
    session = MaskSession.from_identity_map({}, detector=lambda t: [])
    text = (
        f"{_ALIAS_FULL} ({_ALIAS_ACR}) shall perform. "
        f"Thereafter {_ALIAS_ACR} shall submit."
    )
    masked = session.mask(text)
    assert _ALIAS_FULL in masked
    assert _ALIAS_ACR in masked
    assert "⟦" not in masked


def test_pb6_alias_c_allowlist_not_aliased():
    """(c) allowlist ACR inside (NDA)/(IFC) is not aliased; bare NDA/IFC kept."""
    session = MaskSession.from_identity_map({_ALIAS_FULL: _ALIAS_TOKEN})
    nda = f"{_ALIAS_FULL} (NDA) was executed. Thereafter NDA remains binding."
    masked_nda = session.mask(nda)
    assert "NDA" in masked_nda
    assert masked_nda.count(_ALIAS_TOKEN) == 1

    # IFC: not in product _DONT_MASK. Alias only if predecessor is already
    # masked — generic "drawings (IFC)" must not swallow the doc-type ACR.
    ifc_session = MaskSession.from_identity_map({_ALIAS_FULL: _ALIAS_TOKEN})
    ifc = "The drawings (IFC) are issued for construction. Thereafter IFC remains."
    masked_ifc = ifc_session.mask(ifc)
    assert "IFC" in masked_ifc
    assert _ALIAS_TOKEN not in masked_ifc


def test_pb6_alias_d_demask_opens_to_full_name():
    """(d) ACR alias demasks to canonical Full Name (no extra demask entry)."""
    session = MaskSession.from_identity_map({_ALIAS_FULL: _ALIAS_TOKEN})
    text = (
        f"{_ALIAS_FULL} ({_ALIAS_ACR}) shall perform. "
        f"Thereafter {_ALIAS_ACR} shall submit."
    )
    masked = session.mask(text)
    opened = session.demask(masked)
    assert _ALIAS_TOKEN not in opened
    assert "⟦" not in opened
    assert _ALIAS_FULL in opened
    assert _ALIAS_ACR not in opened
    assert opened.count(_ALIAS_FULL) >= 2
