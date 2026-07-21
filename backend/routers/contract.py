from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.core.dependencies import verify_project_access, require_cm_role
from backend.core.exceptions import NotFoundError
from backend.core.guards import assert_target_in_project
from backend.models.contract import (
    ContractCreate,
    ContractDocumentCreate,
    ContractDocumentUpdate,
    ContractUpdate,
)
from backend.models.resolution import (
    ContractDocumentRef,
    ContractPartyRef,
    ContractRoot,
    InForceAmendment,
    ResolutionResponse,
)
from backend.repositories.amendment_repository import AmendmentRepository
from backend.repositories.change_repository import ChangeRepository
from backend.repositories.clause_override_repository import ClauseOverrideRepository
from backend.repositories.contract_repository import ContractRepository
from backend.services.audit_service import AuditService
from backend.services.resolution_service import resolve_in_force

# A dedicated `contract` router (not the amendments router): the amendments
# router prefix is fixed at /projects/{project_id}/amendments and cannot yield
# the /projects/{project_id}/contract/* URLs. This is the "unless a contract
# router already exists" branch of the B3 spec — new code only.
router = APIRouter(prefix="/projects/{project_id}/contract", tags=["contract"])


def _contract_root(row: dict) -> ContractRoot:
    """Map the embedded repository row (contract + contract_parties +
    contract_documents(pdf_document)) to the ContractRoot response shape.
    Documents sort by bespoke precedence (rank 1 first, unranked last)."""
    docs = row.get("contract_documents") or []
    docs.sort(key=lambda d: (d.get("precedence_rank") is None, d.get("precedence_rank") or 0))
    return ContractRoot(
        id=row["id"],
        title=row["title"],
        contract_number=row.get("contract_number"),
        description=row.get("description"),
        contract_type=row.get("contract_type"),
        commencement_date=row.get("commencement_date"),
        duration_days=row.get("duration_days"),
        dlp_days=row.get("dlp_days"),
        parties=[
            ContractPartyRef(role=p["role"], name=p["name"])
            for p in (row.get("contract_parties") or [])
        ],
        documents=[
            ContractDocumentRef(
                id=d["id"],
                pdf_document_id=d["pdf_document_id"],
                label=d.get("label"),
                precedence_rank=d.get("precedence_rank"),
                original_filename=(d.get("pdf_document") or {}).get("original_filename"),
            )
            for d in docs
        ],
    )


@router.get("/resolution", response_model=ResolutionResponse)
def get_contract_resolution(
    project_id: UUID,
    subject_clause_id: Optional[UUID] = Query(None),
    access: dict = Depends(verify_project_access),
):
    """In-force resolution for a project (read-only) — the DOCUMENT hierarchy
    (ADR-014): base contract as root + registered amendments + in-force change
    orders, plus the clause engine's clauses[] (kept in the payload for
    drill-down / future RAG, no longer the dashboard's primary rendering).

    Member-level read gate (verify_project_access), matching the
    *_member_read RLS policies (migrations 037/039): every active member may
    SEE the in-force picture. Four RLS-scoped round-trips feed a pure
    composition — no write, no inference. `subject_clause_id` optionally
    narrows clauses[] to a single targeted clause-node lookup (migration 043).
    """
    db = access["db"]
    overrides = ClauseOverrideRepository(db).list_confirmed_with_amendment(
        str(project_id)
    )
    changes = ChangeRepository(db).list_for_resolution(str(project_id))
    resolved = resolve_in_force(
        overrides, changes, subject_clause_id=subject_clause_id
    )

    contract_row = ContractRepository(db).get_by_project(str(project_id))
    # limit=500 = the amendments router's own Query cap; the hierarchy must not
    # silently truncate at the repository's default 100.
    amendments = AmendmentRepository(db).list_by_project(str(project_id), limit=500)

    return ResolutionResponse(
        contract=_contract_root(contract_row) if contract_row else None,
        amendments=[
            InForceAmendment(
                id=a["id"],
                amendment_number=a["amendment_number"],
                title=a["title"],
                amendment_date=a.get("amendment_date"),
                arrival_path=a["arrival_path"],
                source_pdf_id=a.get("source_pdf_id"),
            )
            for a in amendments
        ],
        clauses=resolved.clauses,
        change_orders=resolved.change_orders,
    )


@router.get("", response_model=Optional[ContractRoot])
def get_contract(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """The project's registered contract (or null if none yet) — the
    project-wide anchor record. Member-level read, like the resolution."""
    db = access["db"]
    row = ContractRepository(db).get_by_project(str(project_id))
    return _contract_root(row) if row else None


@router.post("", response_model=ContractRoot, status_code=201)
def create_contract(
    project_id: UUID,
    body: ContractCreate,
    access: dict = Depends(require_cm_role),
):
    """Register the base contract (HITL project setup).

    Write gate is require_cm_role: registering the base contract is a
    legal-effect decision (Contract Manager authority), the same access model
    as amendments after migration 038. API mirror of contracts_cm_write RLS.
    """
    db = access["db"]
    repo = ContractRepository(db)
    audit = AuditService()

    # Pilot cardinality guard (ADR-014, TB-27): schema allows N contracts per
    # project; the pilot UX is 1:1, enforced HERE (not by a UNIQUE constraint)
    # so multi-contract support later needs no migration.
    if repo.get_by_project(str(project_id)) is not None:
        raise HTTPException(
            409,
            "Bu projede zaten kayıtlı bir sözleşme var (pilot: proje başına tek sözleşme — TB-27)",
        )

    data = body.model_dump(mode="json", exclude_none=True)
    parties = data.pop("parties", [])
    data["project_id"] = str(project_id)
    data["created_by"] = access["user"]["id"]

    # Continuity (TB-28): if the client omits contract_type, inherit the
    # project's existing value so the hierarchy root starts aligned. Written
    # via access["db"] (RLS-scoped), never admin_client.
    if "contract_type" not in data:
        proj = (
            db.table("projects")
            .select("contract_type")
            .eq("id", str(project_id))
            .limit(1)
            .execute()
        )
        proj_row = (proj.data or [None])[0]
        if proj_row and proj_row.get("contract_type"):
            data["contract_type"] = proj_row["contract_type"]

    contract = repo.create(data)
    repo.add_parties(contract["id"], parties)

    # Attach the project's already-filed contract PDFs (entity_type =
    # 'contract_document', migration 007) as the contract's constituent
    # documents — this is what makes the root card click through to the actual
    # contract PDF. Deterministic, CM-triggered (this request), no inference.
    # precedence_rank stays NULL: bespoke precedence is assigned later.
    pdf_res = (
        db.table("pdf_document")
        .select("id, original_filename")
        .eq("project_id", str(project_id))
        .eq("entity_type", "contract_document")
        .execute()
    )
    repo.link_documents(
        contract["id"],
        [
            {"pdf_document_id": d["id"], "label": d["original_filename"]}
            for d in (pdf_res.data or [])
        ],
    )

    audit.log(
        action="create", entity_type="contract", entity_id=contract["id"],
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"title": contract["title"],
                   "contract_number": contract.get("contract_number")},
    )

    # Re-fetch with embeds so the response carries parties + linked documents.
    return _contract_root(repo.get_by_project(str(project_id)))


@router.put("/{contract_id}", response_model=ContractRoot)
def update_contract(
    project_id: UUID,
    contract_id: UUID,
    body: ContractUpdate,
    access: dict = Depends(require_cm_role),
):
    """Update the contract's scalar fields (CM only). Parties are
    registration-time facts in Phase-1 (see ContractUpdate's model comment);
    documents/annexes have their own endpoints below."""
    db = access["db"]
    repo = ContractRepository(db)
    audit = AuditService()

    old = repo.get_or_404(str(contract_id))
    if old["project_id"] != str(project_id):
        raise NotFoundError()

    data = body.model_dump(mode="json", exclude_none=True)
    repo.update(str(contract_id), data)
    audit.log(
        action="update", entity_type="contract", entity_id=str(contract_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={k: old.get(k) for k in data},
        new_value=data,
    )
    return _contract_root(repo.get_by_project(str(project_id)))


def _assert_contract_in_project(repo: ContractRepository, contract_id: UUID, project_id: UUID) -> dict:
    contract = repo.get_or_404(str(contract_id))
    if contract["project_id"] != str(project_id):
        raise NotFoundError()
    return contract


def _assert_contract_pdf(db, pdf_document_id: UUID, project_id: UUID) -> None:
    """IDOR + type guard: the PDF must belong to this project AND be a
    contract_document (not a random correspondence/RFI attachment)."""
    assert_target_in_project(db, "pdf_document", pdf_document_id, project_id)
    row = (
        db.table("pdf_document")
        .select("id, entity_type")
        .eq("id", str(pdf_document_id))
        .limit(1)
        .execute()
    )
    data = (row.data or [None])[0]
    if not data or data.get("entity_type") != "contract_document":
        raise HTTPException(
            400,
            "Yalnızca entity_type=contract_document belgeleri sözleşmeye bağlanabilir",
        )


@router.post("/{contract_id}/documents", response_model=ContractRoot, status_code=201)
def add_contract_document(
    project_id: UUID,
    contract_id: UUID,
    body: ContractDocumentCreate,
    access: dict = Depends(require_cm_role),
):
    """Register a constituent document / annex (ek) on the contract.

    CM-only (require_cm_role + contract_documents_cm_write RLS) — attaching a
    document to the base contract is a legal-effect decision, same gate as
    creating the contract itself. A row may be label-only (file pending,
    migration 040) or carry an already-uploaded contract_document PDF.
    """
    db = access["db"]
    repo = ContractRepository(db)
    audit = AuditService()

    _assert_contract_in_project(repo, contract_id, project_id)

    data = body.model_dump(mode="json", exclude_none=True)
    if body.pdf_document_id is not None:
        _assert_contract_pdf(db, body.pdf_document_id, project_id)

    link = repo.add_document(str(contract_id), data)
    audit.log(
        action="create", entity_type="contract_document_link", entity_id=link["id"],
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"contract_id": str(contract_id), **data},
    )
    return _contract_root(repo.get_by_project(str(project_id)))


@router.put("/{contract_id}/documents/{link_id}", response_model=ContractRoot)
def update_contract_document(
    project_id: UUID,
    contract_id: UUID,
    link_id: UUID,
    body: ContractDocumentUpdate,
    access: dict = Depends(require_cm_role),
):
    """Attach a file later to a label-only annex, or correct label/rank (CM only)."""
    db = access["db"]
    repo = ContractRepository(db)
    audit = AuditService()

    _assert_contract_in_project(repo, contract_id, project_id)
    old = repo.get_document(str(link_id))
    if not old or old["contract_id"] != str(contract_id):
        raise NotFoundError()

    data = body.model_dump(mode="json", exclude_none=True)
    if not data:
        return _contract_root(repo.get_by_project(str(project_id)))
    if body.pdf_document_id is not None:
        _assert_contract_pdf(db, body.pdf_document_id, project_id)

    repo.update_document(str(link_id), data)
    audit.log(
        action="update", entity_type="contract_document_link", entity_id=str(link_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={k: old.get(k) for k in data},
        new_value=data,
    )
    return _contract_root(repo.get_by_project(str(project_id)))


@router.delete("/{contract_id}/documents/{link_id}", response_model=ContractRoot)
def unlink_contract_document(
    project_id: UUID,
    contract_id: UUID,
    link_id: UUID,
    access: dict = Depends(require_cm_role),
):
    """Remove a document/annex from the contract composition (CM only).

    Deletes the contract_documents LINK row only (migration 041). The filed
    PDF stays in pdf_document / storage — forensic archive of the file itself
    is untouched. API mirror of contract_documents_cm_delete RLS.
    """
    db = access["db"]
    repo = ContractRepository(db)
    audit = AuditService()

    _assert_contract_in_project(repo, contract_id, project_id)
    old = repo.get_document(str(link_id))
    if not old or old["contract_id"] != str(contract_id):
        raise NotFoundError()

    repo.unlink_document(str(link_id))
    audit.log(
        action="delete", entity_type="contract_document_link", entity_id=str(link_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={
            "contract_id": old["contract_id"],
            "pdf_document_id": old.get("pdf_document_id"),
            "label": old.get("label"),
        },
    )
    return _contract_root(repo.get_by_project(str(project_id)))
