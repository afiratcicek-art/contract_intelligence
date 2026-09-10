"""MaskSession / MaskingProvider davranış pini (TB-41 semantik-NER swap öncesi).

Mevcut deterministik exact-match maskelemesini sabitlemek için: ileride yerel NER
front-end'i bu backbone'un üstüne bindiğinde bu testler behavior-preserving
regresyon ağıdır. MaskSession frozen dataclass; from_identity_map ile kurulur.
"""
from __future__ import annotations

from backend.services.masking_service import MaskSession, MaskingProvider


# ---------------------------------------------------------------------------
# Yerel fake-db (Part B). conftest.FakeDB reuse EDİLMEDİ — gerekçe:
# FakeDB execute() SAYAR; table() adını yok sayar ve tek paylaşılan .data
# listesini her tabloya döndürür. Per-table seed ve per-table raise
# (B2: contract_parties.execute() exception) desteklemez.
# Zincir: table().select().eq().limit().in_().execute()
# ---------------------------------------------------------------------------


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, owner: "_TableScopedFake", table_name: str):
        self._owner = owner
        self._table = table_name

    def select(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def in_(self, *args, **kwargs):
        return self

    def execute(self):
        exc = self._owner._raises.get(self._table)
        if exc is not None:
            raise exc
        return _Result(list(self._owner._tables.get(self._table, [])))


class _TableScopedFake:
    """Tablo-adına göre .data döndüren (veya execute'da raise eden) sahte client."""

    def __init__(self, tables=None, raises=None):
        self._tables = tables if tables is not None else {}
        self._raises = raises if raises is not None else {}

    def table(self, name: str) -> _Query:
        return _Query(self, name)


_EMPLOYER = "⟦EMPLOYER⟧"
_PARTY_1 = "⟦PARTY_1⟧"


# ----- Part A: MaskSession (DB'siz) ---------------------------------------


def test_a1_round_trip_mask_then_demask():
    session = MaskSession.from_identity_map({"Acme Corp": _EMPLOYER})
    original = "Notice to Acme Corp dated today."
    masked = session.mask(original)
    assert _EMPLOYER in masked
    assert "Acme Corp" not in masked
    assert session.demask(masked) == original


def test_a2_case_insensitive_whole_word():
    session = MaskSession.from_identity_map({"Acme": _EMPLOYER})
    assert _EMPLOYER in session.mask("acme corp")
    assert _EMPLOYER not in session.mask("Acmecorp")


def test_a3_long_before_short_does_not_clobber():
    session = MaskSession.from_identity_map({"Acme": "⟦A⟧", "Acme Corp": "⟦B⟧"})
    masked = session.mask("Acme Corp")
    assert masked == "⟦B⟧"
    assert "⟦A⟧" not in masked


def test_a4_has_leak_true_only_for_registry_name():
    session = MaskSession.from_identity_map({"Acme Corp": _EMPLOYER})
    assert session.has_leak("letter from Acme Corp") is True
    assert session.has_leak("letter from nobody") is False


def test_a4b_whitespace_flexible_newline_and_overreach():
    """BULGU-1/S10: PDF satır-kırığı registry'yi kaçırırdı. GLiNER yok."""
    session = MaskSession.from_identity_map(
        {
            "Silverline Construction JV": "⟦CONTRACTOR⟧",
            "Delta Piling": "⟦ORG_1⟧",
        }
    )
    masked = session.mask(
        "The Contractor Silverline\nConstruction JV shall proceed."
    )
    assert "⟦CONTRACTOR⟧" in masked
    assert "Silverline" not in masked
    assert session.has_leak("Silverline\nConstruction JV") is True
    assert session.has_leak(masked) is False
    over = session.mask("Delta big Piling submitted a claim.")
    assert "Delta big Piling" in over
    assert "⟦ORG_1⟧" not in over
    assert session.has_leak("Delta big Piling submitted a claim.") is False


def test_a5_mask_context_nested_str_values():
    session = MaskSession.from_identity_map({"Acme Corp": _EMPLOYER})
    ctx = {"a": "Acme Corp", "b": ["Acme Corp", {"c": "Acme Corp"}]}
    out = session.mask_context(ctx)
    assert out == {"a": _EMPLOYER, "b": [_EMPLOYER, {"c": _EMPLOYER}]}


def test_a6_empty_map_is_noop():
    session = MaskSession.from_identity_map({})
    x = "Acme Corp stays put"
    assert session.mask(x) == x
    assert session.has_leak(x) is False


def test_l3_structural_regex():
    """L3: email/IBAN/VAT/ID token; tutar/süre/%/madde-no ham. GLiNER yok."""
    session = MaskSession.from_identity_map({})
    email = "ops@orion-steel.example"
    iban_sa = "SA03 8000 0000 6080 1016 7519"
    iban_de = "DE89 3704 0044 0532 0130 00"
    iban_gb = "GB82 WEST 1234 5698 7654 32"
    iban_ae = "AE07 0331 2345 6789 0123 456"
    vat = "310175397400003"
    iqama = "1098765432"
    po = "PO12 3456 7890"
    drawing = "AB12 CDEF 3456"
    invoice = "INVOICE PO81 8629 8402 ISSUED"
    serial = "SN-9931-AB"
    text = (
        f"Contact {email}. IBAN {iban_sa}. DE {iban_de}. GB {iban_gb}. AE {iban_ae}. "
        f"VAT {vat}. Iqama {iqama}. "
        f"Ref {po}. Drawing {drawing}. {invoice}. Serial {serial}. "
        "The sum is SAR 487,350,000 and SAR 1500000000 due in 28 days at 0.5%. Clause 12 applies."
    )
    masked = session.mask(text)
    assert email not in masked
    assert iban_sa not in masked
    assert iban_de not in masked
    assert iban_gb not in masked
    assert iban_ae not in masked
    assert vat not in masked
    assert iqama not in masked
    assert "⟦EMAIL_1⟧" in masked
    assert "⟦IBAN_1⟧" in masked
    assert "⟦IBAN_2⟧" in masked
    assert "⟦IBAN_3⟧" in masked
    assert "⟦IBAN_4⟧" in masked
    assert "⟦VAT_1⟧" in masked
    assert "⟦ID_1⟧" in masked
    assert po in masked
    assert drawing in masked
    assert invoice in masked
    assert serial in masked
    assert "SAR 487,350,000" in masked
    assert "SAR 1500000000" in masked
    assert "28 days" in masked
    assert "0.5%" in masked
    assert "Clause 12" in masked
    assert session.demask(masked) == text
    assert session.has_leak("ham ops@x.example") is True
    assert session.has_leak("IBAN SA03 8000 0000 6080 1016 7519") is True
    assert session.has_leak("SAR 1500000000") is False
    assert session.has_leak(masked) is False


# ----- Part B: MaskingProvider.build() fail-closed ------------------------


def test_b1_empty_projects_returns_none():
    db = _TableScopedFake(tables={"projects": []})
    assert MaskingProvider(db).build("proj-1") is None


def test_b2_contract_parties_exception_returns_none():
    db = _TableScopedFake(
        tables={
            "projects": [
                {
                    "name": "Site A",
                    "employer_name": "Acme",
                    "contractor_name": None,
                    "engineer_name": None,
                }
            ],
            "contracts": [{"id": "c1"}],
        },
        raises={"contract_parties": RuntimeError("contract_parties read failed")},
    )
    assert MaskingProvider(db).build("proj-1") is None


def test_b3_empty_registry_returns_none():
    db = _TableScopedFake(
        tables={
            "projects": [
                {
                    "name": None,
                    "employer_name": None,
                    "contractor_name": None,
                    "engineer_name": None,
                }
            ],
            "contracts": [],
            "project_parties": [],
        }
    )
    assert MaskingProvider(db).build("proj-1") is None


def test_b4_bijection_second_employer_becomes_party_n():
    db = _TableScopedFake(
        tables={
            "projects": [
                {
                    "name": None,
                    "employer_name": "Acme",
                    "contractor_name": None,
                    "engineer_name": None,
                }
            ],
            "contracts": [{"id": "c1"}],
            "contract_parties": [{"role": "employer", "name": "Beta"}],
            "project_parties": [],
        }
    )
    session = MaskingProvider(db).build("proj-1")
    assert session is not None
    assert session.mask("Acme") == _EMPLOYER
    assert session.mask("Beta") == _PARTY_1


# ----- Part C: dynamic-map (sahte detector; model gerekmez, CI koşar) -----


def _fake_detector(spans):
    return lambda text: spans


_ORG_1 = "⟦ORG_1⟧"
_ORG_2 = "⟦ORG_2⟧"


def test_c1_ner_span_round_trip():
    session = MaskSession.from_identity_map(
        {},
        detector=_fake_detector([("Falan İnşaat", "organization")]),
    )
    original = "Falan İnşaat notice"
    masked = session.mask(original)
    assert _ORG_1 in masked
    assert "Falan İnşaat" not in masked
    assert session.demask(masked) == original


def test_c2_same_entity_twice_reuses_token():
    session = MaskSession.from_identity_map(
        {},
        detector=_fake_detector([("Falan İnşaat", "organization")]),
    )
    masked = session.mask("Falan İnşaat wrote to Falan İnşaat")
    assert masked.count(_ORG_1) == 2
    assert _ORG_2 not in masked
    assert "Falan İnşaat" not in masked


def test_c3_two_orgs_increment_counter():
    session = MaskSession.from_identity_map(
        {},
        detector=_fake_detector(
            [
                ("Falan İnşaat", "organization"),
                ("Beta Mühendislik", "organization"),
            ]
        ),
    )
    masked = session.mask("Falan İnşaat and Beta Mühendislik")
    assert _ORG_1 in masked
    assert _ORG_2 in masked
    assert "Falan İnşaat" not in masked
    assert "Beta Mühendislik" not in masked


def test_c4_registry_name_not_rewritten_as_org_n():
    session = MaskSession.from_identity_map(
        {"Acme Corp": _EMPLOYER},
        detector=_fake_detector(
            [
                ("Acme Corp", "organization"),
                ("Falan İnşaat", "organization"),
            ]
        ),
    )
    masked = session.mask("Acme Corp and Falan İnşaat")
    assert _EMPLOYER in masked
    assert _ORG_1 in masked
    assert "Acme Corp" not in masked
    assert "Falan İnşaat" not in masked
    assert masked.count("⟦ORG_") == 1


def test_c5_has_leak_uses_leak_detector():
    leaking = MaskSession.from_identity_map(
        {},
        leak_detector=_fake_detector([("X", "person")]),
    )
    assert leaking.has_leak("unrelated text") is True
    clean = MaskSession.from_identity_map(
        {},
        leak_detector=_fake_detector([]),
    )
    assert clean.has_leak("unrelated text") is False


def test_c6_unknown_label_is_skipped():
    session = MaskSession.from_identity_map(
        {},
        detector=_fake_detector([("FooBar", "misc")]),
    )
    original = "FooBar notice"
    assert session.mask(original) == original
