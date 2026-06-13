from fastapi import APIRouter, Depends, HTTPException, Request
from uuid import UUID
from backend.database import get_db
from backend.core.dependencies import verify_project_access, require_permission
from backend.core.exceptions import NotFoundError
from backend.core.limiter import limiter
from backend.models.chronology import (
    ChronologyCreate, ChronologyEventCreate, NarrativeApprove, EventInactivate,
)
from backend.repositories.chronology_repository import ChronologyRepository
from backend.services.chronology_service import ChronologyService
from backend.services.audit_service import AuditService
from backend.services.claude_service import get_ai_service

router = APIRouter(prefix="/projects/{project_id}/chronologies", tags=["chronologies"])


@router.get("")
def list_chronologies(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
    db=Depends(get_db),
):
    repo = ChronologyRepository(db)
    return repo.list_by_project(str(project_id))


@router.post("", status_code=201)
def create_chronology(
    project_id: UUID,
    body: ChronologyCreate,
    access: dict = Depends(require_permission("chronology", "create")),
    db=Depends(get_db),
):
    data = body.model_dump(exclude_none=True)
    data["project_id"] = str(project_id)
    data["created_by"] = access["user"]["id"]
    result = db.table("chronologies").insert(data).execute()
    audit = AuditService(db)
    audit.log(
        action="create", entity_type="chronology",
        entity_id=result.data[0]["id"],
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"title": data.get("title")},
    )
    return result.data[0]


@router.get("/{chronology_id}")
def get_chronology(
    project_id: UUID,
    chronology_id: UUID,
    include_inactive: bool = False,
    access: dict = Depends(verify_project_access),
    db=Depends(get_db),
):
    repo = ChronologyRepository(db)
    chrono = repo.get(str(chronology_id))
    if not chrono:
        raise NotFoundError()
    if chrono["project_id"] != str(project_id):
        raise NotFoundError()
    chrono["events"] = repo.get_events(str(chronology_id), include_inactive=include_inactive)
    return chrono


@router.post("/{chronology_id}/events", status_code=201)
@limiter.limit("10/minute")
def add_event(
    request: Request,
    project_id: UUID,
    chronology_id: UUID,
    body: ChronologyEventCreate,
    access: dict = Depends(require_permission("chronology", "create")),
    db=Depends(get_db),
):
    audit = AuditService(db)
    ai = get_ai_service(db)
    service = ChronologyService(db, ai_service=ai, audit_service=audit)

    return service.record_event(
        chronology_id=str(chronology_id),
        event_type=body.event_type,
        event_date=body.event_date,
        document_ref_id=str(body.document_ref_id) if body.document_ref_id else None,
        document_ref_type=body.document_ref_type,
        created_by=access["user"]["id"],
        auto_generate_narrative=True,
        is_key_event=body.is_key_event,
        activity_id=body.activity_id,
        boq_ref=body.boq_ref,
    )


@router.post("/{chronology_id}/events/{event_id}/approve-narrative")
def approve_narrative(
    project_id: UUID,
    chronology_id: UUID,
    event_id: UUID,
    body: NarrativeApprove,
    access: dict = Depends(require_permission("chronology", "approve")),
    db=Depends(get_db),
):
    audit = AuditService(db)
    service = ChronologyService(db, audit_service=audit)
    return service.approve_narrative(
        event_id=str(event_id),
        approved_narrative=body.approved_narrative,
        approved_by=access["user"]["id"],
        project_id=str(project_id),
    )


@router.post("/{chronology_id}/events/{event_id}/inactivate")
def inactivate_event(
    project_id: UUID,
    chronology_id: UUID,
    event_id: UUID,
    body: EventInactivate,
    access: dict = Depends(require_permission("chronology", "inactivate")),
    db=Depends(get_db),
):
    audit = AuditService(db)
    service = ChronologyService(db, audit_service=audit)
    return service.inactivate_event(
        event_id=str(event_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        reason=body.reason,
    )
