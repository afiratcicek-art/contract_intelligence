"""Opt-in GLiNER NER tests (S2a / ADR-0004). CI skip — gliner requirements-dev'de yok.

İlk koşu ~800MB model indirir (urchade/gliner_multi-v2.1). Ali local koşar, CI koşmaz.
"""
import time

import pytest

pytest.importorskip("gliner")

from backend.services.masking_service import (
    MaskingProvider,
    MaskSession,
    detect_identity_spans,
)


def test_detect_finds_org():
    spans = detect_identity_spans(
        "Notice from Acme Construction Ltd to Beta Engineering"
    )
    assert any(label == "organization" for _text, label in spans)
    assert any("Acme" in text for text, _label in spans)


def test_empty_text_returns_empty():
    assert detect_identity_spans("") == []
    assert detect_identity_spans("a") == []


# _TableScopedFake bu dosyada yoktu. test_masking_service'ten kopyalanmadı / import
# edilmedi — yalnız S3'ün ihtiyaç duyduğu zincir: table().select().eq().limit().in_().execute()


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def in_(self, *args, **kwargs):
        return self

    def execute(self):
        return _Result(list(self._rows))


class _TableScopedFake:
    def __init__(self, tables=None):
        self._tables = tables if tables is not None else {}

    def table(self, name: str) -> _Query:
        return _Query(self._tables.get(name, []))


def _acme_registry_session() -> MaskSession:
    db = _TableScopedFake(
        tables={
            "projects": [
                {
                    "name": None,
                    "employer_name": "Acme Corporation",
                    "contractor_name": None,
                    "engineer_name": None,
                }
            ],
            "contracts": [],
            "project_parties": [],
        }
    )
    session = MaskingProvider(db).build("proj-s3")
    assert session is not None
    return session


def _assert_masked(masked: str, raw: str) -> None:
    assert "⟦" in masked and "⟧" in masked, masked
    assert raw not in masked, masked


# --- Bölüm 1: recall (INV-MASK-4; registry'nin kaçıracağı vakalar) --------


def test_r1_abbreviation_masked():
    session = _acme_registry_session()
    _assert_masked(session.mask("ACME Corp issued a notice"), "ACME Corp")


def test_r2_unregistered_party_masked():
    session = _acme_registry_session()
    _assert_masked(
        session.mask("Zenith Contracting LLC submitted a claim"),
        "Zenith Contracting LLC",
    )


def test_r3_english_person_masked():
    session = _acme_registry_session()
    _assert_masked(
        session.mask("Engineer John Smith approved"),
        "John Smith",
    )


def test_r4_arabic_org_masked():
    session = _acme_registry_session()
    raw = "شركة النور للمقاولات"
    _assert_masked(session.mask("شركة النور للمقاولات قدمت مطالبة"), raw)


# --- Bölüm 2: has_leak agresif-tarama (0.25, gerçek model) ----------------


def test_l1_has_leak_unmasked_unregistered():
    session = _acme_registry_session()
    assert session.has_leak("Zenith Contracting LLC") is True


# --- Bölüm 3: latency profili (çift-NER gerçek maliyet; assert yok) -------


_LAT_WORDS = (
    "The contractor submitted a notice of delay under clause 8.4 regarding "
    "site access and the engineer shall respond in writing within the period."
).split()
_LAT_PARAGRAPH = " ".join((_LAT_WORDS * 20)[:200])


def test_lat_profile():
    t0 = time.perf_counter()
    session = _acme_registry_session()
    _ = session.mask("Acme Corporation")
    elapsed_a = time.perf_counter() - t0

    t1 = time.perf_counter()
    session.mask(_LAT_PARAGRAPH)
    elapsed_b = time.perf_counter() - t1

    nested = {
        "s1": "The employer issued a payment certificate.",
        "s2": "The contractor requested an extension of time.",
        "inner": {
            "s3": "The engineer instructed a variation on site.",
            "s4": "A claim was submitted for additional cost.",
            "list": [
                "Notice to the employer was served yesterday.",
                "The taking-over certificate remains outstanding.",
                "Delay damages were referred to in the letter.",
            ],
            "more": {
                "s8": "Subcontractor access to the plot was restricted.",
                "s9": "Materials inspection took place at the yard.",
                "s10": "The dispute board was not yet appointed.",
            },
        },
    }
    t2 = time.perf_counter()
    session.mask_context(nested)
    elapsed_c = time.perf_counter() - t2

    t3 = time.perf_counter()
    session.has_leak(_LAT_PARAGRAPH)
    elapsed_d = time.perf_counter() - t3

    print(
        f"LAT (a) build()+first mask "
        f"(model already warm if prior NER tests ran): {elapsed_a:.3f}s"
    )
    print(f"LAT (b) mask() 200-word paragraph: {elapsed_b:.3f}s")
    print(f"LAT (c) mask_context() 10 nested strings: {elapsed_c:.3f}s")
    print(f"LAT (d) has_leak() same paragraph: {elapsed_d:.3f}s")
