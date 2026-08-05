"""Deliverable library seed — öneri havuzu (Kapsam §5.3).

v1: kod-içi seed (ülke anahtarlı). İleride tabloya taşınır; runtime-FK değil,
kabul edilince bağımsız deliverable satırı instantiate edilir.
LLM kontrat taraması ayrı kapı (mask chokepoint) — burada yok.
"""

from __future__ import annotations

from typing import Any

# Generic items apply everywhere; country packs add statutory / local norms.
_GENERIC: list[dict[str, Any]] = [
    {
        "key": "performance_bond",
        "title": "Performance Bond",
        "category": "bond_security",
        "kind": "artifact",
        "cadence": "standing_renewal",
        "source": "contract_clause",
        "source_ref_hint": "Cl.4.2",
    },
    {
        "key": "advance_payment_guarantee",
        "title": "Advance Payment Guarantee",
        "category": "bond_security",
        "kind": "artifact",
        "cadence": "standing_renewal",
        "source": "contract_clause",
    },
    {
        "key": "insurance_car",
        "title": "CAR / All-Risk Insurance",
        "category": "insurance",
        "kind": "artifact",
        "cadence": "standing_renewal",
        "source": "contract_clause",
    },
    {
        "key": "insurance_wc",
        "title": "Workers Compensation Insurance",
        "category": "insurance",
        "kind": "artifact",
        "cadence": "standing_renewal",
        "source": "contract_clause",
    },
    {
        "key": "insurance_pi",
        "title": "Professional Indemnity (if design)",
        "category": "insurance",
        "kind": "artifact",
        "cadence": "standing_renewal",
        "source": "contract_clause",
        "conditional": True,
        "blind_spot": True,
    },
    {
        "key": "monthly_progress_report",
        "title": "Monthly Progress Report",
        "category": "report",
        "kind": "artifact",
        "cadence": "recurring",
        "source": "contract_clause",
    },
    {
        "key": "monthly_hse_report",
        "title": "Monthly HSE Report",
        "category": "hse",
        "kind": "artifact",
        "cadence": "recurring",
        "source": "employer_imposition",
        "blind_spot": True,
        "nudge": {
            "tr": "İşveren HSE raporları genelde imza-sonrası dayatılır — bu projede aylık HSE raporu var mı?",
            "en": "Employer HSE reports are often imposed post-signature — is a monthly HSE report required here?",
        },
    },
    {
        "key": "baseline_programme",
        "title": "Baseline Programme",
        "category": "administrative",
        "kind": "artifact",
        "cadence": "one_time",
        "source": "contract_clause",
    },
    {
        "key": "contractor_representative",
        "title": "Contractor's Representative appointment",
        "category": "administrative",
        "kind": "artifact",
        "cadence": "one_time",
        "source": "contract_clause",
    },
    {
        "key": "ptw_regime",
        "title": "Permit-to-Work regime (compliance)",
        "category": "hse",
        "kind": "compliance",
        "cadence": "standing_renewal",
        "source": "employer_imposition",
        "blind_spot": True,
        "nudge": {
            "tr": "PTW / method statement genelde kontratta yazmaz; işveren HSE talimatıyla gelir. Bu projede geçerli mi?",
            "en": "PTW / method statements rarely appear in the contract; they arrive via employer HSE instruction. Applicable here?",
        },
    },
]

_SA: list[dict[str, Any]] = [
    {
        "key": "sa_gosi",
        "title": "GOSI registration / compliance",
        "category": "statutory",
        "kind": "compliance",
        "cadence": "standing_renewal",
        "source": "statutory",
    },
    {
        "key": "sa_saudization",
        "title": "Saudization / Nitaqat compliance",
        "category": "statutory",
        "kind": "compliance",
        "cadence": "standing_renewal",
        "source": "statutory",
    },
    {
        "key": "sa_zatca_vat",
        "title": "ZATCA / VAT invoicing compliance",
        "category": "statutory",
        "kind": "compliance",
        "cadence": "standing_renewal",
        "source": "statutory",
    },
    {
        "key": "sa_cr",
        "title": "Commercial Registration (CR) — current",
        "category": "statutory",
        "kind": "artifact",
        "cadence": "standing_renewal",
        "source": "statutory",
    },
    {
        "key": "sa_civil_defence",
        "title": "Civil Defence / safety approvals",
        "category": "permit_approval",
        "kind": "artifact",
        "cadence": "one_time",
        "source": "statutory",
        "blind_spot": True,
    },
]

_TR: list[dict[str, Any]] = [
    {
        "key": "tr_sgk",
        "title": "SGK compliance",
        "category": "statutory",
        "kind": "compliance",
        "cadence": "standing_renewal",
        "source": "statutory",
    },
    {
        "key": "tr_isg",
        "title": "İSG board / risk assessment pack",
        "category": "hse",
        "kind": "compliance",
        "cadence": "standing_renewal",
        "source": "statutory",
    },
]

_BY_COUNTRY: dict[str, list[dict[str, Any]]] = {
    "SA": _SA,
    "KSA": _SA,
    "TR": _TR,
}


def library_for_country(country_code: str | None) -> list[dict[str, Any]]:
    code = (country_code or "").strip().upper() or "SA"
    pack = _BY_COUNTRY.get(code, _SA)
    # Deduplicate by key — generic first, country overlays.
    merged: dict[str, dict[str, Any]] = {i["key"]: i for i in _GENERIC}
    for item in pack:
        merged[item["key"]] = item
    return list(merged.values())
