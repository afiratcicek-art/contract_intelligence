from fastapi import APIRouter, Depends
from uuid import UUID
import logging

from backend.core.dependencies import verify_project_access
from backend.core.cache import cache_get, cache_set

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["project-dashboard"])


@router.get("/{project_id}/health")
def get_project_health(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """Single endpoint returning project health counts — replaces 3 separate frontend fetches."""
    cache_key = f"projects:health:{str(project_id)}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    db = access["db"]

    open_corr = (
        db.table("correspondences")
        .select("id", count="exact")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .eq("status", "open")
        .execute()
    )

    overdue_rfi = (
        db.table("rfis")
        .select("id", count="exact")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .eq("status", "overdue")
        .execute()
    )

    from datetime import date, timedelta
    today = date.today()
    cutoff = today + timedelta(days=7)

    upcoming = (
        db.table("rfis")
        .select("id", count="exact")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .in_("status", ["open", "overdue"])
        .lte("response_due_date", str(cutoff))
        .execute()
    )

    result = {
        "open_correspondences": open_corr.count or 0,
        "overdue_rfis": overdue_rfi.count or 0,
        "upcoming_deadlines": upcoming.count or 0,
    }
    cache_set(cache_key, result, ttl=30)
    return result


# ── Overview endpoints ─────────────────────────────────────────────────────

@router.get("/{project_id}/overview-activity")
def get_overview_activity(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """±15 gün belge aktivitesi — belge tipine göre günlük sayılar."""
    _cache_key = f"projects:activity:{str(project_id)}"
    _cached = cache_get(_cache_key)
    if _cached is not None:
        return _cached
    from datetime import date, timedelta
    db = access["db"]
    today = date.today()
    start = today - timedelta(days=15)
    end = today + timedelta(days=15)

    days: dict[str, dict] = {}
    for i in range(31):
        d = (start + timedelta(days=i)).isoformat()
        days[d] = {"date": d, "correspondence": 0, "rfi": 0, "change": 0, "deliverable": 0}

    # Correspondence — geçmiş: correspondence_date
    corr = (
        db.table("correspondences")
        .select("correspondence_date")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .gte("correspondence_date", str(start))
        .lte("correspondence_date", str(today))
        .execute()
    )
    for r in (corr.data or []):
        d = str(r["correspondence_date"])[:10]
        if d in days:
            days[d]["correspondence"] += 1

    # RFI — geçmiş: submitted_date / gelecek: response_due_date
    rfis_past = (
        db.table("rfis")
        .select("submitted_date")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .gte("submitted_date", str(start))
        .lte("submitted_date", str(today))
        .execute()
    )
    for r in (rfis_past.data or []):
        d = str(r["submitted_date"])[:10]
        if d in days:
            days[d]["rfi"] += 1

    rfis_future = (
        db.table("rfis")
        .select("response_due_date")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .in_("status", ["open", "overdue"])
        .gt("response_due_date", str(today))
        .lte("response_due_date", str(end))
        .execute()
    )
    for r in (rfis_future.data or []):
        if r.get("response_due_date"):
            d = str(r["response_due_date"])[:10]
            if d in days:
                days[d]["rfi"] += 1

    # Change — geçmiş: created_at / gelecek: notice_due_date
    changes_past = (
        db.table("changes")
        .select("created_at")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .gte("created_at", str(start))
        .lte("created_at", str(today))
        .execute()
    )
    for r in (changes_past.data or []):
        d = str(r["created_at"])[:10]
        if d in days:
            days[d]["change"] += 1

    changes_future = (
        db.table("changes")
        .select("notice_due_date")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .not_.is_("notice_due_date", "null")
        .gt("notice_due_date", str(today))
        .lte("notice_due_date", str(end))
        .execute()
    )
    for r in (changes_future.data or []):
        if r.get("notice_due_date"):
            d = str(r["notice_due_date"])[:10]
            if d in days:
                days[d]["change"] += 1

    # Deliverable — geçmiş: created_at / gelecek: due_date
    deliv_past = (
        db.table("deliverables")
        .select("created_at")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .gte("created_at", str(start))
        .lte("created_at", str(today))
        .execute()
    )
    for r in (deliv_past.data or []):
        d = str(r["created_at"])[:10]
        if d in days:
            days[d]["deliverable"] += 1

    deliv_future = (
        db.table("deliverables")
        .select("due_date, expiry_date")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .in_("status", ["open", "in_progress"])
        .or_(
            f"and(due_date.gt.{today},due_date.lte.{end}),"
            f"and(expiry_date.gt.{today},expiry_date.lte.{end})"
        )
        .execute()
    )
    for r in (deliv_future.data or []):
        hit_days = set()
        for key in ("due_date", "expiry_date"):
            raw = r.get(key)
            if not raw:
                continue
            d = str(raw)[:10]
            if d in days and d > str(today):
                hit_days.add(d)
        for d in hit_days:
            days[d]["deliverable"] += 1

    # Pre-period overdue — chart başlangıcından önce deadline'ı geçmiş, hâlâ açık belgeler
    pre = {"correspondence": 0, "rfi": 0, "change": 0, "deliverable": 0}

    pre_corr = (
        db.table("correspondences")
        .select("id", count="exact")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .in_("status", ["draft", "under_review", "approved", "published"])
        .not_.is_("response_due_date", "null")
        .lt("response_due_date", str(start))
        .execute()
    )
    pre["correspondence"] = pre_corr.count or 0

    pre_rfi = (
        db.table("rfis")
        .select("id", count="exact")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .eq("status", "overdue")
        .not_.is_("response_due_date", "null")
        .lt("response_due_date", str(start))
        .execute()
    )
    pre["rfi"] = pre_rfi.count or 0

    pre_change = (
        db.table("changes")
        .select("id", count="exact")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .in_("status", ["draft", "open", "under_review"])
        .not_.is_("notice_due_date", "null")
        .lt("notice_due_date", str(start))
        .execute()
    )
    pre["change"] = pre_change.count or 0

    pre_deliv = (
        db.table("deliverables")
        .select("id", count="exact")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .in_("status", ["open", "in_progress"])
        .or_(f"due_date.lt.{start},expiry_date.lt.{start}")
        .execute()
    )
    pre["deliverable"] = pre_deliv.count or 0

    result = {
        "today": str(today),
        "start": str(start),
        "end": str(end),
        "days": list(days.values()),
        "pre_period": pre,
    }
    cache_set(f"projects:activity:{str(project_id)}", result, ttl=60)
    return result


@router.get("/{project_id}/upcoming-deadlines")
def get_upcoming_deadlines(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """Önümüzdeki 15 gün — kullanıcının rolüne göre aksiyon bende olanlar."""
    role = access["member"]["project_role"]
    _cache_key = f"projects:deadlines:{str(project_id)}:{role}"
    _cached = cache_get(_cache_key)
    if _cached is not None:
        return _cached
    from datetime import date, timedelta
    db = access["db"]
    today = date.today()
    end = today + timedelta(days=15)
    results = []

    # CM — tüm belge tipleri
    # contracts_engineer, senior_qs, qs, commercial_manager, site_engineer, pm, dcc, dc — role bazlı
    include_corr = role in ["cm", "contracts_engineer", "senior_qs", "qs", "commercial_manager", "dcc", "dc"]
    include_rfi = role in ["cm", "contracts_engineer", "senior_qs", "qs", "site_engineer", "pm"]
    include_change = role in ["cm", "contracts_engineer", "commercial_manager"]
    include_deliv = role in ["cm", "site_engineer", "pm", "contracts_engineer"]

    if include_corr:
        corr = (
            db.table("correspondences")
            .select("id, corr_number, subject, response_due_date, type")
            .eq("project_id", str(project_id))
            .eq("is_deleted", False)
            .in_("status", ["draft", "under_review", "approved", "published"])
            .gte("response_due_date", str(today))
            .lte("response_due_date", str(end))
            .order("response_due_date")
            .execute()
        )
        for r in (corr.data or []):
            results.append({
                "type": "correspondence",
                "label": "CORR",
                "ref": r.get("corr_number", "—"),
                "subject": r.get("subject", ""),
                "due_date": r.get("response_due_date"),
                "id": r["id"],
            })

    if include_rfi:
        rfis = (
            db.table("rfis")
            .select("id, rfi_number, subject, response_due_date")
            .eq("project_id", str(project_id))
            .eq("is_deleted", False)
            .in_("status", ["open", "overdue"])
            .gte("response_due_date", str(today))
            .lte("response_due_date", str(end))
            .order("response_due_date")
            .execute()
        )
        for r in (rfis.data or []):
            results.append({
                "type": "rfi",
                "label": "RFI",
                "ref": r.get("rfi_number", "—"),
                "subject": r.get("subject", ""),
                "due_date": r.get("response_due_date"),
                "id": r["id"],
            })

    if include_change:
        changes = (
            db.table("changes")
            .select("id, change_number, title, notice_due_date")
            .eq("project_id", str(project_id))
            .eq("is_deleted", False)
            .in_("status", ["draft", "open", "under_review"])
            .not_.is_("notice_due_date", "null")
            .gte("notice_due_date", str(today))
            .lte("notice_due_date", str(end))
            .order("notice_due_date")
            .execute()
        )
        for r in (changes.data or []):
            results.append({
                "type": "change",
                "label": "CHG",
                "ref": r.get("change_number", "—"),
                "subject": r.get("title", ""),
                "due_date": r.get("notice_due_date"),
                "id": r["id"],
            })

    if include_deliv:
        # due_date window + expiry_date window (standing_renewal); merge by id
        seen: dict[str, dict] = {}
        deliv_due = (
            db.table("deliverables")
            .select("id, title, due_date, expiry_date")
            .eq("project_id", str(project_id))
            .eq("is_deleted", False)
            .in_("status", ["open", "in_progress"])
            .not_.is_("due_date", "null")
            .gte("due_date", str(today))
            .lte("due_date", str(end))
            .order("due_date")
            .execute()
        )
        for r in deliv_due.data or []:
            seen[r["id"]] = {
                "type": "deliverable",
                "label": "DEL",
                "ref": "DEL",
                "subject": r.get("title", ""),
                "due_date": r.get("due_date"),
                "id": r["id"],
            }
        deliv_exp = (
            db.table("deliverables")
            .select("id, title, due_date, expiry_date")
            .eq("project_id", str(project_id))
            .eq("is_deleted", False)
            .in_("status", ["open", "in_progress"])
            .not_.is_("expiry_date", "null")
            .gte("expiry_date", str(today))
            .lte("expiry_date", str(end))
            .order("expiry_date")
            .execute()
        )
        for r in deliv_exp.data or []:
            rid = r["id"]
            exp = r.get("expiry_date")
            if rid in seen:
                # Prefer earlier of due vs expiry for sort key
                cur = seen[rid]["due_date"]
                if exp and (not cur or str(exp) < str(cur)):
                    seen[rid]["due_date"] = exp
            else:
                seen[rid] = {
                    "type": "deliverable",
                    "label": "DEL",
                    "ref": "DEL",
                    "subject": r.get("title", ""),
                    "due_date": exp,
                    "id": rid,
                }
        results.extend(seen.values())

    results.sort(key=lambda x: x["due_date"] or "9999")
    result = {"today": str(today), "items": results}
    cache_set(f"projects:deadlines:{str(project_id)}:{access['member']['project_role']}", result, ttl=30)
    return result


@router.get("/{project_id}/overdue")
def get_overdue(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """Bu projedeki overdue belgeler — tüm tipler."""
    _cache_key = f"projects:overdue:{str(project_id)}"
    _cached = cache_get(_cache_key)
    if _cached is not None:
        return _cached
    from datetime import date
    db = access["db"]
    today = date.today()
    results = []

    corr = (
        db.table("correspondences")
        .select("id, corr_number, subject, response_due_date, type")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .in_("status", ["draft", "under_review", "approved", "published"])
        .not_.is_("response_due_date", "null")
        .lt("response_due_date", str(today))
        .order("response_due_date")
        .execute()
    )
    for r in (corr.data or []):
        results.append({
            "type": "correspondence",
            "label": "CORR",
            "ref": r.get("corr_number", "—"),
            "subject": r.get("subject", ""),
            "due_date": r.get("response_due_date"),
            "id": r["id"],
        })

    rfis = (
        db.table("rfis")
        .select("id, rfi_number, subject, response_due_date")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .eq("status", "overdue")
        .order("response_due_date")
        .execute()
    )
    for r in (rfis.data or []):
        results.append({
            "type": "rfi",
            "label": "RFI",
            "ref": r.get("rfi_number", "—"),
            "subject": r.get("subject", ""),
            "due_date": r.get("response_due_date"),
            "id": r["id"],
        })

    # Deliverables: overdue on due_date and/or expiry_date (standing_renewal)
    deliv_overdue = (
        db.table("deliverables")
        .select("id, title, due_date, expiry_date")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .in_("status", ["open", "in_progress"])
        .or_(f"due_date.lt.{today},expiry_date.lt.{today}")
        .execute()
    )
    for r in deliv_overdue.data or []:
        due = r.get("due_date")
        exp = r.get("expiry_date")
        # Display the earliest past date among candidates that are overdue
        candidates = []
        if due and str(due)[:10] < str(today):
            candidates.append(str(due)[:10])
        if exp and str(exp)[:10] < str(today):
            candidates.append(str(exp)[:10])
        if not candidates:
            continue
        results.append({
            "type": "deliverable",
            "label": "DEL",
            "ref": "DEL",
            "subject": r.get("title", ""),
            "due_date": min(candidates),
            "id": r["id"],
        })

    results.sort(key=lambda x: x["due_date"] or "0000")
    result = {"today": str(today), "items": results}
    cache_set(f"projects:overdue:{str(project_id)}", result, ttl=30)
    return result


@router.get("/{project_id}/search")
def search_project(
    project_id: UUID,
    q: str = "",
    access: dict = Depends(verify_project_access),
):
    """Global keyword arama — tüm modüllerde.

    RFI and correspondence search use chain-aware RPCs
    (migration 021): a match on subject OR an attached
    document's keywords/location returns the FULL chain
    (root + all responses/revisions), not just the matching
    row — consistent with how RFI/Correspondence lists
    already render parent-child threads.

    Change and Deliverable have no chain concept, so they
    keep simple subject/title ilike matching.
    """
    db = access["db"]
    keyword = f"%{q.strip()}%" if q.strip() else "%"
    results = []

    # Correspondence — empty query lists all (default view),
    # non-empty query uses chain-aware RPC (migration 021).
    if q.strip():
        try:
            corr_result = db.rpc(
                "search_correspondence_chains",
                {"p_project_id": str(project_id), "p_query": q.strip(), "p_limit": 200},
            ).execute()
            corr_rows = corr_result.data or []
        except Exception as exc:
            logger.error(
                "Correspondence chain search failed: %s | project=%s q=%s",
                exc, project_id, q.strip(),
            )
            corr_rows = []
    else:
        corr_rows = (
            db.table("correspondences")
            .select("id, corr_number, subject, type, status, correspondence_date, direction, parent_id, has_response")
            .eq("project_id", str(project_id))
            .eq("is_deleted", False)
            .limit(200)
            .execute()
        ).data or []
    for r in corr_rows:
        results.append({
            "module": "correspondence",
            "label": "CORR",
            "ref": r.get("corr_number", "—"),
            "subject": r.get("subject", ""),
            "status": r.get("status", ""),
            "date": r.get("correspondence_date", ""),
            "id": r["id"],
            "parent_id": r.get("parent_id"),
            "has_response": r.get("has_response", False),
        })

    # RFI — empty query lists all (default view),
    # non-empty query uses chain-aware RPC (migration 021).
    if q.strip():
        try:
            rfi_result = db.rpc(
                "search_rfi_chains",
                {"p_project_id": str(project_id), "p_query": q.strip(), "p_limit": 200},
            ).execute()
            rfi_rows = rfi_result.data or []
        except Exception as exc:
            logger.error(
                "RFI chain search failed: %s | project=%s q=%s",
                exc, project_id, q.strip(),
            )
            rfi_rows = []
    else:
        rfi_rows = (
            db.table("rfis")
            .select("id, rfi_number, subject, status, submitted_date, discipline, parent_id, rfi_type")
            .eq("project_id", str(project_id))
            .eq("is_deleted", False)
            .limit(200)
            .execute()
        ).data or []
    for r in rfi_rows:
        results.append({
            "module": "rfi",
            "label": "RFI",
            "ref": r.get("rfi_number", "—"),
            "subject": r.get("subject", ""),
            "status": r.get("status", ""),
            "date": r.get("submitted_date", ""),
            "id": r["id"],
            "parent_id": r.get("parent_id"),
            "rfi_type": r.get("rfi_type", "original"),
        })

    # Change — no chain concept, simple title match
    changes = (
        db.table("changes")
        .select("id, change_number, title, status, created_at")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .ilike("title", keyword)
        .limit(200)
        .execute()
    )
    for r in (changes.data or []):
        results.append({
            "module": "change",
            "label": "CHG",
            "ref": r.get("change_number", "—"),
            "subject": r.get("title", ""),
            "status": r.get("status", ""),
            "date": str(r.get("created_at", ""))[:10],
            "id": r["id"],
        })

    # Deliverable — no chain concept, simple title match
    delivs = (
        db.table("deliverables")
        .select("id, title, status, due_date")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .ilike("title", keyword)
        .limit(200)
        .execute()
    )
    for r in (delivs.data or []):
        results.append({
            "module": "deliverable",
            "label": "DEL",
            "ref": "DEL",
            "subject": r.get("title", ""),
            "status": r.get("status", ""),
            "date": r.get("due_date", ""),
            "id": r["id"],
        })

    return {"query": q, "results": results}
