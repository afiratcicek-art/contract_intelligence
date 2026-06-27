from fastapi import APIRouter, Depends, Request
from uuid import UUID
from backend.core.dependencies import verify_project_access, require_permission
from backend.core.exceptions import NotFoundError
from backend.core.limiter import limiter
from backend.models.chronology import (
    ChronologyCreate, ChronologyEventCreate,
    NarrativeApprove, EventInactivate,
    ChronologyResponse, ChronologyEventResponse,
)
from backend.repositories.chronology_repository import ChronologyRepository
from backend.services.chronology_service import ChronologyService
from backend.services.audit_service import AuditService
from backend.services.claude_service import get_ai_service
from backend.repositories.rfi_repository import RFIRepository
from backend.repositories.correspondence_repository import CorrespondenceRepository

router = APIRouter(prefix="/projects/{project_id}/chronologies", tags=["chronologies"])


@router.get("", response_model=list[ChronologyResponse])
def list_chronologies(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    repo = ChronologyRepository(db)
    return repo.list_by_project(str(project_id))


@router.post("", status_code=201, response_model=ChronologyResponse)
def create_chronology(
    project_id: UUID,
    body: ChronologyCreate,
    access: dict = Depends(require_permission("chronology", "create")),
):
    db = access["db"]
    data = body.model_dump(mode="json", exclude_none=True)
    data["project_id"] = str(project_id)
    data["created_by"] = access["user"]["id"]
    result = db.table("chronologies").insert(data).execute()
    audit = AuditService()
    audit.log(
        action="create", entity_type="chronology",
        entity_id=result.data[0]["id"],
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"title": data.get("title")},
    )
    return result.data[0]


@router.get("/linkable-documents")
def list_linkable_documents(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """Return RFIs and Correspondences available to link
    as chronology events, ordered by document date ascending.

    Each item shape:
      id, type, ref_number, subject, date, status, parent_id
    """
    db = access["db"]

    rfi_repo = RFIRepository(db)
    corr_repo = CorrespondenceRepository(db)

    rfis = rfi_repo.list_by_project(str(project_id), limit=500)
    corrs = corr_repo.list_by_project(str(project_id), limit=500)

    documents: list[dict] = []

    for r in rfis:
        documents.append({
            "id": r["id"],
            "type": "rfi",
            "ref_number": r.get("rfi_number", ""),
            "subject": r.get("subject", ""),
            "date": r.get("submitted_date", ""),
            "status": r.get("status", ""),
            "parent_id": r.get("parent_id"),
        })

    for c in corrs:
        documents.append({
            "id": c["id"],
            "type": "correspondence",
            "ref_number": c.get("corr_number", ""),
            "subject": c.get("subject", ""),
            "date": c.get("correspondence_date", ""),
            "status": c.get("status", ""),
            "parent_id": c.get("parent_id"),
        })

    # Sort by date ascending — chronological order
    documents.sort(
        key=lambda d: d["date"] or "",
        reverse=False,
    )

    return documents


@router.get("/{chronology_id}", response_model=ChronologyResponse)
def get_chronology(
    project_id: UUID,
    chronology_id: UUID,
    include_inactive: bool = False,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    repo = ChronologyRepository(db)
    chrono = repo.get(str(chronology_id))
    if not chrono:
        raise NotFoundError()
    if chrono["project_id"] != str(project_id):
        raise NotFoundError()
    chrono["events"] = repo.get_events(str(chronology_id), include_inactive=include_inactive)
    return chrono


@router.post("/{chronology_id}/events", status_code=201, response_model=ChronologyEventResponse)
@limiter.limit("10/minute")
def add_event(
    request: Request,
    project_id: UUID,
    chronology_id: UUID,
    body: ChronologyEventCreate,
    access: dict = Depends(require_permission("chronology", "create")),
):
    db = access["db"]
    audit = AuditService()
    ai = get_ai_service(db)
    service = ChronologyService(
        db,
        ai_service=ai,
        audit_service=audit,
        project_id=str(project_id),
        user_id=str(access["user"]["id"]),
    )

    auto_generate = (
        body.manual_narrative is None
        and body.document_ref_id is not None
    )
    return service.record_event(
        chronology_id=str(chronology_id),
        event_type=body.event_type,
        event_date=body.event_date,
        document_ref_id=str(body.document_ref_id) if body.document_ref_id else None,
        document_ref_type=body.document_ref_type,
        created_by=access["user"]["id"],
        auto_generate_narrative=auto_generate,
        is_key_event=body.is_key_event,
        activity_id=body.activity_id,
        boq_ref=body.boq_ref,
        note=body.manual_narrative,
    )


@router.post("/{chronology_id}/events/{event_id}/approve-narrative", response_model=ChronologyEventResponse)
def approve_narrative(
    project_id: UUID,
    chronology_id: UUID,
    event_id: UUID,
    body: NarrativeApprove,
    access: dict = Depends(require_permission("chronology", "approve")),
):
    db = access["db"]
    audit = AuditService()
    service = ChronologyService(db, audit_service=audit)
    return service.approve_narrative(
        event_id=str(event_id),
        approved_narrative=body.approved_narrative,
        approved_by=access["user"]["id"],
        project_id=str(project_id),
    )


@router.post("/{chronology_id}/events/{event_id}/inactivate", response_model=ChronologyEventResponse)
def inactivate_event(
    project_id: UUID,
    chronology_id: UUID,
    event_id: UUID,
    body: EventInactivate,
    access: dict = Depends(require_permission("chronology", "inactivate")),
):
    db = access["db"]
    audit = AuditService()
    service = ChronologyService(db, audit_service=audit)
    return service.inactivate_event(
        event_id=str(event_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        reason=body.reason,
    )
