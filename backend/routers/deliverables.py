from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from backend.core.dependencies import verify_project_access, require_permission
from backend.core.exceptions import NotFoundError, RaceConditionError, ValidationError
from backend.models.deliverable import (
    DeliverableCreate,
    DeliverableUpdate,
    SubItemCreate,
    SubItemUpdate,
    SuggestionAccept,
)
from backend.repositories.deliverable_repository import DeliverableRepository
from backend.services.audit_service import AuditService
from backend.services.deliverable_service import DeliverableService

router = APIRouter(prefix="/projects/{project_id}/deliverables", tags=["deliverables"])


def _date_fields_to_str(data: dict) -> dict:
    for key in ("due_date", "expiry_date"):
        if key in data and data[key] is not None:
            data[key] = str(data[key])
    return data


@router.get("")
def list_deliverables(
    project_id: UUID,
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    contract_id: Optional[UUID] = Query(None),
    kind: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    repo = DeliverableRepository(db)
    svc = DeliverableService(db)
    rows = repo.list_by_project(
        str(project_id),
        status=status,
        category=category,
        contract_id=str(contract_id) if contract_id else None,
        kind=kind,
        limit=limit,
        offset=offset,
    )
    return [svc.enrich(r) for r in rows]


@router.get("/suggestions")
def list_suggestions(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """Multi-suggest surface — library seed + blind-spot nudges (HITL).

    contract_scan_available=false until LLM scan is wired through C1a mask.
    """
    db = access["db"]
    repo = DeliverableRepository(db)
    svc = DeliverableService(db)
    existing = repo.list_by_project(str(project_id), limit=500)
    titles = [r.get("title") or "" for r in existing]
    return svc.build_suggestions(str(project_id), titles)


@router.post("/suggestions/accept", status_code=201)
def accept_suggestions(
    project_id: UUID,
    body: SuggestionAccept,
    access: dict = Depends(require_permission("deliverable", "create")),
):
    """Instantiate selected library keys as deliverables (bulk HITL accept)."""
    db = access["db"]
    repo = DeliverableRepository(db)
    svc = DeliverableService(db)
    audit = AuditService()

    contract = repo.assert_contract_in_project(str(body.contract_id), str(project_id))
    parties = contract.get("contract_parties") or []
    contractor_name = svc.get_project_contractor_name(str(project_id))

    # Skip keys already present (title match) — idempotent accept.
    existing = repo.list_by_project(str(project_id), limit=500)
    existing_titles = { (r.get("title") or "").strip().lower() for r in existing }
    from backend.data.deliverable_library import library_for_country
    country = svc.resolve_country_code(str(project_id))
    by_key = {i["key"]: i for i in library_for_country(country)}
    keys = [
        k for k in body.keys
        if k in by_key and by_key[k]["title"].strip().lower() not in existing_titles
    ]

    created = svc.instantiate_from_library(
        project_id=str(project_id),
        contract_id=str(body.contract_id),
        keys=keys,
        user_id=access["user"]["id"],
        parties=parties,
        contractor_name=contractor_name,
    )
    for row in created:
        audit.log(
            action="create",
            entity_type="deliverable",
            entity_id=row["id"],
            user_id=access["user"]["id"],
            project_id=str(project_id),
            new_value={"entry_source": "library"},
        )
    return {"created": created, "count": len(created)}


@router.post("", status_code=201)
def create_deliverable(
    project_id: UUID,
    body: DeliverableCreate,
    access: dict = Depends(require_permission("deliverable", "create")),
):
    db = access["db"]
    repo = DeliverableRepository(db)
    svc = DeliverableService(db)
    audit = AuditService()

    contract = repo.assert_contract_in_project(str(body.contract_id), str(project_id))
    parties = contract.get("contract_parties") or []
    contractor_name = svc.get_project_contractor_name(str(project_id))
    direction, override = svc.resolve_direction(
        project_contractor_name=contractor_name,
        parties=parties,
        requested=body.direction,
        override=body.direction_override,
    )

    data = body.model_dump(mode="json", exclude_none=True)
    data.pop("direction", None)
    data.pop("direction_override", None)
    data["direction"] = direction
    data["direction_override"] = override
    data["project_id"] = str(project_id)
    data["contract_id"] = str(body.contract_id)
    data["created_by"] = access["user"]["id"]
    _date_fields_to_str(data)

    deliverable = repo.create(data)
    audit.log(
        action="create",
        entity_type="deliverable",
        entity_id=deliverable["id"],
        user_id=access["user"]["id"],
        project_id=str(project_id),
    )
    return svc.enrich(deliverable)


@router.get("/{deliverable_id}")
def get_deliverable(
    project_id: UUID,
    deliverable_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    repo = DeliverableRepository(db)
    svc = DeliverableService(db)
    d = repo.get_with_contract(str(deliverable_id))
    if not d or d["project_id"] != str(project_id):
        raise NotFoundError()
    d["documents"] = repo.get_documents(str(deliverable_id))
    d["sub_items"] = repo.list_sub_items(str(deliverable_id))
    return svc.enrich(d)


@router.put("/{deliverable_id}")
def update_deliverable(
    project_id: UUID,
    deliverable_id: UUID,
    body: DeliverableUpdate,
    access: dict = Depends(require_permission("deliverable", "edit")),
):
    db = access["db"]
    repo = DeliverableRepository(db)
    svc = DeliverableService(db)
    audit = AuditService()

    old = repo.get_or_404(str(deliverable_id))
    if old["project_id"] != str(project_id):
        raise NotFoundError()

    data = body.model_dump(mode="json", exclude_none=True)
    expected_version = data.pop("version", None)
    if expected_version is None:
        raise ValidationError("version is required")

    # Direction override: if client toggles override off, re-derive from contract.
    if "direction_override" in data or "direction" in data:
        contract = repo.assert_contract_in_project(old["contract_id"], str(project_id))
        parties = contract.get("contract_parties") or []
        contractor_name = svc.get_project_contractor_name(str(project_id))
        override = data.get("direction_override", old.get("direction_override", False))
        requested = data.get("direction", old.get("direction"))
        direction, override = svc.resolve_direction(
            project_contractor_name=contractor_name,
            parties=parties,
            requested=requested,
            override=bool(override),
        )
        data["direction"] = direction
        data["direction_override"] = override

    _date_fields_to_str(data)
    updated = repo.update_with_version_check(str(deliverable_id), data, expected_version)
    if not updated:
        raise RaceConditionError()

    audit.log(
        action="update",
        entity_type="deliverable",
        entity_id=str(deliverable_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        old_value={k: old.get(k) for k in data if k != "version"},
        new_value={k: v for k, v in data.items() if k != "version"},
    )
    return svc.enrich(updated)


@router.delete("/{deliverable_id}")
def delete_deliverable(
    project_id: UUID,
    deliverable_id: UUID,
    access: dict = Depends(require_permission("deliverable", "edit")),
):
    """Soft-delete (is_deleted) — forensic archive; no hard delete."""
    db = access["db"]
    repo = DeliverableRepository(db)
    audit = AuditService()

    old = repo.get_or_404(str(deliverable_id))
    if old["project_id"] != str(project_id):
        raise NotFoundError()

    # is_deleted only — no deleted_by column on deliverables (052).
    # Audit action="update" matches delete_rfi / delete_amendment (046 CHECK).
    repo.soft_delete(str(deliverable_id))
    audit.log(
        action="update",
        entity_type="deliverable",
        entity_id=str(deliverable_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        old_value={"title": old.get("title"), "is_deleted": False},
        new_value={"is_deleted": True},
    )
    return {"ok": True}


@router.post("/{deliverable_id}/sub-items", status_code=201)
def create_sub_item(
    project_id: UUID,
    deliverable_id: UUID,
    body: SubItemCreate,
    access: dict = Depends(require_permission("deliverable", "edit")),
):
    db = access["db"]
    repo = DeliverableRepository(db)
    audit = AuditService()

    parent = repo.get_or_404(str(deliverable_id))
    if parent["project_id"] != str(project_id):
        raise NotFoundError()

    data = body.model_dump(mode="json", exclude_none=True)
    if "due_date" in data and data["due_date"] is not None:
        data["due_date"] = str(data["due_date"])
    data["deliverable_id"] = str(deliverable_id)
    item = repo.create_sub_item(data)
    audit.log(
        action="create",
        entity_type="deliverable_sub_item",
        entity_id=item["id"],
        user_id=access["user"]["id"],
        project_id=str(project_id),
        new_value={"deliverable_id": str(deliverable_id)},
    )
    return item


@router.put("/{deliverable_id}/sub-items/{sub_item_id}")
def update_sub_item(
    project_id: UUID,
    deliverable_id: UUID,
    sub_item_id: UUID,
    body: SubItemUpdate,
    access: dict = Depends(require_permission("deliverable", "edit")),
):
    db = access["db"]
    repo = DeliverableRepository(db)

    parent = repo.get_or_404(str(deliverable_id))
    if parent["project_id"] != str(project_id):
        raise NotFoundError()
    existing = repo.get_sub_item(str(sub_item_id))
    if not existing or existing["deliverable_id"] != str(deliverable_id):
        raise NotFoundError()

    data = body.model_dump(mode="json", exclude_none=True)
    if "due_date" in data and data["due_date"] is not None:
        data["due_date"] = str(data["due_date"])
    updated = repo.update_sub_item(str(sub_item_id), data)
    if not updated:
        raise NotFoundError()
    return updated


@router.delete("/{deliverable_id}/sub-items/{sub_item_id}")
def delete_sub_item(
    project_id: UUID,
    deliverable_id: UUID,
    sub_item_id: UUID,
    access: dict = Depends(require_permission("deliverable", "edit")),
):
    db = access["db"]
    repo = DeliverableRepository(db)

    parent = repo.get_or_404(str(deliverable_id))
    if parent["project_id"] != str(project_id):
        raise NotFoundError()
    existing = repo.get_sub_item(str(sub_item_id))
    if not existing or existing["deliverable_id"] != str(deliverable_id):
        raise NotFoundError()
    repo.delete_sub_item(str(sub_item_id))
    return {"ok": True}
