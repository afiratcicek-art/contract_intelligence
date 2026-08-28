"""Project linkable documents for pickers (chronology / authoring).

Shape per item:
  id, type, ref_number, subject, date, status, parent_id, page_count?

For contract_document / amendment, ``id`` is the filed pdf_document id
(document_id for the reference row), not the instrument row id.
``page_count`` comes from pdf_document when known (>0); else null.
"""
from __future__ import annotations

from typing import Any, Optional

from backend.repositories.correspondence_repository import CorrespondenceRepository
from backend.repositories.rfi_repository import RFIRepository


def _norm_page_count(raw: Any) -> Optional[int]:
    try:
        n = int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None
    return n if n is not None and n > 0 else None


def list_linkable_documents(
    db,
    project_id: str,
    *,
    include_contract_instruments: bool = False,
) -> list[dict[str, Any]]:
    """RFI + Correspondence; optionally contract_documents + amendments with PDFs."""
    documents: list[dict[str, Any]] = []
    documents.extend(_linkable_rfis(db, project_id))
    documents.extend(_linkable_correspondences(db, project_id))
    if include_contract_instruments:
        documents.extend(_linkable_contract_documents(db, project_id))
        documents.extend(_linkable_amendments(db, project_id))

    documents.sort(key=lambda d: d.get("date") or "", reverse=False)
    return documents


def _linkable_rfis(db, project_id: str) -> list[dict[str, Any]]:
    rfi_repo = RFIRepository(db)
    rfis = rfi_repo.list_by_project(
        str(project_id), limit=500, exclude_status="draft"
    )
    out: list[dict[str, Any]] = []
    for r in rfis:
        raw_date = r.get("submitted_date") or r.get("created_at") or ""
        date_s = str(raw_date)[:10] if raw_date else ""
        out.append(
            {
                "id": r["id"],
                "type": "rfi",
                "ref_number": r.get("rfi_number") or "",
                "subject": r.get("subject") or "",
                "date": date_s,
                "status": r.get("status") or "",
                "parent_id": r.get("parent_id"),
                "page_count": None,
            }
        )
    return out


def _linkable_correspondences(db, project_id: str) -> list[dict[str, Any]]:
    corr_repo = CorrespondenceRepository(db)
    corrs = corr_repo.list_by_project(
        str(project_id), limit=500, exclude_status="draft"
    )
    out: list[dict[str, Any]] = []
    for c in corrs:
        out.append(
            {
                "id": c["id"],
                "type": "correspondence",
                "ref_number": c.get("corr_number", "") or "",
                "subject": c.get("subject", "") or "",
                "date": c.get("correspondence_date", "") or "",
                "status": c.get("status", "") or "",
                "parent_id": c.get("parent_id"),
                "page_count": None,
            }
        )
    return out


def _linkable_contract_documents(db, project_id: str) -> list[dict[str, Any]]:
    """Filed annexes/specs — id = pdf_document_id (reference document_id)."""
    contracts = (
        db.table("contracts")
        .select("id")
        .eq("project_id", str(project_id))
        .execute()
    )
    contract_ids = [c["id"] for c in (contracts.data or []) if c.get("id")]
    if not contract_ids:
        return []

    rows = (
        db.table("contract_documents")
        .select("id, label, pdf_document_id, created_at, pdf_document(page_count)")
        .in_("contract_id", contract_ids)
        .not_.is_("pdf_document_id", "null")
        .execute()
    )
    out: list[dict[str, Any]] = []
    for d in rows.data or []:
        pdf_id = d.get("pdf_document_id")
        if not pdf_id:
            continue
        label = (d.get("label") or "").strip()
        date_s = str(d.get("created_at") or "")[:10]
        pdf_meta = d.get("pdf_document") or {}
        out.append(
            {
                "id": pdf_id,
                "type": "contract_document",
                "ref_number": "",
                "subject": label,
                "date": date_s,
                "status": "",
                "parent_id": None,
                "page_count": _norm_page_count(pdf_meta.get("page_count")),
            }
        )
    return out


def _linkable_amendments(db, project_id: str) -> list[dict[str, Any]]:
    """Registered amendments with a filed PDF — id = source_pdf_id."""
    rows = (
        db.table("amendments")
        .select(
            "id, amendment_number, title, amendment_date, source_pdf_id, is_deleted, "
            "pdf_document:source_pdf_id(page_count)"
        )
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .not_.is_("source_pdf_id", "null")
        .execute()
    )
    out: list[dict[str, Any]] = []
    for a in rows.data or []:
        pdf_id = a.get("source_pdf_id")
        if not pdf_id:
            continue
        num = (a.get("amendment_number") or "").strip()
        title = (a.get("title") or "").strip()
        date_raw = a.get("amendment_date") or ""
        date_s = str(date_raw)[:10] if date_raw else ""
        pdf_meta = a.get("pdf_document") or {}
        out.append(
            {
                "id": pdf_id,
                "type": "amendment",
                "ref_number": num,
                "subject": title,
                "date": date_s,
                "status": "",
                "parent_id": None,
                "page_count": _norm_page_count(pdf_meta.get("page_count")),
            }
        )
    return out
