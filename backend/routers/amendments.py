import logging

from fastapi import APIRouter, Depends, Query
from typing import Optional
from uuid import UUID
from backend.core.dependencies import verify_project_access, require_cm_role
from backend.core.exceptions import NotFoundError
from backend.core.guards import assert_target_in_project
from backend.models.amendment import AmendmentCreate, AmendmentUpdate
from backend.repositories.amendment_repository import AmendmentRepository
from backend.services.audit_service import AuditService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/amendments", tags=["amendments"])


@router.get("")
def list_amendments(
    project_id: UUID,
    arrival_path: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    access: dict = Depends(verify_project_access),
):
    """List amendments for a project.

    Member-level read gate (verify_project_access), consistent with the
    amendments_member_read RLS policy (migration 037): every active member may
    SEE the contract-amendment picture; only a CM may write it. An amendment has
    no lifecycle status, so there is no status filter — only the optional
    arrival_path filter (contrast list_correspondences' status/direction/type).
    """
    db = access["db"]
    repo = AmendmentRepository(db)
    return repo.list_by_project(
        str(project_id),
        arrival_path=arrival_path,
        limit=limit,
        offset=offset,
    )


@router.post("", status_code=201)
def create_amendment(
    project_id: UUID,
    body: AmendmentCreate,
    access: dict = Depends(require_cm_role),
):
    # Write gate is require_cm_role, NOT require_permission("...", "create"):
    # registering an employer amendment is Contract Manager authority, not an
    # engineer's/dcc's (product ruling, migration 038 header). This is the API
    # mirror of the amendments_cm_write RLS policy (second line of defense).
    db = access["db"]
    repo = AmendmentRepository(db)
    audit = AuditService()

    data = body.model_dump(mode="json", exclude_none=True)
    data["project_id"] = str(project_id)
    data["created_by"] = access["user"]["id"]
    if "amendment_date" in data:
        data["amendment_date"] = str(data["amendment_date"])

    # IDOR guard (assert_target_in_project): a source PDF / change belonging to
    # another project must not be linkable. Mirrors create_correspondence's
    # reference guards — RLS with_check validates only the OWNER, not the target
    # (guards.py). No nested references / keywords here (amendment has neither),
    # so create_correspondence's reference-loop and _upsert_keyword_stats are
    # deliberately NOT mirrored.
    if body.source_pdf_id:
        assert_target_in_project(db, "pdf_document", body.source_pdf_id, project_id)
    if body.source_change_id:
        assert_target_in_project(db, "changes", body.source_change_id, project_id)

    amendment = repo.create(data)
    audit.log(
        action="create", entity_type="amendment", entity_id=amendment["id"],
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"amendment_number": amendment["amendment_number"],
                   "arrival_path": amendment["arrival_path"]},
    )
    return amendment


@router.get("/{amendment_id}")
def get_amendment(
    project_id: UUID,
    amendment_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    repo = AmendmentRepository(db)
    amendment = repo.get(str(amendment_id))
    if not amendment:
        raise NotFoundError()
    if amendment["project_id"] != str(project_id):
        raise NotFoundError()
    return amendment


@router.put("/{amendment_id}")
def update_amendment(
    project_id: UUID,
    amendment_id: UUID,
    body: AmendmentUpdate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = AmendmentRepository(db)
    audit = AuditService()

    old = repo.get_or_404(str(amendment_id))
    if old["project_id"] != str(project_id):
        raise NotFoundError()
    data = body.model_dump(mode="json", exclude_none=True)
    if "amendment_date" in data:
        data["amendment_date"] = str(data["amendment_date"])

    # Same IDOR guard as create — a re-pointed provenance FK must stay in-project.
    if body.source_pdf_id:
        assert_target_in_project(db, "pdf_document", body.source_pdf_id, project_id)
    if body.source_change_id:
        assert_target_in_project(db, "changes", body.source_change_id, project_id)

    updated = repo.update(str(amendment_id), data)
    audit.log(
        action="update", entity_type="amendment", entity_id=str(amendment_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={k: old.get(k) for k in data},
        new_value=data,
    )
    return updated


@router.delete("/{amendment_id}", status_code=204)
def delete_amendment(
    project_id: UUID,
    amendment_id: UUID,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = AmendmentRepository(db)
    audit = AuditService()
    amendment = repo.get_or_404(str(amendment_id))
    if amendment["project_id"] != str(project_id):
        raise NotFoundError()
    # Soft-delete (is_deleted=true), mirroring delete_rfi. EK-15: amendments has
    # NO deleted_by column (migration 037), so soft_delete is called WITHOUT
    # deleted_by (contrast delete_rfi) — the forensic actor is captured by the
    # audit_log row below (action="update", the same convention delete_rfi uses).
    repo.soft_delete(str(amendment_id))
    audit.log(
        action="update", entity_type="amendment", entity_id=str(amendment_id),
        user_id=access["user"]["id"], project_id=str(project_id),
    )
