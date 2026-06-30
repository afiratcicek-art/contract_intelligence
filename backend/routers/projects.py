from fastapi import APIRouter, Depends
from uuid import UUID
import logging
from backend.database import get_authed_db, get_admin_client
from backend.core.security import get_current_user
from backend.core.dependencies import verify_project_access, require_cm_role
from backend.core.exceptions import NotFoundError
from backend.core.cache import cache_get, cache_set, cache_delete, cache_delete_prefix
from backend.models.project import (
    ProjectCreate, ProjectUpdate, ProjectResponse,
    ProjectMemberAdd, ProjectMemberUpdate, ProjectMemberResponse,
    ProjectPartyCreate, ProjectPartyResponse,
)
from backend.repositories.project_repository import ProjectRepository
from backend.services.audit_service import AuditService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
def list_projects(
    current_user: dict = Depends(get_current_user),
):
    cache_key = f"projects:list:{current_user['tenant_id']}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    db = get_authed_db(current_user["_meta"]["token"])
    repo = ProjectRepository(db)
    result = repo.list_by_tenant(current_user["tenant_id"])
    cache_set(cache_key, result, ttl=60)
    return result


@router.post("", status_code=201)
def create_project(
    body: ProjectCreate,
    current_user: dict = Depends(get_current_user),
):
    db = get_authed_db(current_user["_meta"]["token"])
    repo = ProjectRepository(db)
    audit = AuditService()

    data = body.model_dump(mode="json", exclude_none=True)
    data["tenant_id"] = current_user["tenant_id"]
    data["created_by"] = current_user["id"]

    project = repo.create(data)

    # Proje oluşturanı CM olarak ekle.
    # RLS: kullanıcı henüz bu projenin üyesi değil — tavuk-yumurta problemi.
    # İlk üyelik kaydı sistem kararı olduğundan admin client kullanılır.
    get_admin_client().table("project_members").insert({
        "project_id": project["id"],
        "user_id": current_user["id"],
        "project_role": "cm",
        "can_approve": True,
        "can_publish": True,
    }).execute()

    audit.log(
        action="create", entity_type="project", entity_id=project["id"],
        user_id=current_user["id"], project_id=project["id"],
    )
    cache_delete_prefix(f"projects:list:{current_user['tenant_id']}")
    return project


@router.get("/{project_id}")
def get_project(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    cache_key = f"projects:detail:{str(project_id)}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    db = access["db"]
    repo = ProjectRepository(db)
    result = repo.get_with_config(str(project_id))
    cache_set(cache_key, result, ttl=30)
    return result


@router.put("/{project_id}")
def update_project(
    project_id: UUID,
    body: ProjectUpdate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = ProjectRepository(db)
    audit = AuditService()

    old = repo.get_or_404(str(project_id))
    data = body.model_dump(mode="json", exclude_none=True)
    updated = repo.update(str(project_id), data)

    audit.log(
        action="update", entity_type="project", entity_id=str(project_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={k: old.get(k) for k in data},
        new_value=data,
    )
    cache_delete_prefix(f"projects:list:{access['user']['tenant_id']}")
    cache_delete(f"projects:detail:{str(project_id)}")
    cache_delete(f"projects:health:{str(project_id)}")
    cache_delete(f"projects:activity:{str(project_id)}")
    cache_delete_prefix(f"projects:deadlines:{str(project_id)}")
    cache_delete(f"projects:overdue:{str(project_id)}")
    return updated


# ── Members ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/members")
def list_members(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    result = (
        db.table("project_members")
        .select("*, profiles(full_name, email)")
        .eq("project_id", str(project_id))
        .eq("is_active", True)
        .execute()
    )
    return result.data or []


@router.post("/{project_id}/members", status_code=201)
def add_member(
    project_id: UUID,
    body: ProjectMemberAdd,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    data = body.model_dump(mode="json")
    data["project_id"] = str(project_id)
    result = db.table("project_members").insert(data).execute()
    audit = AuditService()
    audit.log(
        action="create", entity_type="project_member",
        entity_id=result.data[0].get("id", str(project_id)),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"user_id": data.get("user_id"), "project_role": data.get("project_role")},
    )
    return result.data[0]


@router.put("/{project_id}/members/{user_id}")
def update_member(
    project_id: UUID,
    user_id: UUID,
    body: ProjectMemberUpdate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    data = body.model_dump(mode="json", exclude_none=True)
    result = (
        db.table("project_members")
        .update(data)
        .eq("project_id", str(project_id))
        .eq("user_id", str(user_id))
        .execute()
    )
    audit = AuditService()
    audit.log(
        action="update", entity_type="project_member",
        entity_id=str(user_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value=data,
    )
    return result.data[0] if result.data else {}


# ── Parties ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/parties")
def list_parties(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    result = (
        db.table("project_parties")
        .select("*")
        .eq("project_id", str(project_id))
        .eq("is_active", True)
        .execute()
    )
    return result.data or []


@router.post("/{project_id}/parties", status_code=201)
def add_party(
    project_id: UUID,
    body: ProjectPartyCreate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    data = body.model_dump(mode="json")
    data["project_id"] = str(project_id)
    data["added_by"] = access["user"]["id"]
    result = db.table("project_parties").insert(data).execute()
    audit = AuditService()
    audit.log(
        action="create", entity_type="project_party",
        entity_id=result.data[0].get("id", str(project_id)),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"party_type": data.get("party_type"), "party_name": data.get("party_name")},
    )
    return result.data[0]


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
        .select("due_date")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .not_.is_("due_date", "null")
        .gt("due_date", str(today))
        .lte("due_date", str(end))
        .execute()
    )
    for r in (deliv_future.data or []):
        if r.get("due_date"):
            d = str(r["due_date"])[:10]
            if d in days:
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
        .in_("status", ["pending", "in_progress"])
        .not_.is_("due_date", "null")
        .lt("due_date", str(start))
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
    user_id = access["user"]["id"]
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
        delivs = (
            db.table("deliverables")
            .select("id, title, due_date")
            .eq("project_id", str(project_id))
            .eq("is_deleted", False)
            .in_("status", ["pending", "in_progress"])
            .not_.is_("due_date", "null")
            .gte("due_date", str(today))
            .lte("due_date", str(end))
            .order("due_date")
            .execute()
        )
        for r in (delivs.data or []):
            results.append({
                "type": "deliverable",
                "label": "DEL",
                "ref": "DEL",
                "subject": r.get("title", ""),
                "due_date": r.get("due_date"),
                "id": r["id"],
            })

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
    """Global keyword arama — tüm modüllerde."""
    db = access["db"]
    keyword = f"%{q.strip()}%" if q.strip() else "%"
    results = []

    # Correspondence
    corr = (
        db.table("correspondences")
        .select("id, corr_number, subject, type, status, correspondence_date, direction, parent_id, has_response")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .ilike("subject", keyword)
        .limit(200)
        .execute()
    )
    for r in (corr.data or []):
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

    # RFI
    rfis = (
        db.table("rfis")
        .select("id, rfi_number, subject, status, submitted_date, discipline, parent_id, rfi_type")
        .eq("project_id", str(project_id))
        .eq("is_deleted", False)
        .ilike("subject", keyword)
        .limit(200)
        .execute()
    )
    for r in (rfis.data or []):
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

    # Change
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

    # Deliverable
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

    # Documents — uses search_project_documents RPC (migration 020)
    # for morphological matching across keywords, location,
    # filename, doc_type, and subject (RFI/correspondence join).
    # SECURITY INVOKER — RLS enforced via anon client (db).
    # No N+1: single RPC call, JOIN happens inside Postgres.
    if q.strip():
        try:
            doc_result = db.rpc(
                "search_project_documents",
                {
                    "p_project_id": str(project_id),
                    "p_query": q.strip(),
                    "p_filter": "general",
                    "p_limit": 200,
                },
            ).execute()
            for r in (doc_result.data or []):
                # Prefer the linked entity's subject (RFI/correspondence)
                # so the user sees what it's about, not just the filename.
                # Fall back to filename when no entity subject exists
                # (e.g. contract_document, internal_alert attachments).
                display_subject = r.get("subject") or r.get("original_filename", "")
                results.append({
                    "module": "document",
                    "label": "DOC",
                    "ref": r.get("original_filename", "")[:40],
                    "subject": display_subject,
                    "status": "",
                    "date": r.get("doc_date", ""),
                    "id": r["id"],
                    "entity_type": r.get("entity_type"),
                    "entity_id": r.get("entity_id"),
                    "keywords": r.get("keywords", []),
                    "location": r.get("location"),
                })
        except Exception as exc:
            logger.error(
                "Document search RPC failed: %s | project=%s q=%s",
                exc, project_id, q.strip(),
            )
            # Non-fatal — other modules still return results

    return {"query": q, "results": results}
