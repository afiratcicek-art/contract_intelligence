"""TB-64 over-block probe. CI skip — gliner requirements-dev'de yok.

Temiz-maskeli metin (ham kimlik/tutar yok) has_leak=False mı, yoksa @0.25
leak-detector token/jenerik FIDIC kelimesini entity sanıp blokluyor mu?
Assert YOK — çıplak sayı. Geçirmek değil, ölçmek.
"""
import sys

import pytest

pytest.importorskip("gliner")

from backend.services.masking_service import MaskingProvider, MaskSession

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


# _TableScopedFake bu dosyada yoktu. test_masking_ner'den kopyalanmadı / import
# edilmedi — yalnız TB-64'ün ihtiyaç duyduğu zincir: table().select().eq().limit().in_().execute()


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


# Jenerik FIDIC dili; ham kimlik / tutar / registry-adı YOK.
# mask() sonrası has_leak(masked): True = over-block (token veya "Engineer" entity).
_CLEAN_TEXTS = (
    "Notice of delay was given pursuant to Sub-Clause 8.4 of the Conditions.",
    "The Engineer shall issue a variation under Clause 13 within a reasonable time.",
    "The Taking-Over Certificate remains outstanding until the Tests on Completion succeed.",
    "Particulars of the claim were submitted to the Dispute Board in writing.",
    "Payment of the certified sum shall follow the IPC issued this month.",
    "No waiver arises from correspondence referring to Sub-Clause 20.1.",
    "The programme impact of the instruction is set out in the appendix.",
    "An extension of time may be granted subject to the notice requirements.",
    "The Employer shall consider the application before issuing the certificate.",
    "Delay damages and the defect notification period are stated in the Contract Data.",
    "قُدم الإشعار وفقاً للبند الفرعي 8.4 من الشروط.",
    "يصدر المهندس أمر تغيير بموجب البند 13.",
    "تبقى شهادة الاستلام قائمة حتى نجاح الاختبارات.",
    "قدم المقاول تفاصيل المطالبة إلى مجلس فض النزاعات.",
    "ينظر صاحب العمل في الطلب قبل إصدار الشهادة.",
)

# Registry-adı ham (maskelenmeden). has_leak(raw) True beklenir — sahte-hepsi-False kontrolü.
_LEAKY_TEXTS = (
    "Acme Corporation issued the notice.",
    "Zenith Contracting W.L.L. submitted a claim.",
    "Eng. Khalid Al-Otaibi approved.",
)


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
    built = MaskingProvider(db).build("proj-ob")
    assert built is not None
    return built


def test_overblock_clean_after_mask():
    session = _session()
    over = 0
    print(f"\n=== TB-64 over-block  n={len(_CLEAN_TEXTS)} temiz cümle ===")
    for raw in _CLEAN_TEXTS:
        masked = session.mask(raw)
        leak = session.has_leak(masked)
        mark = "🔴" if leak else "🟢"
        if leak:
            over += 1
        print(f"RAW : {raw!r}")
        print(f"MASK: {masked!r}")
        print(f"has_leak={leak} {mark}")
        print("---")
    n = len(_CLEAN_TEXTS)
    pct = 100 * over / n if n else 0.0
    print(f"over-block {over}/{n} = {pct:.1f}%  (over>0 = over-block)")
    assert over == 0, f"{over}/{n} temiz-maskeli metin over-block"


def test_overblock_leaky_control():
    session = _session()
    caught = 0
    print(f"\n=== TB-64 leaky-control  n={len(_LEAKY_TEXTS)} ham registry ===")
    for raw in _LEAKY_TEXTS:
        leak = session.has_leak(raw)
        mark = "🟢" if leak else "🔴"
        if leak:
            caught += 1
        print(f"RAW : {raw!r}")
        print(f"has_leak={leak} {mark}  (beklenen True)")
        print("---")
    n = len(_LEAKY_TEXTS)
    print(f"caught {caught}/{n}  (0 = detector her şeyi False; kontrol çöktü)")
    assert caught == len(_LEAKY_TEXTS)


_AR_GENERICS = (
    "يصدر المهندس أمر تغيير بموجب البند 13.",
    "قدم المقاول تفاصيل المطالبة.",
    "ينظر صاحب العمل في الطلب.",
    "المقاول من الباطن مسؤول عن العيوب.",
    "أحيل النزاع إلى مجلس فض النزاعات.",
)


def test_overblock_arabic_generics_not_masked():
    session = _session()
    over = 0
    print(f"\n=== TB-64 Fix-C: Arapça jenerik mask() ölçümü n={len(_AR_GENERICS)} ===")
    for raw in _AR_GENERICS:
        masked = session.mask(raw)
        masked_flag = "⟦" in masked
        if masked_flag:
            over += 1
        mark = "🔴" if masked_flag else "🟢"
        print(f"{mark} RAW : {raw!r}")
        print(f"   MASK: {masked!r}")
    n = len(_AR_GENERICS)
    print(f"Arapça-jenerik maskelendi {over}/{n} (over>0 = allowlist AR'da çalışmıyor)")
    assert over == 0, f"{over}/{n} Arapça jenerik hâlâ maskeleniyor"
