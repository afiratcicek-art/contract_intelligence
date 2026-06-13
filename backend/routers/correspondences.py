from fastapi import APIRouter, Depends, Query, HTTPException, Request
from typing import Optional
from uuid import UUID
from datetime import datetime
from backend.database import get_db
from backend.core.dependencies import verify_project_access, require_permission
from backend.core.exceptions import RaceConditionError, NotFoundError
from backend.core.limiter import limiter
from backend.models.correspondence import (
    CorrespondenceCreate, CorrespondenceUpdate,
    ContractualStatusUpdate, CorrespondencePublish, CorrespondenceClose,
    CorrespondenceReferenceAdd, DraftSave,
)
from backend.repositories.correspondence_repository import CorrespondenceRepository
from backend.services.audit_service import AuditService
from backend.services.deadline_service import DeadlineService
from backend.services.claude_service import get_ai_service
from backend.utils.date_utils import urgency_label
from datetime import date

router = APIRouter(prefix="/projects/{project_id}/correspondences", tags=["correspondences"])


@router.get("")
def list_correspondences(
    project_id: UUID,
    direction: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    access: dict = Depends(verify_project_access),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    return repo.list_by_project(
        str(project_id),
        direction=direction,
        corr_type=type,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.post("", status_code=201)
def create_correspondence(
    project_id: UUID,
    body: CorrespondenceCreate,
    access: dict = Depends(require_permission("correspondence", "create")),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    audit = AuditService(db)

    data = body.model_dump(exclude_none=True)
    data["project_id"] = str(project_id)
    data["created_by"] = access["user"]["id"]

    if "correspondence_date" in data:
        data["correspondence_date"] = str(data["correspondence_date"])

    if not body.response_due_date:
        deadline_svc = DeadlineService()
        project_config, calendar_config = DeadlineService.fetch_configs(db, str(project_id))
        deadline_svc.apply_response_deadline(
            data,
            start_date=body.correspondence_date,
            config_period_days=project_config.get("notice_period_days"),
            day_type=project_config.get("correspondence_day_type", "calendar"),
            calendar_config=calendar_config,
        )
    elif "response_due_date" in data:
        data["response_due_date"] = str(data["response_due_date"])

    corr = repo.create(data)
    audit.log(
        action="create", entity_type="correspondence", entity_id=corr["id"],
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"type": corr["type"], "direction": corr["direction"]},
    )
    return corr


@router.get("/deadlines")
def list_deadlines(
    project_id: UUID,
    days: int = Query(14, le=90),
    access: dict = Depends(verify_project_access),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    items = repo.get_pending_deadlines(str(project_id), days=days)
    results = []
    for item in items:
        if item.get("response_due_date"):
            deadline = date.fromisoformat(item["response_due_date"])
            remaining, urgency = urgency_label(deadline)
        else:
            remaining, urgency = None, "NORMAL"
        results.append({
            **item,
            "days_remaining": remaining,
            "urgency": urgency,
        })
    return results


@router.get("/{corr_id}")
def get_correspondence(
    project_id: UUID,
    corr_id: UUID,
    access: dict = Depends(verify_project_access),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    corr = repo.get_with_breadcrumb(str(corr_id))
    if not corr:
        raise NotFoundError()
    if corr["project_id"] != str(project_id):
        raise NotFoundError()
    corr["references"] = repo.get_references(str(corr_id))
    corr["documents"] = repo.get_documents(str(corr_id))
    return corr


@router.put("/{corr_id}")
def update_correspondence(
    project_id: UUID,
    corr_id: UUID,
    body: CorrespondenceUpdate,
    access: dict = Depends(require_permission("correspondence", "edit")),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    audit = AuditService(db)

    old = repo.get_or_404(str(corr_id))
    if old["project_id"] != str(project_id):
        raise NotFoundError()
    data = body.model_dump(exclude_none=True)
    for field in ("correspondence_date", "response_due_date", "actual_response_date"):
        if field in data:
            data[field] = str(data[field])

    updated = repo.update(str(corr_id), data)
    audit.log(
        action="update", entity_type="correspondence", entity_id=str(corr_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={k: old.get(k) for k in data},
        new_value=data,
    )
    return updated


@router.post("/{corr_id}/submit-for-approval")
def submit_for_approval(
    project_id: UUID,
    corr_id: UUID,
    access: dict = Depends(require_permission("correspondence", "edit")),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    audit = AuditService(db)
    old = repo.get_or_404(str(corr_id))
    if old["project_id"] != str(project_id):
        raise NotFoundError()

    updated = repo.update(str(corr_id), {"status": "under_review"})
    audit.log(
        action="status_change", entity_type="correspondence", entity_id=str(corr_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={"status": old["status"]},
        new_value={"status": "under_review"},
    )
    return updated


@router.post("/{corr_id}/approve")
def approve_correspondence(
    project_id: UUID,
    corr_id: UUID,
    version: int = Query(..., description="Optimistic lock için mevcut versiyon"),
    access: dict = Depends(require_permission("correspondence", "approve")),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    audit = AuditService(db)

    corr = repo.get_or_404(str(corr_id))
    if corr["project_id"] != str(project_id):
        raise NotFoundError()

    updated = repo.update_with_version_check(
        str(corr_id),
        {"status": "approved", "approved_by": access["user"]["id"], "approved_at": datetime.utcnow().isoformat()},
        version,
    )
    if not updated:
        raise RaceConditionError()

    audit.log(
        action="approve", entity_type="correspondence", entity_id=str(corr_id),
        user_id=access["user"]["id"], project_id=str(project_id),
    )
    return updated


@router.post("/{corr_id}/publish")
def publish_correspondence(
    project_id: UUID,
    corr_id: UUID,
    body: CorrespondencePublish,
    access: dict = Depends(require_permission("correspondence", "publish")),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    audit = AuditService(db)

    corr = repo.get_or_404(str(corr_id))
    if corr["project_id"] != str(project_id):
        raise NotFoundError()

    data = {
        "status": "published",
        "published_at": datetime.utcnow().isoformat(),
        "published_by": access["user"]["id"],
    }
    if body.publication_channel:
        data["publication_channel"] = body.publication_channel
    if body.publication_ref:
        data["publication_ref"] = body.publication_ref

    updated = repo.update(str(corr_id), data)
    audit.log(
        action="publish", entity_type="correspondence", entity_id=str(corr_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"channel": body.publication_channel},
    )
    return updated


@router.post("/{corr_id}/close")
def close_correspondence(
    project_id: UUID,
    corr_id: UUID,
    body: CorrespondenceClose,
    access: dict = Depends(require_permission("correspondence", "close")),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    audit = AuditService(db)

    corr = repo.get_or_404(str(corr_id))
    if corr["project_id"] != str(project_id):
        raise NotFoundError()

    data = {
        "status": "closed",
        "closed_by": access["user"]["id"],
        "closed_at": datetime.utcnow().isoformat(),
    }
    if body.close_note:
        data["close_note"] = body.close_note

    updated = repo.update(str(corr_id), data)
    audit.log(
        action="close", entity_type="correspondence", entity_id=str(corr_id),
        user_id=access["user"]["id"], project_id=str(project_id),
    )
    return updated


@router.put("/{corr_id}/contractual-status")
def set_contractual_status(
    project_id: UUID,
    corr_id: UUID,
    body: ContractualStatusUpdate,
    access: dict = Depends(require_permission("correspondence", "edit")),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    audit = AuditService(db)
    old = repo.get_or_404(str(corr_id))
    if old["project_id"] != str(project_id):
        raise NotFoundError()

    data = {
        "contractual_status": body.contractual_status,
        "contractual_status_set_by": access["user"]["id"],
        "contractual_status_set_at": datetime.utcnow().isoformat(),
    }
    if body.contractual_status_note:
        data["contractual_status_note"] = body.contractual_status_note

    updated = repo.update(str(corr_id), data)
    audit.log(
        action="override", entity_type="correspondence", entity_id=str(corr_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={"contractual_status": old["contractual_status"]},
        new_value={"contractual_status": body.contractual_status, "note": body.contractual_status_note},
    )
    return updated


# ── References ─────────────────────────────────────────────────────────────

@router.post("/{corr_id}/references", status_code=201)
def add_reference(
    project_id: UUID,
    corr_id: UUID,
    body: CorrespondenceReferenceAdd,
    access: dict = Depends(require_permission("correspondence", "edit")),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    corr = repo.get_or_404(str(corr_id))
    if corr["project_id"] != str(project_id):
        raise NotFoundError()
    data = body.model_dump(exclude_none=True)
    data["correspondence_id"] = str(corr_id)
    data["added_by"] = access["user"]["id"]
    if "external_doc_date" in data:
        data["external_doc_date"] = str(data["external_doc_date"])
    result = db.table("correspondence_references").insert(data).execute()
    audit = AuditService(db)
    audit.log(
        action="create", entity_type="correspondence_reference",
        entity_id=result.data[0].get("id", str(corr_id)),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"correspondence_id": str(corr_id)},
    )
    return result.data[0]


# ── Drafts ─────────────────────────────────────────────────────────────────

@router.post("/{corr_id}/drafts", status_code=201)
def save_draft(
    project_id: UUID,
    corr_id: UUID,
    body: DraftSave,
    access: dict = Depends(require_permission("correspondence", "edit")),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    corr = repo.get_or_404(str(corr_id))
    if corr["project_id"] != str(project_id):
        raise NotFoundError()
    data = {
        "correspondence_id": str(corr_id),
        "content": body.content,
        "draft_type": "manual",
        "saved_by": access["user"]["id"],
        "note": body.note,
    }
    result = db.table("correspondence_drafts").insert(data).execute()
    audit = AuditService(db)
    audit.log(
        action="create", entity_type="correspondence_draft",
        entity_id=result.data[0].get("id", str(corr_id)),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"correspondence_id": str(corr_id), "draft_type": "manual"},
    )
    return result.data[0]


@router.post("/{corr_id}/ai-draft")
@limiter.limit("10/minute")
def generate_ai_draft(
    request: Request,
    project_id: UUID,
    corr_id: UUID,
    language: str = Query("en", enum=["en", "ar", "tr"]),
    user_instructions: str = Query(""),
    access: dict = Depends(require_permission("correspondence", "edit")),
    db=Depends(get_db),
):
    repo = CorrespondenceRepository(db)
    corr = repo.get_or_404(str(corr_id))
    if corr["project_id"] != str(project_id):
        raise NotFoundError()

    project = db.table("projects").select("*").eq("id", str(project_id)).single().execute()
    project_context = project.data if project.data else {}

    ai = get_ai_service(db)
    result = ai.generate_correspondence_draft(
        correspondence_type=corr["type"],
        project_context=project_context,
        clause_references=[],
        user_instructions=user_instructions,
        language=language,
        project_id=str(project_id),
        user_id=access["user"]["id"],
        entity_id=str(corr_id),
    )

    db.table("correspondence_drafts").insert({
        "correspondence_id": str(corr_id),
        "content": result.draft_text,
        "draft_type": "ai_generated",
        "saved_by": access["user"]["id"],
    }).execute()

    return {
        "draft_text": result.draft_text,
        "confidence_score": result.confidence_score,
        "clause_citations": result.clause_citations,
        "review_required": result.review_required,
    }
