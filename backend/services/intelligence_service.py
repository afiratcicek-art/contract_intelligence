"""Project Intelligence — keyword retrieval + grounded ask (ADR-0001 dormant).

Retrieval uses existing chain-aware search RPCs / ilike lists (no embeddings).
Citation indices are validated server-side against the retrieved set only —
the model cannot invent entity IDs.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_SOURCE_CAP = 12


def filter_citation_indices(
    raw_indices: list[Any], source_count: int
) -> list[int]:
    """Keep only 1-based indices that exist in the retrieved source list."""
    out: list[int] = []
    seen: set[int] = set()
    for item in raw_indices or []:
        try:
            idx = int(item)
        except (TypeError, ValueError):
            continue
        if idx < 1 or idx > source_count or idx in seen:
            continue
        seen.add(idx)
        out.append(idx)
    return out


def retrieve_keyword_sources(
    db: Any, project_id: str, query: str, *, limit: int = _SOURCE_CAP
) -> list[dict]:
    """Return grounded source cards for the ask prompt (project-scoped).

    Shape per row:
      entity_type, entity_id, ref, subject, date, status, snippet
    """
    q = (query or "").strip()
    if not q:
        return []

    sources: list[dict] = []
    seen_ids: set[str] = set()

    def _add(
        *,
        entity_type: str,
        entity_id: str,
        ref: str,
        subject: str,
        date: str | None,
        status: str | None,
    ) -> None:
        if not entity_id or entity_id in seen_ids:
            return
        if len(sources) >= limit:
            return
        seen_ids.add(entity_id)
        sources.append(
            {
                "entity_type": entity_type,
                "entity_id": entity_id,
                "ref": ref or "—",
                "subject": (subject or "").strip(),
                "date": date or None,
                "status": status or None,
                "snippet": (subject or "").strip()[:400],
            }
        )

    # Correspondence — chain-aware RPC (migration 021)
    try:
        corr_rows = (
            db.rpc(
                "search_correspondence_chains",
                {
                    "p_project_id": project_id,
                    "p_query": q,
                    "p_limit": 80,
                },
            ).execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        logger.error("intelligence corr search failed: %s", exc)
        corr_rows = []
    for r in corr_rows:
        _add(
            entity_type="correspondence",
            entity_id=str(r.get("id") or ""),
            ref=str(r.get("corr_number") or "—"),
            subject=str(r.get("subject") or ""),
            date=str(r.get("correspondence_date") or "") or None,
            status=str(r.get("status") or "") or None,
        )

    # RFI — chain-aware RPC
    try:
        rfi_rows = (
            db.rpc(
                "search_rfi_chains",
                {
                    "p_project_id": project_id,
                    "p_query": q,
                    "p_limit": 80,
                },
            ).execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        logger.error("intelligence rfi search failed: %s", exc)
        rfi_rows = []
    for r in rfi_rows:
        _add(
            entity_type="rfi",
            entity_id=str(r.get("id") or ""),
            ref=str(r.get("rfi_number") or "—"),
            subject=str(r.get("subject") or ""),
            date=str(r.get("submitted_date") or "") or None,
            status=str(r.get("status") or "") or None,
        )

    keyword = f"%{q}%"

    # Changes — no chain RPC; subject/title ilike (mirrors dashboard search)
    try:
        change_rows = (
            db.table("changes")
            .select("id, change_number, title, status, created_at")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
            .ilike("title", keyword)
            .limit(40)
            .execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        logger.error("intelligence change search failed: %s", exc)
        change_rows = []
    for r in change_rows:
        _add(
            entity_type="change",
            entity_id=str(r.get("id") or ""),
            ref=str(r.get("change_number") or "—"),
            subject=str(r.get("title") or ""),
            date=str(r.get("created_at") or "")[:10] or None,
            status=str(r.get("status") or "") or None,
        )

    # Deliverables
    try:
        deliv_rows = (
            db.table("deliverables")
            .select("id, title, status, due_date")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
            .ilike("title", keyword)
            .limit(40)
            .execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        logger.error("intelligence deliverable search failed: %s", exc)
        deliv_rows = []
    for r in deliv_rows:
        _add(
            entity_type="deliverable",
            entity_id=str(r.get("id") or ""),
            ref=str(r.get("id") or "")[:8],
            subject=str(r.get("title") or ""),
            date=str(r.get("due_date") or "") or None,
            status=str(r.get("status") or "") or None,
        )

    return sources[:limit]
