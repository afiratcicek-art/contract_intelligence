"""Dispute Ready dossier — CM write, member read. No LLM."""
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, HTTPException
from fastapi.responses import Response

from backend.core.dependencies import verify_project_access, require_cm_role
from backend.core.exceptions import NotFoundError
from backend.core.guards import assert_target_in_project
from backend.core.limiter import limiter
from backend.models.dispute import (
    DisputeCreate,
    DisputeUpdate,
    ImpactCreate,
    ImpactUpdate,
    IssueCreate,
    IssueUpdate,
    PositionCreate,
    PositionUpdate,
    PositionRefCreate,
    PositionGenerate,
)
from backend.repositories.dispute_repository import DisputeRepository
from backend.repositories.chronology_repository import ChronologyRepository
from backend.services.audit_service import AuditService
from backend.services.dispute_pack import generate_and_store_pack
from backend.utils.file_handler import download_document

router = APIRouter(prefix="/projects/{project_id}/disputes", tags=["disputes"])

_REF_TABLE = {
    "change": "changes",
    "correspondence": "correspondences",
    "rfi": "rfis",
}


def _assert_dispute_in_project(dispute: dict | None, project_id: str) -> dict:
    if not dispute or dispute.get("project_id") != str(project_id):
        raise NotFoundError()
    return dispute


def _load_dispute(repo: DisputeRepository, dispute_id: UUID, project_id: UUID) -> dict:
    return _assert_dispute_in_project(repo.get(str(dispute_id)), str(project_id))


def _load_nested(repo: DisputeRepository, dispute_id: UUID, project_id: UUID) -> dict:
    return _assert_dispute_in_project(repo.get_nested(str(dispute_id)), str(project_id))


def _assert_issue_in_dispute(repo: DisputeRepository, issue_id: UUID, dispute_id: UUID) -> dict:
    issue = repo.get_issue(str(issue_id))
    if not issue or issue.get("dispute_id") != str(dispute_id):
        raise NotFoundError()
    return issue


def _assert_position_in_issue(
    repo: DisputeRepository, position_id: UUID, issue_id: UUID
) -> dict:
    position = repo.get_position(str(position_id))
    if not position or position.get("issue_id") != str(issue_id):
        raise NotFoundError()
    return position


def _assert_ref_in_position(
    repo: DisputeRepository, ref_id: UUID, position_id: UUID
) -> dict:
    ref = repo.get_ref(str(ref_id))
    if not ref or ref.get("position_id") != str(position_id):
        raise NotFoundError()
    return ref


def _guard_source_fks(db, body, project_id: UUID) -> None:
    change_id = getattr(body, "source_change_id", None)
    corr_id = getattr(body, "source_correspondence_id", None)
    if change_id:
        assert_target_in_project(db, "changes", change_id, project_id)
    if corr_id:
        assert_target_in_project(db, "correspondences", corr_id, project_id)


def _find_source_chronology(db, body) -> str | None:
    """Reuse an existing change/correspondence chronology; never invent an empty one."""
    if getattr(body, "source_change_id", None):
        found = (
            db.table("chronologies")
            .select("id")
            .eq("entity_type", "change")
            .eq("entity_id", str(body.source_change_id))
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if found.data:
            return found.data[0]["id"]
    if getattr(body, "source_correspondence_id", None):
        found = (
            db.table("chronologies")
            .select("id")
            .eq("entity_type", "correspondence")
            .eq("entity_id", str(body.source_correspondence_id))
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if found.data:
            return found.data[0]["id"]
    return None


def _enrich_chronology_meta(db, dispute: dict) -> dict:
    cid = dispute.get("chronology_id")
    if not cid:
        dispute["chronology_entity_type"] = None
        dispute["chronology_title"] = None
        return dispute
    row = (
        db.table("chronologies")
        .select("id, title, entity_type, entity_id")
        .eq("id", cid)
        .limit(1)
        .execute()
    )
    found = (row.data or [None])[0]
    dispute["chronology_entity_type"] = found.get("entity_type") if found else None
    dispute["chronology_title"] = found.get("title") if found else None
    return dispute


def _auto_create_chronology(db, dispute: dict, project_id: str, user_id: str) -> str:
    title = f"{dispute.get('dispute_number')} — {dispute.get('title')}"
    result = db.table("chronologies").insert({
        "project_id": project_id,
        "title": title,
        "entity_type": "dispute",
        "entity_id": dispute["id"],
        "created_by": user_id,
    }).execute()
    return result.data[0]["id"]


@router.get("")
def list_disputes(
    project_id: UUID,
    status: str | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    access: dict = Depends(verify_project_access),
):
    repo = DisputeRepository(access["db"])
    return repo.list_by_project(
        str(project_id), status=status, limit=limit, offset=offset
    )


@router.post("", status_code=201)
@limiter.limit("10/minute")
def create_dispute(
    request: Request,
    project_id: UUID,
    body: DisputeCreate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = DisputeRepository(db)
    audit = AuditService()
    _guard_source_fks(db, body, project_id)

    data = body.model_dump(mode="json", exclude_none=True)
    data["project_id"] = str(project_id)
    data["created_by"] = access["user"]["id"]
    data["dispute_number"] = repo.next_number(str(project_id))

    dispute = repo.create(data)
    chrono_id = _find_source_chronology(db, body)
    if chrono_id:
        dispute = repo.update(dispute["id"], {"chronology_id": chrono_id})

    audit.log(
        action="create",
        entity_type="dispute",
        entity_id=dispute["id"],
        user_id=access["user"]["id"],
        project_id=str(project_id),
        new_value={
            "dispute_number": dispute["dispute_number"],
            "origin": dispute.get("origin"),
            "chronology_id": chrono_id,
        },
    )
    nested = _load_nested(repo, UUID(dispute["id"]), project_id)
    return _enrich_chronology_meta(db, nested)


@router.get("/{dispute_id}")
def get_dispute(
    project_id: UUID,
    dispute_id: UUID,
    access: dict = Depends(verify_project_access),
):
    repo = DisputeRepository(access["db"])
    nested = _load_nested(repo, dispute_id, project_id)
    return _enrich_chronology_meta(access["db"], nested)


@router.patch("/{dispute_id}")
@limiter.limit("10/minute")
def update_dispute(
    request: Request,
    project_id: UUID,
    dispute_id: UUID,
    body: DisputeUpdate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = DisputeRepository(db)
    audit = AuditService()
    old = _load_dispute(repo, dispute_id, project_id)
    _guard_source_fks(db, body, project_id)
    data = body.model_dump(mode="json", exclude_none=True)
    if not data:
        return _enrich_chronology_meta(db, _load_nested(repo, dispute_id, project_id))
    if data.get("chronology_id"):
        chrono = (
            db.table("chronologies")
            .select("id, project_id")
            .eq("id", data["chronology_id"])
            .limit(1)
            .execute()
        )
        found = (chrono.data or [None])[0]
        if not found or found.get("project_id") != str(project_id):
            raise NotFoundError()
    updated = repo.update(str(dispute_id), data)
    audit.log(
        action="update",
        entity_type="dispute",
        entity_id=str(dispute_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        old_value={k: old.get(k) for k in data},
        new_value=data,
    )
    return _enrich_chronology_meta(db, _load_nested(repo, UUID(updated["id"]), project_id))


@router.post("/{dispute_id}/impacts", status_code=201)
@limiter.limit("10/minute")
def add_impact(
    request: Request,
    project_id: UUID,
    dispute_id: UUID,
    body: ImpactCreate,
    access: dict = Depends(require_cm_role),
):
    repo = DisputeRepository(access["db"])
    _load_dispute(repo, dispute_id, project_id)
    data = body.model_dump(mode="json", exclude_none=True)
    data["dispute_id"] = str(dispute_id)
    row = repo.create_impact(data)
    AuditService().log(
        action="update",
        entity_type="dispute",
        entity_id=str(dispute_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        new_value={"impact_id": row["id"], "type": row.get("type")},
        note="impact_add",
    )
    return row


@router.patch("/{dispute_id}/impacts/{impact_id}")
def update_impact(
    project_id: UUID,
    dispute_id: UUID,
    impact_id: UUID,
    body: ImpactUpdate,
    access: dict = Depends(require_cm_role),
):
    repo = DisputeRepository(access["db"])
    _load_dispute(repo, dispute_id, project_id)
    # IDOR: impact must belong to this dispute
    existing = (
        access["db"].table("dispute_impacts")
        .select("id, dispute_id")
        .eq("id", str(impact_id))
        .single()
        .execute()
    )
    if not existing.data or existing.data.get("dispute_id") != str(dispute_id):
        raise NotFoundError()
    data = body.model_dump(mode="json", exclude_none=True)
    return repo.update_impact(str(impact_id), data)


@router.delete("/{dispute_id}/impacts/{impact_id}")
def delete_impact(
    project_id: UUID,
    dispute_id: UUID,
    impact_id: UUID,
    access: dict = Depends(require_cm_role),
):
    repo = DisputeRepository(access["db"])
    _load_dispute(repo, dispute_id, project_id)
    existing = (
        access["db"].table("dispute_impacts")
        .select("id, dispute_id")
        .eq("id", str(impact_id))
        .single()
        .execute()
    )
    if not existing.data or existing.data.get("dispute_id") != str(dispute_id):
        raise NotFoundError()
    repo.delete_impact(str(impact_id))
    return {"ok": True}


@router.post("/{dispute_id}/issues", status_code=201)
@limiter.limit("10/minute")
def add_issue(
    request: Request,
    project_id: UUID,
    dispute_id: UUID,
    body: IssueCreate,
    access: dict = Depends(require_cm_role),
):
    repo = DisputeRepository(access["db"])
    _load_dispute(repo, dispute_id, project_id)
    data = body.model_dump(mode="json", exclude_none=True)
    data["dispute_id"] = str(dispute_id)
    row = repo.create_issue(data)
    AuditService().log(
        action="update",
        entity_type="dispute",
        entity_id=str(dispute_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        new_value={"issue_id": row["id"]},
        note="issue_add",
    )
    return row


@router.patch("/{dispute_id}/issues/{issue_id}")
def update_issue(
    project_id: UUID,
    dispute_id: UUID,
    issue_id: UUID,
    body: IssueUpdate,
    access: dict = Depends(require_cm_role),
):
    repo = DisputeRepository(access["db"])
    _load_dispute(repo, dispute_id, project_id)
    _assert_issue_in_dispute(repo, issue_id, dispute_id)
    data = body.model_dump(mode="json", exclude_none=True)
    return repo.update_issue(str(issue_id), data)


@router.delete("/{dispute_id}/issues/{issue_id}")
def delete_issue(
    project_id: UUID,
    dispute_id: UUID,
    issue_id: UUID,
    access: dict = Depends(require_cm_role),
):
    repo = DisputeRepository(access["db"])
    _load_dispute(repo, dispute_id, project_id)
    _assert_issue_in_dispute(repo, issue_id, dispute_id)
    repo.delete_issue(str(issue_id))
    return {"ok": True}


@router.post("/{dispute_id}/issues/{issue_id}/positions", status_code=201)
@limiter.limit("10/minute")
def add_position(
    request: Request,
    project_id: UUID,
    dispute_id: UUID,
    issue_id: UUID,
    body: PositionCreate,
    access: dict = Depends(require_cm_role),
):
    repo = DisputeRepository(access["db"])
    _load_dispute(repo, dispute_id, project_id)
    _assert_issue_in_dispute(repo, issue_id, dispute_id)
    data = body.model_dump(mode="json", exclude_none=True)
    data["issue_id"] = str(issue_id)
    return repo.create_position(data)


@router.patch("/{dispute_id}/issues/{issue_id}/positions/{position_id}")
def update_position(
    project_id: UUID,
    dispute_id: UUID,
    issue_id: UUID,
    position_id: UUID,
    body: PositionUpdate,
    access: dict = Depends(require_cm_role),
):
    repo = DisputeRepository(access["db"])
    _load_dispute(repo, dispute_id, project_id)
    _assert_issue_in_dispute(repo, issue_id, dispute_id)
    _assert_position_in_issue(repo, position_id, issue_id)
    data = body.model_dump(mode="json", exclude_none=True)
    return repo.update_position(str(position_id), data)


@router.delete(
    "/{dispute_id}/issues/{issue_id}/positions/{position_id}",
)
def delete_position(
    project_id: UUID,
    dispute_id: UUID,
    issue_id: UUID,
    position_id: UUID,
    access: dict = Depends(require_cm_role),
):
    repo = DisputeRepository(access["db"])
    _load_dispute(repo, dispute_id, project_id)
    _assert_issue_in_dispute(repo, issue_id, dispute_id)
    _assert_position_in_issue(repo, position_id, issue_id)
    repo.delete_position(str(position_id))
    return {"ok": True}


@router.post(
    "/{dispute_id}/issues/{issue_id}/positions/{position_id}/refs",
    status_code=201,
)
@limiter.limit("10/minute")
def add_position_ref(
    request: Request,
    project_id: UUID,
    dispute_id: UUID,
    issue_id: UUID,
    position_id: UUID,
    body: PositionRefCreate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = DisputeRepository(db)
    _load_dispute(repo, dispute_id, project_id)
    _assert_issue_in_dispute(repo, issue_id, dispute_id)
    _assert_position_in_issue(repo, position_id, issue_id)

    if body.ref_type in _REF_TABLE and body.entity_id:
        assert_target_in_project(db, _REF_TABLE[body.ref_type], body.entity_id, project_id)
    if body.document_id:
        assert_target_in_project(db, "pdf_document", body.document_id, project_id)

    data = body.model_dump(mode="json", exclude_none=True)
    if "manual_date" in data:
        data["manual_date"] = str(data["manual_date"])
    data["position_id"] = str(position_id)
    return repo.create_ref(data)


@router.delete(
    "/{dispute_id}/issues/{issue_id}/positions/{position_id}/refs/{ref_id}",
)
def delete_position_ref(
    project_id: UUID,
    dispute_id: UUID,
    issue_id: UUID,
    position_id: UUID,
    ref_id: UUID,
    access: dict = Depends(require_cm_role),
):
    repo = DisputeRepository(access["db"])
    _load_dispute(repo, dispute_id, project_id)
    _assert_issue_in_dispute(repo, issue_id, dispute_id)
    _assert_position_in_issue(repo, position_id, issue_id)
    _assert_ref_in_position(repo, ref_id, position_id)
    repo.delete_ref(str(ref_id))
    return {"ok": True}


@router.get("/{dispute_id}/chronology/seed-docs")
def chronology_seed_docs(
    project_id: UUID,
    dispute_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """Linkable RFI/correspondence ids to pre-fill a chronology draft."""
    from backend.services.dossier_context import seed_linkable_ids

    repo = DisputeRepository(access["db"])
    dispute = _load_dispute(repo, dispute_id, project_id)
    ids = seed_linkable_ids(
        access["db"],
        change_id=dispute.get("source_change_id"),
        correspondence_id=dispute.get("source_correspondence_id"),
        dispute_id=str(dispute_id),
    )
    return {"ids": ids}


@router.post("/{dispute_id}/chronology")
@limiter.limit("10/minute")
def create_owned_chronology(
    request: Request,
    project_id: UUID,
    dispute_id: UUID,
    access: dict = Depends(require_cm_role),
):
    """Open a dispute-owned chronology (CM). Used when no source chronology exists."""
    db = access["db"]
    repo = DisputeRepository(db)
    dispute = _load_dispute(repo, dispute_id, project_id)
    existing_id = dispute.get("chronology_id")
    if existing_id:
        existing = (
            db.table("chronologies")
            .select("id, entity_type, entity_id")
            .eq("id", existing_id)
            .limit(1)
            .execute()
        )
        row = (existing.data or [None])[0]
        if row and row.get("entity_type") == "dispute" and row.get("entity_id") == str(dispute_id):
            return _enrich_chronology_meta(db, _load_nested(repo, dispute_id, project_id))
    new_id = _auto_create_chronology(
        db, dispute, str(project_id), str(access["user"]["id"])
    )
    repo.update(str(dispute_id), {"chronology_id": new_id})
    AuditService().log(
        action="create",
        entity_type="chronology",
        entity_id=new_id,
        user_id=access["user"]["id"],
        project_id=str(project_id),
        note="dispute_chrono_create",
    )
    return _enrich_chronology_meta(db, _load_nested(repo, dispute_id, project_id))


@router.post("/{dispute_id}/chronology/fork")
@limiter.limit("10/minute")
def fork_chronology(
    request: Request,
    project_id: UUID,
    dispute_id: UUID,
    access: dict = Depends(require_cm_role),
):
    """Copy a linked (change/correspondence) chronology into a dispute-owned one."""
    db = access["db"]
    repo = DisputeRepository(db)
    dispute = _load_dispute(repo, dispute_id, project_id)
    source_id = dispute.get("chronology_id")
    if not source_id:
        raise NotFoundError()
    source = (
        db.table("chronologies")
        .select("*")
        .eq("id", source_id)
        .limit(1)
        .execute()
    )
    src = (source.data or [None])[0]
    if not src or src.get("project_id") != str(project_id):
        raise NotFoundError()
    if src.get("entity_type") == "dispute" and src.get("entity_id") == str(dispute_id):
        return _enrich_chronology_meta(db, _load_nested(repo, dispute_id, project_id))

    new_id = _auto_create_chronology(
        db, dispute, str(project_id), str(access["user"]["id"])
    )
    events = (
        db.table("chronology_events")
        .select(
            "event_date, event_type, document_ref_id, document_ref_type, "
            "is_key_event, auto_narrative, approved_narrative, activity_id, "
            "boq_ref, subject, is_active"
        )
        .eq("chronology_id", source_id)
        .eq("is_active", True)
        .execute()
    )
    for ev in events.data or []:
        payload = dict(ev)
        payload["chronology_id"] = new_id
        payload["created_by"] = str(access["user"]["id"])
        db.table("chronology_events").insert(payload).execute()

    repo.update(str(dispute_id), {"chronology_id": new_id})
    AuditService().log(
        action="create",
        entity_type="chronology",
        entity_id=new_id,
        user_id=access["user"]["id"],
        project_id=str(project_id),
        note="dispute_chrono_fork",
        new_value={"forked_from": source_id, "dispute_id": str(dispute_id)},
    )
    return _enrich_chronology_meta(db, _load_nested(repo, dispute_id, project_id))


@router.post("/{dispute_id}/issues/{issue_id}/generate-position")
@limiter.limit("10/minute")
def generate_position(
    request: Request,
    project_id: UUID,
    dispute_id: UUID,
    issue_id: UUID,
    body: PositionGenerate,
    access: dict = Depends(require_cm_role),
):
    """HITL claim/response draft. Does not persist until the user adds it."""
    from backend.services.dossier_context import assemble_dossier_context
    from backend.services.claude_service import get_ai_service, GateBlockedResult

    db = access["db"]
    repo = DisputeRepository(db)
    _load_dispute(repo, dispute_id, project_id)
    issue = _assert_issue_in_dispute(repo, issue_id, dispute_id)
    if body.issue_id != issue_id:
        raise NotFoundError()

    ctx = assemble_dossier_context(db, str(project_id), dispute_id=str(dispute_id))
    ai = get_ai_service(db)
    result = ai.generate_dispute_position(
        side=body.side,
        issue_title=issue.get("title") or "",
        change_context=ctx,
        project_id=str(project_id),
        user_id=str(access["user"]["id"]),
    )
    if isinstance(result, GateBlockedResult):
        raise HTTPException(status_code=422, detail=result.warning_message)

    title = issue.get("title") or ""
    summary = result.narrative_text
    raw = (result.narrative_text or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        import json
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            title = str(parsed.get("title") or title)[:200]
            summary = str(parsed.get("summary") or summary)
    except (json.JSONDecodeError, TypeError, ValueError):
        pass
    return {
        "title": title,
        "summary": summary,
        "review_required": result.review_required,
        "warnings": result.warnings,
    }


@router.post("/{dispute_id}/pack")
@limiter.limit("10/minute")
def prepare_pack(
    request: Request,
    project_id: UUID,
    dispute_id: UUID,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = DisputeRepository(db)
    dossier = _load_nested(repo, dispute_id, project_id)

    chronology = None
    chrono_id = dossier.get("chronology_id")
    if chrono_id:
        chrono_repo = ChronologyRepository(db)
        chronology = chrono_repo.get(str(chrono_id))
        if chronology and chronology.get("project_id") == str(project_id):
            chronology["events"] = chrono_repo.get_events(str(chrono_id))
        else:
            chronology = None

    pack = generate_and_store_pack(db, dossier, chronology, str(project_id))
    update = {
        "pack_storage_path": pack["pack_storage_path"],
        "pack_generated_at": pack["pack_generated_at"],
    }
    if dossier.get("status") in ("draft", "open"):
        update["status"] = "prepared"
    repo.update(str(dispute_id), update)
    AuditService().log(
        action="export",
        entity_type="dispute",
        entity_id=str(dispute_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        new_value={
            "pack_storage_path": pack["pack_storage_path"],
            "exhibit_count": pack["exhibit_count"],
        },
        note="dispute_pack",
    )
    return _load_nested(repo, dispute_id, project_id)


@router.get("/{dispute_id}/pack")
def download_pack(
    project_id: UUID,
    dispute_id: UUID,
    access: dict = Depends(verify_project_access),
):
    repo = DisputeRepository(access["db"])
    dispute = _load_dispute(repo, dispute_id, project_id)
    path = dispute.get("pack_storage_path")
    if not path:
        raise NotFoundError()
    payload = download_document(path, str(project_id))
    filename = f"{dispute.get('dispute_number') or 'DSP'}-pack.docx"
    return Response(
        content=payload,
        media_type=(
            "application/vnd.openxmlformats-officedocument"
            ".wordprocessingml.document"
        ),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
