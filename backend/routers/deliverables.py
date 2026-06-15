from fastapi import APIRouter, Depends, Query
from typing import Optional
from uuid import UUID
from backend.core.dependencies import verify_project_access, require_permission
from backend.core.exceptions import NotFoundError
from backend.models.deliverable import DeliverableCreate, DeliverableUpdate
from backend.repositories.deliverable_repository import DeliverableRepository
from backend.services.deliverable_service import DeliverableService
from backend.services.audit_service import AuditService

router = APIRouter(prefix="/projects/{project_id}/deliverables", tags=["deliverables"])


@router.get("")
def list_deliverables(
    project_id: UUID,
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    is_pre_completion: Optional[bool] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    repo = DeliverableRepository(db)
    return repo.list_by_project(
        str(project_id),
        status=status,
        category=category,
        is_pre_completion=is_pre_completion,
        limit=limit,
        offset=offset,
    )


@router.get("/pre-completion-checklist")
def pre_completion_checklist(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    service = DeliverableService(db)
    return service.get_pre_completion_checklist(str(project_id))


@router.post("", status_code=201)
def create_deliverable(
    project_id: UUID,
    body: DeliverableCreate,
    access: dict = Depends(require_permission("deliverable", "create")),
):
    db = access["db"]
    repo = DeliverableRepository(db)
    audit = AuditService()

    data = body.model_dump(mode="json", exclude_none=True)
    data["project_id"] = str(project_id)
    data["created_by"] = access["user"]["id"]
    if "due_date" in data:
        data["due_date"] = str(data["due_date"])

    deliverable = repo.create(data)
    audit.log(
        action="create", entity_type="deliverable", entity_id=deliverable["id"],
        user_id=access["user"]["id"], project_id=str(project_id),
    )
    return deliverable


@router.get("/{deliverable_id}")
def get_deliverable(
    project_id: UUID,
    deliverable_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    repo = DeliverableRepository(db)
    d = repo.get_or_404(str(deliverable_id))
    if d["project_id"] != str(project_id):
        raise NotFoundError()
    d["documents"] = repo.get_documents(str(deliverable_id))
    return d


@router.put("/{deliverable_id}")
def update_deliverable(
    project_id: UUID,
    deliverable_id: UUID,
    body: DeliverableUpdate,
    access: dict = Depends(require_permission("deliverable", "edit")),
):
    db = access["db"]
    repo = DeliverableRepository(db)
    audit = AuditService()

    old = repo.get_or_404(str(deliverable_id))
    if old["project_id"] != str(project_id):
        raise NotFoundError()
    data = body.model_dump(mode="json", exclude_none=True)
    if "due_date" in data:
        data["due_date"] = str(data["due_date"])

    updated = repo.update(str(deliverable_id), data)
    audit.log(
        action="update", entity_type="deliverable", entity_id=str(deliverable_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={k: old.get(k) for k in data},
        new_value=data,
    )
    return updated


@router.post("/{deliverable_id}/cm-approve")
def cm_approve(
    project_id: UUID,
    deliverable_id: UUID,
    access: dict = Depends(require_permission("deliverable", "approve")),
):
    db = access["db"]
    repo = DeliverableRepository(db)
    d = repo.get_or_404(str(deliverable_id))
    if d["project_id"] != str(project_id):
        raise NotFoundError()
    audit = AuditService()
    service = DeliverableService(db, audit_service=audit)
    return service.cm_approve(
        deliverable_id=str(deliverable_id),
        cm_user_id=access["user"]["id"],
        project_id=str(project_id),
    )
