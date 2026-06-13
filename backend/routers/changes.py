from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
from uuid import UUID
from backend.database import get_db
from backend.core.dependencies import verify_project_access, require_permission
from backend.core.exceptions import RaceConditionError, NotFoundError
from backend.models.change import ChangeCreate, ChangeUpdate, ChangeReferenceAdd, ChangeLinkCreate
from backend.repositories.change_repository import ChangeRepository
from backend.services.audit_service import AuditService
from backend.services.chronology_service import ChronologyService
from backend.utils.sanitizer import mask_sensitive_fields

router = APIRouter(prefix="/projects/{project_id}/changes", tags=["changes"])


def _mask_change(change: dict, access: dict) -> dict:
    return mask_sensitive_fields(change, access["member"]["project_role"])


def _mask_changes(changes: list, access: dict) -> list:
    role = access["member"]["project_role"]
    return [mask_sensitive_fields(c, role) for c in changes]


@router.get("")
def list_changes(
    project_id: UUID,
    status: Optional[str] = Query(None),
    origin: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    access: dict = Depends(verify_project_access),
    db=Depends(get_db),
):
    repo = ChangeRepository(db)
    changes = repo.list_by_project(
        str(project_id),
        status=status,
        origin=origin,
        limit=limit,
        offset=offset,
    )
    return _mask_changes(changes, access)


@router.post("", status_code=201)
def create_change(
    project_id: UUID,
    body: ChangeCreate,
    access: dict = Depends(require_permission("change", "create")),
    db=Depends(get_db),
):
    repo = ChangeRepository(db)
    audit = AuditService(db)
    chrono = ChronologyService(db, audit_service=audit)

    data = body.model_dump(exclude_none=True)
    data["project_id"] = str(project_id)
    data["created_by"] = access["user"]["id"]
    for field in ("notice_due_date", "impact_due_date"):
        if field in data:
            data[field] = str(data[field])

    change = repo.create(data)

    chrono.auto_create_for_change(
        change_id=change["id"],
        change_title=change["title"],
        project_id=str(project_id),
        created_by=access["user"]["id"],
    )

    audit.log(
        action="create", entity_type="change", entity_id=change["id"],
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"title": change["title"], "origin": change["origin"]},
    )
    return _mask_change(change, access)


@router.get("/{change_id}")
def get_change(
    project_id: UUID,
    change_id: UUID,
    access: dict = Depends(verify_project_access),
    db=Depends(get_db),
):
    repo = ChangeRepository(db)
    change = repo.get_or_404(str(change_id))
    if change["project_id"] != str(project_id):
        raise NotFoundError()
    change["linked_correspondences"] = repo.get_linked_correspondences(str(change_id))
    change["references"] = repo.get_references(str(change_id))
    return _mask_change(change, access)


@router.put("/{change_id}")
def update_change(
    project_id: UUID,
    change_id: UUID,
    body: ChangeUpdate,
    access: dict = Depends(require_permission("change", "edit")),
    db=Depends(get_db),
):
    repo = ChangeRepository(db)
    audit = AuditService(db)

    old = repo.get_or_404(str(change_id))
    if old["project_id"] != str(project_id):
        raise NotFoundError()
    data = body.model_dump(exclude_none=True)

    for field in ("notice_sent_date", "notice_due_date", "impact_due_date",
                  "impact_submitted_date", "cost_claimed_date", "cost_agreed_date",
                  "time_impact_claimed_date", "time_impact_agreed_date"):
        if field in data:
            data[field] = str(data[field])

    expected_version = data.pop("version", old["version"])
    updated = repo.update_with_version_check(str(change_id), data, expected_version)
    if not updated:
        raise RaceConditionError()

    audit.log(
        action="update", entity_type="change", entity_id=str(change_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={k: old.get(k) for k in data},
        new_value=data,
    )
    return _mask_change(updated, access)


# ── Correspondence link ────────────────────────────────────────────────────

@router.post("/{change_id}/link-correspondence", status_code=201)
def link_correspondence(
    project_id: UUID,
    change_id: UUID,
    body: ChangeLinkCreate,
    access: dict = Depends(require_permission("change", "edit")),
    db=Depends(get_db),
):
    repo = ChangeRepository(db)
    audit = AuditService(db)
    change = repo.get_or_404(str(change_id))
    if change["project_id"] != str(project_id):
        raise NotFoundError()

    existing = (
        db.table("correspondence_change_links")
        .select("id")
        .eq("change_id", str(change_id))
        .execute()
    )
    if existing.data:
        existing_ids = [r["id"] for r in existing.data]
        return {
            "warning": f"Bu change zaten {len(existing_ids)} correspondence'a bağlı. Devam mı?",
            "existing_links": existing_ids,
        }

    link = repo.link_correspondence(
        change_id=str(change_id),
        correspondence_id=str(body.correspondence_id),
        linked_by=access["user"]["id"],
        note=body.note,
    )
    audit.log(
        action="update", entity_type="change", entity_id=str(change_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        note=f"Linked to correspondence {body.correspondence_id}",
    )
    return link


# ── Change References ──────────────────────────────────────────────────────

@router.post("/{change_id}/references", status_code=201)
def add_reference(
    project_id: UUID,
    change_id: UUID,
    body: ChangeReferenceAdd,
    access: dict = Depends(require_permission("change", "edit")),
    db=Depends(get_db),
):
    repo = ChangeRepository(db)
    change = repo.get_or_404(str(change_id))
    if change["project_id"] != str(project_id):
        raise NotFoundError()
    data = body.model_dump(exclude_none=True)
    data["change_id"] = str(change_id)
    data["added_by"] = access["user"]["id"]
    if "ref_date" in data:
        data["ref_date"] = str(data["ref_date"])
    result = db.table("change_references").insert(data).execute()
    audit = AuditService(db)
    audit.log(
        action="create", entity_type="change_reference",
        entity_id=result.data[0].get("id", str(change_id)),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"change_id": str(change_id)},
    )
    return result.data[0]
