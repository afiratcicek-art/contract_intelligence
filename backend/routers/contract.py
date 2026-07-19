from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from backend.core.dependencies import verify_project_access
from backend.models.resolution import ResolutionResponse
from backend.repositories.change_repository import ChangeRepository
from backend.repositories.clause_override_repository import ClauseOverrideRepository
from backend.services.resolution_service import resolve_in_force

# A dedicated `contract` router (not the amendments router): the amendments
# router prefix is fixed at /projects/{project_id}/amendments and cannot yield
# the /projects/{project_id}/contract/resolution URL. This is the "unless a
# contract router already exists" branch of the B3 spec — new code only.
router = APIRouter(prefix="/projects/{project_id}/contract", tags=["contract"])


@router.get("/resolution", response_model=ResolutionResponse)
def get_contract_resolution(
    project_id: UUID,
    subject_key: Optional[str] = Query(None),
    access: dict = Depends(verify_project_access),
):
    """In-force resolution for a project's contract + amendments (read-only).

    Member-level read gate (verify_project_access), matching the
    *_member_read RLS policies on amendments/clause_overrides (migration 037):
    every active member may SEE the in-force picture. Exactly two RLS-scoped
    round-trips feed the pure resolver — no write, no inference. `subject_key`
    optionally narrows clauses[] to a single targeted clause lookup.
    """
    db = access["db"]
    overrides = ClauseOverrideRepository(db).list_confirmed_with_amendment(
        str(project_id)
    )
    changes = ChangeRepository(db).list_for_resolution(str(project_id))
    return resolve_in_force(overrides, changes, subject_key=subject_key)
