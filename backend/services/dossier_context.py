"""Assemble truncated contract + dossier excerpts for LLM (no embeddings).

Used by chronology narrative preview and dispute claim/response generation.
Reads in-force contract PDFs, related correspondence/RFI extracts, and
manual notes already on the dispute. Truncation is intentional: the analysis
layer has a token budget; callers must not dump full archives.
"""
from __future__ import annotations

from typing import Any, Optional

_MAX_EACH = 1800
_MAX_TOTAL = 18000
_MAX_DOCS = 8


def _clip(text: Optional[str], n: int = _MAX_EACH) -> str:
    raw = (text or "").strip()
    if len(raw) <= n:
        return raw
    return raw[: n - 1] + "…"


def assemble_dossier_context(
    db,
    project_id: str,
    *,
    dispute_id: Optional[str] = None,
    change_id: Optional[str] = None,
    correspondence_id: Optional[str] = None,
) -> dict[str, Any]:
    """Return a dict safe to pass as ``change_context`` to ClaudeService.

    Keys: project, corpus, dispute (optional summary of the dossier).
    ``corpus`` is a single concatenated string of labelled excerpts.
    """
    parts: list[str] = []
    meta: dict[str, Any] = {"project_id": project_id}

    project = (
        db.table("projects")
        .select("name, contract_type")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )
    prow = (project.data or [None])[0] or {}
    meta["project_name"] = prow.get("name")
    meta["contract_type"] = prow.get("contract_type")
    if prow.get("name"):
        parts.append(f"Project: {prow.get('name')} ({prow.get('contract_type') or 'n/a'})")

    _append_pdfs(db, parts, project_id, "contract_document")
    _append_pdfs(db, parts, project_id, "amendment")

    cid = change_id
    corr_id = correspondence_id
    dispute_blob: dict[str, Any] | None = None

    if dispute_id:
        nested = (
            db.table("disputes")
            .select(
                "id, dispute_number, title, summary, origin, "
                "source_change_id, source_correspondence_id, "
                "dispute_impacts(type, label, amount, unit, notes), "
                "dispute_issues(title, dispute_positions(side, title, summary, "
                "dispute_position_refs(ref_type, manual_title, manual_note, document_id, entity_id)))"
            )
            .eq("id", dispute_id)
            .eq("project_id", project_id)
            .limit(1)
            .execute()
        )
        dispute_blob = (nested.data or [None])[0]
        if dispute_blob:
            cid = cid or dispute_blob.get("source_change_id")
            corr_id = corr_id or dispute_blob.get("source_correspondence_id")
            parts.append(
                "Dispute {n} — {t}\nOrigin: {o}\nSummary: {s}".format(
                    n=dispute_blob.get("dispute_number"),
                    t=dispute_blob.get("title"),
                    o=dispute_blob.get("origin"),
                    s=_clip(dispute_blob.get("summary"), 800),
                )
            )
            for imp in dispute_blob.get("dispute_impacts") or []:
                parts.append(
                    f"Impact ({imp.get('type')}): {imp.get('label')} "
                    f"{imp.get('amount') or ''} {imp.get('unit') or ''} "
                    f"{_clip(imp.get('notes'), 400)}"
                )
            for issue in dispute_blob.get("dispute_issues") or []:
                parts.append(f"Issue: {issue.get('title')}")
                for pos in issue.get("dispute_positions") or []:
                    parts.append(
                        f"  {pos.get('side')}: {pos.get('title')} — {_clip(pos.get('summary'), 600)}"
                    )
                    for ref in pos.get("dispute_position_refs") or []:
                        if ref.get("ref_type") == "manual":
                            parts.append(
                                "  Manual exhibit: {t} — {n}".format(
                                    t=ref.get("manual_title") or "",
                                    n=_clip(ref.get("manual_note"), 400),
                                )
                            )
                        if ref.get("document_id"):
                            _append_one_pdf(db, parts, ref["document_id"])

    if cid:
        ch = (
            db.table("changes")
            .select("change_number, title, description, status")
            .eq("id", cid)
            .limit(1)
            .execute()
        )
        crow = (ch.data or [None])[0]
        if crow:
            parts.append(
                "Change {n} — {t} [{s}]\n{_clip}".format(
                    n=crow.get("change_number"),
                    t=crow.get("title"),
                    s=crow.get("status"),
                    _clip=_clip(crow.get("description"), 800),
                )
            )
        _append_pdfs(db, parts, project_id, "change", entity_id=str(cid))

    if corr_id:
        _append_pdfs(db, parts, project_id, "correspondence", entity_id=str(corr_id))

    corpus = ""
    for block in parts:
        if len(corpus) + len(block) + 2 > _MAX_TOTAL:
            break
        corpus = f"{corpus}\n\n{block}" if corpus else block

    meta["corpus"] = corpus
    if dispute_blob:
        meta["dispute_number"] = dispute_blob.get("dispute_number")
        meta["dispute_title"] = dispute_blob.get("title")
    return meta


def seed_linkable_ids(
    db,
    *,
    change_id: Optional[str] = None,
    correspondence_id: Optional[str] = None,
    dispute_id: Optional[str] = None,
) -> list[str]:
    """RFI / correspondence ids to pre-fill a chronology draft picker."""
    ids: list[str] = []
    seen: set[str] = set()

    def _add(raw: Optional[str]) -> None:
        if not raw or raw in seen:
            return
        seen.add(raw)
        ids.append(raw)

    if correspondence_id:
        _add(correspondence_id)

    if change_id:
        links = (
            db.table("correspondence_change_links")
            .select("correspondence_id")
            .eq("change_id", change_id)
            .execute()
        )
        for row in links.data or []:
            _add(row.get("correspondence_id"))
        chrono = (
            db.table("chronologies")
            .select("id")
            .eq("entity_type", "change")
            .eq("entity_id", change_id)
            .limit(1)
            .execute()
        )
        if chrono.data:
            events = (
                db.table("chronology_events")
                .select("document_ref_id")
                .eq("chronology_id", chrono.data[0]["id"])
                .eq("is_active", True)
                .execute()
            )
            for ev in events.data or []:
                _add(ev.get("document_ref_id"))

    if dispute_id:
        nested = (
            db.table("disputes")
            .select(
                "source_change_id, source_correspondence_id, "
                "dispute_issues(dispute_positions(dispute_position_refs(ref_type, entity_id)))"
            )
            .eq("id", dispute_id)
            .limit(1)
            .execute()
        )
        row = (nested.data or [None])[0] or {}
        _add(row.get("source_correspondence_id"))
        if row.get("source_change_id") and not change_id:
            ids.extend(
                seed_linkable_ids(db, change_id=row["source_change_id"])
            )
        for issue in row.get("dispute_issues") or []:
            for pos in issue.get("dispute_positions") or []:
                for ref in pos.get("dispute_position_refs") or []:
                    if ref.get("ref_type") in ("rfi", "correspondence"):
                        _add(ref.get("entity_id"))

    return ids


def _append_pdfs(
    db,
    parts: list[str],
    project_id: str,
    entity_type: str,
    entity_id: Optional[str] = None,
) -> None:
    query = (
        db.table("pdf_document")
        .select("original_filename, extracted_text, entity_type")
        .eq("project_id", project_id)
        .eq("entity_type", entity_type)
        .eq("parse_status", "completed")
        .limit(_MAX_DOCS)
    )
    if entity_id:
        query = query.eq("entity_id", entity_id)
    result = query.execute()
    for row in result.data or []:
        text = _clip(row.get("extracted_text"))
        if not text:
            continue
        parts.append(
            f"[{entity_type}] {row.get('original_filename') or ''}\n{text}"
        )


def _append_one_pdf(db, parts: list[str], document_id: str) -> None:
    result = (
        db.table("pdf_document")
        .select("original_filename, extracted_text, entity_type")
        .eq("id", document_id)
        .limit(1)
        .execute()
    )
    row = (result.data or [None])[0]
    if not row or not row.get("extracted_text"):
        return
    parts.append(
        "[{t}] {n}\n{x}".format(
            t=row.get("entity_type") or "document",
            n=row.get("original_filename") or "",
            x=_clip(row.get("extracted_text")),
        )
    )
