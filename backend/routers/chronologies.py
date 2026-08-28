from fastapi import APIRouter, Depends, Request, HTTPException
from uuid import UUID
from backend.core.dependencies import verify_project_access, require_permission
from backend.core.exceptions import NotFoundError
from backend.core.limiter import limiter
from backend.models.chronology import (
    ChronologyCreate, ChronologyUpdate,
    ChronologyEventCreate, ChronologyEventUpdate,
    NarrativeApprove, EventInactivate, NarrativePreview,
    ChronologyListResponse, ChronologyResponse,
    ChronologyEventResponse,
)
from backend.repositories.chronology_repository import ChronologyRepository
from backend.services.chronology_service import ChronologyService
from backend.services.audit_service import AuditService
from backend.services.claude_service import get_ai_service, GateBlockedResult
from backend.repositories.rfi_repository import RFIRepository
from backend.repositories.correspondence_repository import CorrespondenceRepository

router = APIRouter(prefix="/projects/{project_id}/chronologies", tags=["chronologies"])


@router.get("", response_model=list[ChronologyListResponse])
def list_chronologies(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """List chronologies with event count.
    Uses a single query with nested select for counts.
    No N+1 — event_count computed from nested id list.
    """
    db = access["db"]
    # Single query: chronologies + nested active event ids
    result = db.table("chronologies") \
        .select("*, chronology_events!inner(id)") \
        .eq("project_id", str(project_id)) \
        .eq("chronology_events.is_active", True) \
        .order("created_at", desc=True) \
        .execute()

    # Also fetch chronologies with ZERO events
    # (inner join would exclude them)
    all_result = db.table("chronologies") \
        .select("*") \
        .eq("project_id", str(project_id)) \
        .order("created_at", desc=True) \
        .execute()

    # Build event count map from inner join result
    event_counts: dict[str, int] = {}
    for row in (result.data or []):
        cid = row["id"]
        events = row.get("chronology_events", []) or []
        event_counts[cid] = len(events)

    # Merge: all chronologies + their counts (0 if no events)
    rows = all_result.data or []
    output = []
    for row in rows:
        output.append({
            **row,
            "event_count": event_counts.get(row["id"], 0),
        })
    return output


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


@router.patch("/{chronology_id}", response_model=ChronologyResponse)
def update_chronology(
    project_id: UUID,
    chronology_id: UUID,
    body: ChronologyUpdate,
    access: dict = Depends(verify_project_access),
):
    """Update chronology title.
    Allowed for: CM role OR the user who created the chronology.
    Logs old and new value to audit trail.
    """
    db = access["db"]
    repo = ChronologyRepository(db)

    existing = repo.get(str(chronology_id))
    if not existing or existing.get("project_id") != str(project_id):
        raise NotFoundError()

    # Permission: CM role or creator
    from fastapi import HTTPException
    current_user_id = str(access["user"]["id"])
    role = access["member"]["project_role"]
    is_cm = role == "cm"
    is_creator = str(existing.get("created_by", "")) == current_user_id
    if not is_cm and not is_creator:
        raise HTTPException(
            status_code=403,
            detail="Not authorised to edit this chronology."
        )

    data = body.model_dump(mode="json", exclude_none=True)
    result = db.table("chronologies") \
        .update(data) \
        .eq("id", str(chronology_id)) \
        .execute()

    if not result.data:
        raise NotFoundError()

    audit = AuditService()
    audit.log(
        action="update",
        entity_type="chronology",
        entity_id=str(chronology_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        old_value={"title": existing.get("title")},
        new_value={"title": data.get("title", existing.get("title"))},
    )

    updated = result.data[0]
    updated["events"] = repo.get_events(str(chronology_id))
    return updated


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

    rfis = rfi_repo.list_by_project(
        str(project_id), limit=500, exclude_status="draft"
    )
    corrs = corr_repo.list_by_project(
        str(project_id), limit=500, exclude_status="draft"
    )

    documents: list[dict] = []

    for r in rfis:
        # Prefer submitted_date; fall back to created_at date (many RFIs have null submitted).
        raw_date = r.get("submitted_date") or r.get("created_at") or ""
        date_s = str(raw_date)[:10] if raw_date else ""
        documents.append({
            "id": r["id"],
            "type": "rfi",
            "ref_number": r.get("rfi_number") or "",
            "subject": r.get("subject") or "",
            "date": date_s,
            "status": r.get("status") or "",
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


@router.post("/preview-narrative")
@limiter.limit("10/minute")
def preview_narrative(
    request: Request,
    project_id: UUID,
    body: NarrativePreview,
    access: dict = Depends(verify_project_access),
):
    """HITL LLM narrative — does not persist. Same corpus path as dispute claims."""
    db = access["db"]
    if body.chronology_id:
        chrono = ChronologyRepository(db).get(str(body.chronology_id))
        if not chrono or chrono.get("project_id") != str(project_id):
            raise NotFoundError()
    if body.dispute_id:
        row = (
            db.table("disputes")
            .select("id, project_id")
            .eq("id", str(body.dispute_id))
            .limit(1)
            .execute()
        )
        found = (row.data or [None])[0]
        if not found or found.get("project_id") != str(project_id):
            raise NotFoundError()

    from backend.services.dossier_context import assemble_dossier_context

    ctx = assemble_dossier_context(
        db,
        str(project_id),
        dispute_id=str(body.dispute_id) if body.dispute_id else None,
    )
    preceding = []
    if body.chronology_id:
        preceding = ChronologyService(db)._get_preceding_events(
            str(body.chronology_id), limit=5
        )

    ai = get_ai_service(db)
    result = ai.generate_chronology_narrative(
        event={
            "type": body.event_type,
            "date": str(body.event_date),
            "ref": str(body.document_ref_id) if body.document_ref_id else None,
            "note": body.note,
            "subject": body.subject,
        },
        change_context=ctx,
        preceding_events=preceding,
        project_id=str(project_id),
        user_id=str(access["user"]["id"]),
    )
    if isinstance(result, GateBlockedResult):
        raise HTTPException(status_code=422, detail=result.warning_message)
    return {
        "narrative_text": result.narrative_text,
        "review_required": result.review_required,
        "warnings": result.warnings,
    }


@router.get("/events")
def list_events_by_type(
    project_id: UUID,
    event_type: str,
    manual_only: bool = False,
    access: dict = Depends(verify_project_access),
):
    """Project-wide chronology events filtered by event_type (member read)."""
    db = access["db"]
    return ChronologyRepository(db).list_events_by_type(
        str(project_id), event_type, manual_only=manual_only
    )


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
        subject=body.subject,
    )


@router.patch("/{chronology_id}/events/{event_id}", response_model=ChronologyEventResponse)
def update_event(
    project_id: UUID,
    chronology_id: UUID,
    event_id: UUID,
    body: ChronologyEventUpdate,
    access: dict = Depends(verify_project_access),
):
    """Update event metadata: event_type, is_key_event, event_date.
    event_date is only updated for manual entries (no document_ref_type).
    Narrative changes go through approve-narrative endpoint.
    Allowed for: CM role OR chronology creator.
    """
    from fastapi import HTTPException
    db = access["db"]

    # Fetch event and verify it belongs to this project/chronology
    event_result = (
        db.table("chronology_events")
        .select("*")
        .eq("id", str(event_id))
        .eq("chronology_id", str(chronology_id))
        .execute()
    )
    if not event_result.data:
        raise NotFoundError()
    event = event_result.data[0]

    # Verify chronology belongs to project
    chrono_result = (
        db.table("chronologies")
        .select("project_id, created_by")
        .eq("id", str(chronology_id))
        .execute()
    )
    if not chrono_result.data:
        raise NotFoundError()
    chrono = chrono_result.data[0]
    if chrono.get("project_id") != str(project_id):
        raise NotFoundError()

    # Permission: CM role or chronology creator
    current_user_id = str(access["user"]["id"])
    role = access["member"]["project_role"]
    is_cm = role == "cm"
    is_creator = str(chrono.get("created_by", "")) == current_user_id
    if not is_cm and not is_creator:
        raise HTTPException(
            status_code=403,
            detail="Not authorised to edit this event."
        )

    # Build update payload
    data = body.model_dump(mode="json", exclude_none=True)

    # event_date and subject are immutable for document-linked events
    if event.get("document_ref_type"):
        if "event_date" in data:
            raise HTTPException(
                status_code=400,
                detail="event_date cannot be changed for document-linked events."
            )
        if "subject" in data:
            raise HTTPException(
                status_code=400,
                detail="subject cannot be set for document-linked events."
            )

    if not data:
        # Nothing to update — return current event
        return event

    result = (
        db.table("chronology_events")
        .update(data)
        .eq("id", str(event_id))
        .execute()
    )
    if not result.data:
        raise NotFoundError()

    audit = AuditService()
    audit.log(
        action="update",
        entity_type="chronology_event",
        entity_id=str(event_id),
        user_id=current_user_id,
        project_id=str(project_id),
        old_value={k: event.get(k) for k in data},
        new_value=data,
    )

    return result.data[0]


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
