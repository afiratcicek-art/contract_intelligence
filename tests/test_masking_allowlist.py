"""Allowlist (_DONT_MASK) iki-yön: jenerik atlanır, gerçek-ad yutulmaz.

CI skip — gliner requirements-dev'de yok.
_TableScopedFake bu dosyada yoktu. overblock/ner'den kopyalanmadı / import
edilmedi — yalnız table().select().eq().limit().in_().execute() zinciri.
"""
import sys

import pytest

pytest.importorskip("gliner")

from backend.services.masking_service import (
    MaskingProvider,
    MaskSession,
    detect_identity_spans,
)

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


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


def _session() -> MaskSession:
    db = _TableScopedFake(
        tables={
            "projects": [
                {
                    "name": "Jubail Refinery Expansion",
                    "employer_name": "Acme Corporation",
                    "contractor_name": "Zenith Contracting W.L.L.",
                    "engineer_name": "Eng. Khalid Al-Otaibi",
                }
            ],
            "contracts": [],
            "project_parties": [],
        }
    )
    built = MaskingProvider(db).build("proj-al")
    assert built is not None
    return built


# Allowlist jenerikleri — mask()'te ⟦…⟧ çıkmamalı (Site/Works artık allowlist).
_GENERIC = (
    "the Company shall provide access to the Site.",
    "the Client approved the interim valuation.",
    "the Authority issued the building permit.",
    "the Consultant reviewed the design submission.",
    "the Contractor and the Employer agreed on the programme.",
    "the Contractor shall execute the Works.",
    "Plant shall be delivered to the Site.",
    "Permanent Works and Temporary Works are defined.",
    "شركة أصدرت الشهادة.",
    "ينظر صاحب العمل في المطالبة.",
    "يُسلَّم الموقع إلى المقاول.",
    "تنفذ الأعمال وفقاً للعقد.",
)

# Kamu-kurumu (regülatör/statü) — maskelenmez.
_PUBLIC = (
    "VAT invoices shall comply with ZATCA requirements.",
    "the account shall be held at SAMA.",
    "work permits are issued by the Ministry of Labor.",
    "GOSI registration remains the Contractor's obligation.",
    "تخضع الفواتير لمتطلبات هيئة الزكاة والضريبة والجمارك.",
    "يفتح الحساب لدى البنك المركزي السعودي.",
    "تصدر وزارة العمل رخص العمل.",
)

# Standart-gövde (çıplak) + numaralı kod (ayrı yol, sonuç: ⟦ yok).
_STANDARDS = (
    "the materials are certified to ISO standards.",
    "testing shall be per ASTM methods.",
    "ISO 9001:2015 certified",
)

# Allowlist-kelimesi içeren GERÇEK ad — ham ad maskeli çıktıda kalmamalı.
# Kamu-kurumu eklenince "Jeddah Airport's Company" kaçmamalı.
_REAL_NAMES = (
    ("Company El-Nur Ltd submitted the bid.", "Company El-Nur Ltd"),
    ("the Al-Rajhi Consulting Bureau was engaged.", "Al-Rajhi Consulting Bureau"),
    ("Gulf Authority Contractors LLC filed a claim.", "Gulf Authority Contractors LLC"),
    ("Client Solutions International signed.", "Client Solutions International"),
    ("شركة النور للمقاولات قدمت مطالبة.", "شركة النور للمقاولات"),
    ("Jeddah Airport's Company submitted the bid.", "Jeddah Airport's Company"),
)

# Gri-alan: çıplak jenerik vs ad-içinde. Assert yok.
_BORDERLINE = (
    "Company",
    "The Company",
    "Company El-Nur",
    "El-Nur Company",
    "Authority",
    "Riyadh Development Authority",
)


def test_allowlist_generic_not_masked():
    session = _session()
    print(f"\n=== allowlist jenerik  n={len(_GENERIC)} ===")
    for raw in _GENERIC:
        masked = session.mask(raw)
        hit = "⟦" in masked
        mark = "🔴" if hit else "🟢"
        print(f"{mark} RAW : {raw!r}")
        print(f"   MASK: {masked!r}")
        assert "⟦" not in masked, masked


def test_allowlist_public_bodies_not_masked():
    session = _session()
    print(f"\n=== allowlist kamu-kurumu  n={len(_PUBLIC)} ===")
    for raw in _PUBLIC:
        masked = session.mask(raw)
        hit = "⟦" in masked
        mark = "🔴" if hit else "🟢"
        print(f"{mark} RAW : {raw!r}")
        print(f"   MASK: {masked!r}")
        assert "⟦" not in masked, masked


def test_allowlist_standard_bodies_not_masked():
    session = _session()
    print(f"\n=== allowlist standart-gövde/kod  n={len(_STANDARDS)} ===")
    for raw in _STANDARDS:
        masked = session.mask(raw)
        hit = "⟦" in masked
        mark = "🔴" if hit else "🟢"
        print(f"{mark} RAW : {raw!r}")
        print(f"   MASK: {masked!r}")
        assert "⟦" not in masked, masked


def test_allowlist_does_not_swallow_real_names():
    session = _session()
    print(f"\n=== allowlist gerçek-ad (güvenlik)  n={len(_REAL_NAMES)} ===")
    for raw, name in _REAL_NAMES:
        masked = session.mask(raw)
        leaked = name in masked
        mark = "🔴" if leaked else "🟢"
        print(f"{mark} NAME: {name!r}")
        print(f"   RAW : {raw!r}")
        print(f"   MASK: {masked!r}")
        assert name not in masked, masked


def test_allowlist_borderline_report():
    session = _session()
    print(f"\n=== allowlist gri-alan (assert yok)  n={len(_BORDERLINE)} ===")
    for raw in _BORDERLINE:
        spans = detect_identity_spans(raw)
        masked = session.mask(raw)
        print(f"IN  : {raw!r}")
        print(f"NER : {spans}")
        print(f"MASK: {masked!r}")
        print("---")
        if raw == "Riyadh Development Authority":
            assert "⟦" not in masked, masked
            assert raw in masked


def test_registry_precedence_over_allowlist():
    # A) GACA registry'de EMPLOYER (farazi taraf) → allowlist'i ezer, ⟦EMPLOYER⟧
    db_a = _TableScopedFake(tables={
        "projects": [{"name": None,
                      "employer_name": "General Authority of Civil Aviation",
                      "contractor_name": None, "engineer_name": None}],
        "contracts": [], "project_parties": [],
    })
    s_a = MaskingProvider(db_a).build("proj-prec-a")
    assert s_a is not None
    out_a = s_a.mask("General Authority of Civil Aviation issued a notice")
    print(f"A registry-taraf: {out_a!r}")
    assert "⟦EMPLOYER⟧" in out_a
    assert "General Authority of Civil Aviation" not in out_a

    # B) GACA registry'de YOK (dış-regülatör), allowlist'te → ham kalır
    s_b = _session()  # registry = Acme/Zenith/Khalid; GACA yok
    out_b = s_b.mask("General Authority of Civil Aviation issued a notice")
    print(f"B dış-regülatör: {out_b!r}")
    assert "General Authority of Civil Aviation" in out_b  # ham, maskelenmedi
    assert "⟦" not in out_b
