import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from uuid import UUID

from backend.core.dependencies import verify_project_access, require_cm_role
from backend.core.exceptions import NotFoundError, ConflictError
from backend.models.clause_incorporation import IncorporationCreate
from backend.repositories.clause_incorporation_repository import (
    ClauseIncorporationRepository,
)
from backend.repositories.contract_clause_repository import ContractClauseRepository
from backend.services.audit_service import AuditService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/incorporations",
    tags=["incorporations"],
)


def _assert_contract_document_in_project(
    db, document_id: UUID, project_id: UUID
) -> dict:
    """contract_documents row exists AND its parent contract belongs to this
    project, else 404 (info-leak-safe). FOOTGUN 2: contract_documents has no
    project_id column — hop via contract_id → contracts.project_id.
    Mirrors _assert_contract_pdf's IDOR style (contract.py).
    """
    doc_res = (
        db.table("contract_documents")
        .select("id, contract_id")
        .eq("id", str(document_id))
        .limit(1)
        .execute()
    )
    doc = (doc_res.data or [None])[0]
    if not doc:
        raise NotFoundError()

    contract_res = (
        db.table("contracts")
        .select("id, project_id")
        .eq("id", doc["contract_id"])
        .limit(1)
        .execute()
    )
    contract = (contract_res.data or [None])[0]
    if not contract or contract.get("project_id") != str(project_id):
        raise NotFoundError()
    return doc


def _load_incorporation_in_scope(
    db, incorporation_id: UUID, project_id: UUID
) -> dict:
    """incorporation ∈ project, else 404. Guards confirm/reject against
    cross-project id tampering (IDOR) — overrides.py _load_override_in_scope
    mirror (without the amendment nesting, incorporations are project-scoped).
    """
    row = ClauseIncorporationRepository(db).get(str(incorporation_id))
    if not row:
        raise NotFoundError()
    if row["project_id"] != str(project_id):
        raise NotFoundError()
    return row


@router.post("", status_code=201)
def create_incorporation(
    project_id: UUID,
    body: IncorporationCreate,
    access: dict = Depends(require_cm_role),
):
    # CM-only write (require_cm_role + access["db"]) — same access model as
    # overrides.py / clause_incorporations_cm_write RLS (043). Deliberately NOT
    # approve_metadata's verify_project_access + service-role bypass trap.
    db = access["db"]
    audit = AuditService()

    _assert_contract_document_in_project(db, body.source_document_id, project_id)
    _assert_contract_document_in_project(db, body.target_document_id, project_id)

    clause_repo = ContractClauseRepository(db)
    source = clause_repo.find_or_create(
        str(project_id),
        contract_document_id=str(body.source_document_id),
        clause_ref=body.source_clause_ref,
        created_by=access["user"]["id"],
    )
    target = clause_repo.find_or_create(
        str(project_id),
        contract_document_id=str(body.target_document_id),
        clause_ref=body.target_clause_ref,
        created_by=access["user"]["id"],
    )

    now = datetime.now(timezone.utc).isoformat()
    data = {
        "project_id": str(project_id),
        "source_clause_id": source["id"],
        "target_clause_id": target["id"],
        # Server-set provenance. Stage 1 manual = user action IS confirmation
        # (ADR-013 §5 mirror). Client cannot supply these (IncorporationCreate
        # omits them), so proposed_by='haiku' cannot be forged.
        "status": "confirmed",
        "proposed_by": "user",
        "confirmed_by": access["user"]["id"],
        "confirmed_at": now,
    }

    incorporation = ClauseIncorporationRepository(db).create(data)
    audit.log(
        action="create",
        entity_type="clause_incorporation",
        entity_id=incorporation["id"],
        user_id=access["user"]["id"],
        project_id=str(project_id),
        new_value={
            "source_clause_id": source["id"],
            "target_clause_id": target["id"],
            "status": incorporation["status"],
        },
    )
    return incorporation


@router.get("")
def list_incorporations(
    project_id: UUID,
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    access: dict = Depends(verify_project_access),
):
    """List incorporations for a project.

    Member-level read gate (verify_project_access), consistent with
    clause_incorporations_member_read RLS (043): every active member may SEE
    the incorporation picture; only a CM may write it.
    """
    db = access["db"]
    return ClauseIncorporationRepository(db).list_by_project(
        str(project_id), limit=limit, offset=offset,
    )


@router.post("/{incorporation_id}/confirm", status_code=200)
def confirm_incorporation(
    project_id: UUID,
    incorporation_id: UUID,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    incorporation = _load_incorporation_in_scope(db, incorporation_id, project_id)
    audit = AuditService()

    # Only a 'proposed' row can be confirmed. Stage 1 manual rows are already
    # 'confirmed'; this path exists so Stage 2 Haiku proposals confirm with zero
    # new wiring when TB-5 lands (overrides.py confirm_override mirror).
    if incorporation["status"] != "proposed":
        raise ConflictError(detail="Yalnızca 'proposed' incorporation onaylanabilir.")

    now = datetime.now(timezone.utc).isoformat()
    data = {
        "status": "confirmed",
        "confirmed_by": access["user"]["id"],
        "confirmed_at": now,
    }
    ClauseIncorporationRepository(db).update(str(incorporation_id), data)
    audit.log(
        action="update",
        entity_type="clause_incorporation",
        entity_id=str(incorporation_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        old_value={"status": incorporation["status"]},
        new_value={"status": "confirmed"},
    )
    return {
        "incorporation_id": str(incorporation_id),
        "status": "confirmed",
        "message": "Incorporation onaylandı.",
    }


@router.post("/{incorporation_id}/reject", status_code=200)
def reject_incorporation(
    project_id: UUID,
    incorporation_id: UUID,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    incorporation = _load_incorporation_in_scope(db, incorporation_id, project_id)
    audit = AuditService()

    # Reject is the REMOVAL path (no soft-delete on this table — 043).
    # A 'proposed' or a 'confirmed' row can be rejected; already-'rejected' → 409.
    if incorporation["status"] not in ("proposed", "confirmed"):
        raise ConflictError(detail="Incorporation zaten 'rejected'.")

    now = datetime.now(timezone.utc).isoformat()
    data = {
        "status": "rejected",
        "confirmed_by": access["user"]["id"],
        "confirmed_at": now,
    }
    ClauseIncorporationRepository(db).update(str(incorporation_id), data)
    audit.log(
        action="update",
        entity_type="clause_incorporation",
        entity_id=str(incorporation_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        old_value={"status": incorporation["status"]},
        new_value={"status": "rejected"},
    )
    return {
        "incorporation_id": str(incorporation_id),
        "status": "rejected",
        "message": "Incorporation reddedildi.",
    }
