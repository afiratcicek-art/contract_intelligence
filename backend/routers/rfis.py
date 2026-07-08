import logging

from fastapi import APIRouter, Depends, Query
from typing import Optional
from uuid import UUID
from datetime import date, datetime
from backend.core.dependencies import verify_project_access, require_permission
from backend.core.exceptions import RaceConditionError, NotFoundError
from backend.database import get_admin_client
from backend.models.rfi import RFICreate, RFIUpdate, RFIClose, RFIReferenceAdd
from backend.routers.documents import _upsert_keyword_stats
from backend.repositories.rfi_repository import RFIRepository
from backend.services.audit_service import AuditService
from backend.services.deadline_service import DeadlineService
from backend.utils.date_utils import urgency_label

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/rfis", tags=["rfis"])


@router.get("")
def list_rfis(
    project_id: UUID,
    status: Optional[str] = Query(None),
    discipline: Optional[str] = Query(None),
    q: Optional[str] = Query(None, max_length=200, description="Search query — uses chain-aware RPC when present"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    access: dict = Depends(verify_project_access),
):
    """List RFIs for a project.

    When q is provided, uses search_rfi_chains RPC (migration 022)
    for morphological matching on subject and attached document
    keywords/location. Returns full chains (root + responses/
    revisions), not just the matching row.

    When q is absent, uses standard repository listing with
    status/discipline filters and pagination — unchanged behavior.
    """
    db = access["db"]
    if q and q.strip():
        try:
            result = db.rpc(
                "search_rfi_chains",
                {"p_project_id": str(project_id), "p_query": q.strip(), "p_limit": limit},
            ).execute()
            rows = result.data or []
            if status:
                rows = [r for r in rows if r.get("status") == status]
            if discipline:
                rows = [r for r in rows if r.get("discipline") == discipline]
            return rows
        except Exception as exc:
            logger.error(
                "RFI chain search failed: %s | project=%s q=%s",
                exc, project_id, q.strip(),
            )
            return []
    repo = RFIRepository(db)
    return repo.list_by_project(
        str(project_id),
        status=status,
        discipline=discipline,
        limit=limit,
        offset=offset,
    )


@router.post("", status_code=201)
def create_rfi(
    project_id: UUID,
    body: RFICreate,
    access: dict = Depends(require_permission("rfi", "create")),
):
    db = access["db"]
    repo = RFIRepository(db)
    audit = AuditService()

    data = body.model_dump(mode="json", exclude_none=True)
    data["project_id"] = str(project_id)
    data["created_by"] = access["user"]["id"]
    if "submitted_date" in data:
        data["submitted_date"] = str(data["submitted_date"])
    if "parent_id" in data and data["parent_id"]:
        data["parent_id"] = str(data["parent_id"])
        parent_rfi = repo.get(str(data["parent_id"]))
        if not parent_rfi or parent_rfi.get("project_id") != str(project_id):
            from fastapi import HTTPException
            raise HTTPException(403, "Geçersiz parent_id")
        # Parent RFI status → "responded" otomatik
        repo.update_parent_rfi_status(str(data["parent_id"]))

    if not body.response_due_date:
        deadline_svc = DeadlineService()
        project_config, calendar_config = DeadlineService.fetch_configs(db, str(project_id))
        deadline_svc.apply_response_deadline(
            data,
            start_date=body.submitted_date,
            config_period_days=project_config.get("rfi_response_days", 14),
            day_type=project_config.get("rfi_day_type", "calendar"),
            calendar_config=calendar_config,
        )
    elif "response_due_date" in data:
        data["response_due_date"] = str(data["response_due_date"])

    rfi = repo.create(data)
    audit.log(
        action="create", entity_type="rfi", entity_id=rfi["id"],
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value=data,
    )
    # Keyword stats upsert (migration 026 — project_keyword_stats)
    _upsert_keyword_stats(get_admin_client(), str(project_id), rfi.get("keywords") or [])
    return rfi


@router.get("/deadlines")
def list_rfi_deadlines(
    project_id: UUID,
    days: int = Query(14, le=90),
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    repo = RFIRepository(db)
    rfis = repo.get_pending_deadlines(str(project_id), days=days)

    results = []
    for rfi in rfis:
        if rfi.get("response_due_date"):
            deadline = date.fromisoformat(rfi["response_due_date"])
            remaining, urgency = urgency_label(deadline)
        else:
            remaining, urgency = None, "NORMAL"

        results.append({
            "rfi_id": rfi["id"],
            "rfi_number": rfi["rfi_number"],
            "subject": rfi["subject"],
            "deadline": rfi.get("response_due_date"),
            "deadline_source": rfi.get("response_due_source"),
            "days_remaining": remaining,
            "urgency": urgency,
        })
    return results


@router.get("/{rfi_id}")
def get_rfi(
    project_id: UUID,
    rfi_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    repo = RFIRepository(db)
    rfi = repo.get_or_404(str(rfi_id))
    if rfi["project_id"] != str(project_id):
        raise NotFoundError()
    rfi["linked_correspondences"] = repo.get_linked_correspondences(str(rfi_id))
    rfi["chain"] = repo.get_chain(str(rfi_id), str(project_id))
    return rfi


@router.get("/{rfi_id}/deadline")
def get_rfi_deadline(
    project_id: UUID,
    rfi_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    repo = RFIRepository(db)
    rfi = repo.get_or_404(str(rfi_id))
    if rfi["project_id"] != str(project_id):
        raise NotFoundError()

    if rfi.get("response_due_date"):
        deadline = date.fromisoformat(rfi["response_due_date"])
        remaining, urgency = urgency_label(deadline)
    else:
        deadline, remaining, urgency = None, None, "NORMAL"

    return {
        "rfi_id": rfi["id"],
        "rfi_number": rfi["rfi_number"],
        "subject": rfi["subject"],
        "deadline": rfi.get("response_due_date"),
        "deadline_source": rfi.get("response_due_source"),
        "days_remaining": remaining,
        "urgency": urgency,
    }


@router.put("/{rfi_id}")
def update_rfi(
    project_id: UUID,
    rfi_id: UUID,
    body: RFIUpdate,
    access: dict = Depends(require_permission("rfi", "edit")),
):
    db = access["db"]
    repo = RFIRepository(db)
    audit = AuditService()

    old = repo.get_or_404(str(rfi_id))
    if old["project_id"] != str(project_id):
        raise NotFoundError()
    data = body.model_dump(mode="json", exclude_none=True)
    for field in ("submitted_date", "response_due_date", "actual_response_date"):
        if field in data:
            data[field] = str(data[field])

    expected_version = data.pop("version", None)
    updated = repo.update_with_version_check(str(rfi_id), data, expected_version)
    if not updated:
        raise RaceConditionError()

    audit.log(
        action="update", entity_type="rfi", entity_id=str(rfi_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={k: old.get(k) for k in data},
        new_value=data,
    )
    return updated


@router.post("/{rfi_id}/close")
def close_rfi(
    project_id: UUID,
    rfi_id: UUID,
    body: RFIClose,
    access: dict = Depends(require_permission("rfi", "close")),
):
    db = access["db"]
    repo = RFIRepository(db)
    audit = AuditService()

    rfi = repo.get_or_404(str(rfi_id))
    if rfi["project_id"] != str(project_id):
        raise NotFoundError()
    data = {
        "status": "closed",
        "closed_by": access["user"]["id"],
        "closed_at": datetime.utcnow().isoformat(),
    }
    if body.close_note:
        data["close_note"] = body.close_note

    expected_version = body.version
    updated = repo.update_with_version_check(str(rfi_id), data, expected_version)
    if not updated:
        raise RaceConditionError()

    audit.log(
        action="close", entity_type="rfi", entity_id=str(rfi_id),
        user_id=access["user"]["id"], project_id=str(project_id),
    )
    return updated


@router.delete("/{rfi_id}", status_code=204)
def delete_rfi(
    project_id: UUID,
    rfi_id: UUID,
    access: dict = Depends(require_permission("rfi", "edit")),
):
    db = access["db"]
    repo = RFIRepository(db)
    audit = AuditService()
    rfi = repo.get_or_404(str(rfi_id))
    if rfi["project_id"] != str(project_id):
        raise NotFoundError()
    repo.soft_delete(str(rfi_id), deleted_by=access["user"]["id"])
    audit.log(
        action="update", entity_type="rfi", entity_id=str(rfi_id),
        user_id=access["user"]["id"], project_id=str(project_id),
    )


# ── References ─────────────────────────────────────────────────────────────

@router.post("/{rfi_id}/references", status_code=201)
def add_reference(
    project_id: UUID,
    rfi_id: UUID,
    body: RFIReferenceAdd,
    access: dict = Depends(require_permission("rfi", "edit")),
):
    db = access["db"]
    repo = RFIRepository(db)
    rfi = repo.get_or_404(str(rfi_id))
    if rfi["project_id"] != str(project_id):
        raise NotFoundError()

    if body.rfi_id:
        target = db.table("rfis").select("project_id").eq("id", str(body.rfi_id)).execute()
        if not target.data or target.data[0].get("project_id") != str(project_id):
            raise NotFoundError()
    if body.ref_corr_id:
        target = db.table("correspondences").select("project_id").eq("id", str(body.ref_corr_id)).execute()
        if not target.data or target.data[0].get("project_id") != str(project_id):
            raise NotFoundError()
    if body.change_id:
        target = db.table("changes").select("project_id").eq("id", str(body.change_id)).execute()
        if not target.data or target.data[0].get("project_id") != str(project_id):
            raise NotFoundError()

    data = body.model_dump(mode="json", exclude_none=True)
    data["owner_rfi_id"] = str(rfi_id)
    data["added_by"] = access["user"]["id"]
    if "external_doc_date" in data:
        data["external_doc_date"] = str(data["external_doc_date"])
    result = db.table("rfi_references").insert(data).execute()
    audit = AuditService()
    audit.log(
        action="create", entity_type="rfi_reference",
        entity_id=result.data[0].get("id", str(rfi_id)),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"owner_rfi_id": str(rfi_id)},
    )
    return result.data[0]
