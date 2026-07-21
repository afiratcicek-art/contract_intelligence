import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from uuid import UUID
from backend.core.dependencies import verify_project_access, require_cm_role
from backend.core.exceptions import NotFoundError, ConflictError
from backend.core.guards import assert_target_in_project
from backend.models.clause_override import OverrideCreate
from backend.repositories.amendment_repository import AmendmentRepository
from backend.repositories.clause_override_repository import ClauseOverrideRepository
from backend.services.audit_service import AuditService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/amendments/{amendment_id}/overrides",
    tags=["overrides"],
)


def _assert_amendment_in_project(db, amendment_id: UUID, project_id: UUID) -> dict:
    """Amendment exists AND belongs to this project, else 404 (info-leak-safe).
    Mirrors the amendment router's inline project check; extracted here because
    all four endpoints share it.
    """
    amendment = AmendmentRepository(db).get(str(amendment_id))
    if not amendment:
        raise NotFoundError()
    if amendment["project_id"] != str(project_id):
        raise NotFoundError()
    return amendment


def _load_override_in_scope(db, override_id: UUID, amendment_id: UUID, project_id: UUID) -> dict:
    """override ∈ amendment ∈ project, else 404. Guards confirm/reject against
    cross-amendment / cross-project id tampering (IDOR)."""
    _assert_amendment_in_project(db, amendment_id, project_id)
    override = ClauseOverrideRepository(db).get(str(override_id))
    if not override:
        raise NotFoundError()
    if (override["project_id"] != str(project_id)
            or override["overriding_amendment_id"] != str(amendment_id)):
        raise NotFoundError()
    return override


@router.post("", status_code=201)
def create_override(
    project_id: UUID,
    amendment_id: UUID,
    body: OverrideCreate,
    access: dict = Depends(require_cm_role),
):
    # CM-only write (require_cm_role + access["db"]) — same access model as the
    # amendment router and the clause_overrides_cm_write RLS policy (migration
    # 038, second line of defense). Deliberately NOT approve_metadata's
    # verify_project_access + admin_client (the trap the 038 header calls out).
    db = access["db"]
    _assert_amendment_in_project(db, amendment_id, project_id)
    audit = AuditService()

    # IDOR: change-order target and subject clause node must belong to this
    # project (migration 043: subject_clause_id is a cross-row FK).
    if body.overridden_change_id:
        assert_target_in_project(db, "changes", body.overridden_change_id, project_id)
    if body.subject_clause_id:
        assert_target_in_project(
            db, "contract_clauses", body.subject_clause_id, project_id
        )

    now = datetime.now(timezone.utc).isoformat()
    data = body.model_dump(mode="json", exclude_none=True)
    data["project_id"] = str(project_id)
    data["overriding_amendment_id"] = str(amendment_id)
    # Server-set provenance. Stage 1 manual override = a user action IS the
    # confirmation (ADR-013 §5), so it goes straight in as confirmed/user. The
    # client cannot supply these fields (OverrideCreate omits them), so
    # proposed_by='haiku' cannot be forged.
    data["status"] = "confirmed"
    data["proposed_by"] = "user"
    data["confirmed_by"] = access["user"]["id"]
    data["confirmed_at"] = now

    override = ClauseOverrideRepository(db).create(data)
    audit.log(
        action="create", entity_type="clause_override", entity_id=override["id"],
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"overriding_amendment_id": str(amendment_id),
                   "scope": override["scope"],
                   "status": override["status"]},
    )
    return override


@router.get("")
def list_overrides(
    project_id: UUID,
    amendment_id: UUID,
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    access: dict = Depends(verify_project_access),
):
    """List overrides for an amendment.

    Member-level read gate (verify_project_access), consistent with the
    clause_overrides_member_read RLS policy (migration 037): every active member
    may SEE the override picture; only a CM may write it.
    """
    db = access["db"]
    _assert_amendment_in_project(db, amendment_id, project_id)
    return ClauseOverrideRepository(db).list_by_amendment(
        str(project_id), str(amendment_id), limit=limit, offset=offset,
    )


@router.post("/{override_id}/confirm", status_code=200)
def confirm_override(
    project_id: UUID,
    amendment_id: UUID,
    override_id: UUID,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    override = _load_override_in_scope(db, override_id, amendment_id, project_id)
    audit = AuditService()

    # Only a 'proposed' row can be confirmed. Stage 1 manual rows are already
    # 'confirmed'; this path exists so Stage 2 Haiku proposals confirm with zero
    # new wiring when TB-5 lands. Anything not 'proposed' is a 409 (no silent
    # re-confirm), mirroring assert_document_not_already_linked's 409 idiom.
    if override["status"] != "proposed":
        raise ConflictError(detail="Yalnızca 'proposed' override onaylanabilir.")

    now = datetime.now(timezone.utc).isoformat()
    data = {
        "status": "confirmed",
        "confirmed_by": access["user"]["id"],
        "confirmed_at": now,
    }
    ClauseOverrideRepository(db).update(str(override_id), data)
    audit.log(
        action="update", entity_type="clause_override", entity_id=str(override_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={"status": override["status"]},
        new_value={"status": "confirmed"},
    )
    return {"override_id": str(override_id), "status": "confirmed", "message": "Override onaylandı."}


@router.post("/{override_id}/reject", status_code=200)
def reject_override(
    project_id: UUID,
    amendment_id: UUID,
    override_id: UUID,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    override = _load_override_in_scope(db, override_id, amendment_id, project_id)
    audit = AuditService()

    # Reject is the REMOVAL path (there is no soft-delete on this table — 037).
    # A 'proposed' or a 'confirmed' row can be rejected; an already-'rejected'
    # row is a 409. confirmed_by records WHO rejected (the audit actor).
    if override["status"] not in ("proposed", "confirmed"):
        raise ConflictError(detail="Override zaten 'rejected'.")

    now = datetime.now(timezone.utc).isoformat()
    data = {
        "status": "rejected",
        "confirmed_by": access["user"]["id"],
        "confirmed_at": now,
    }
    ClauseOverrideRepository(db).update(str(override_id), data)
    audit.log(
        action="update", entity_type="clause_override", entity_id=str(override_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={"status": override["status"]},
        new_value={"status": "rejected"},
    )
    return {"override_id": str(override_id), "status": "rejected", "message": "Override reddedildi."}
