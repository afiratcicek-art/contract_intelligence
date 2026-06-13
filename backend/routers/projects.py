from fastapi import APIRouter, Depends
from uuid import UUID
from backend.database import get_db
from backend.core.security import get_current_user
from backend.core.dependencies import verify_project_access, require_cm_role
from backend.core.exceptions import NotFoundError
from backend.models.project import (
    ProjectCreate, ProjectUpdate, ProjectResponse,
    ProjectMemberAdd, ProjectMemberUpdate, ProjectMemberResponse,
    ProjectPartyCreate, ProjectPartyResponse,
)
from backend.repositories.project_repository import ProjectRepository
from backend.services.audit_service import AuditService

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
def list_projects(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    repo = ProjectRepository(db)
    return repo.list_by_tenant(current_user["tenant_id"])


@router.post("", status_code=201)
def create_project(
    body: ProjectCreate,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    repo = ProjectRepository(db)
    audit = AuditService(db)

    data = body.model_dump(exclude_none=True)
    data["tenant_id"] = current_user["tenant_id"]
    data["created_by"] = current_user["id"]

    project = repo.create(data)

    # Oluşturanı CM olarak ekle
    db.table("project_members").insert({
        "project_id": project["id"],
        "user_id": current_user["id"],
        "project_role": "cm",
        "can_approve": True,
        "can_publish": True,
    }).execute()

    audit.log(
        action="create", entity_type="project", entity_id=project["id"],
        user_id=current_user["id"], project_id=project["id"],
    )
    return project


@router.get("/{project_id}")
def get_project(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
    db=Depends(get_db),
):
    repo = ProjectRepository(db)
    return repo.get_with_config(str(project_id))


@router.put("/{project_id}")
def update_project(
    project_id: UUID,
    body: ProjectUpdate,
    access: dict = Depends(require_cm_role),
    db=Depends(get_db),
):
    repo = ProjectRepository(db)
    audit = AuditService(db)

    old = repo.get_or_404(str(project_id))
    data = body.model_dump(exclude_none=True)
    updated = repo.update(str(project_id), data)

    audit.log(
        action="update", entity_type="project", entity_id=str(project_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={k: old.get(k) for k in data},
        new_value=data,
    )
    return updated


# ── Members ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/members")
def list_members(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
    db=Depends(get_db),
):
    result = (
        db.table("project_members")
        .select("*, profiles(full_name, email)")
        .eq("project_id", str(project_id))
        .eq("is_active", True)
        .execute()
    )
    return result.data or []


@router.post("/{project_id}/members", status_code=201)
def add_member(
    project_id: UUID,
    body: ProjectMemberAdd,
    access: dict = Depends(require_cm_role),
    db=Depends(get_db),
):
    data = body.model_dump()
    data["project_id"] = str(project_id)
    result = db.table("project_members").insert(data).execute()
    audit = AuditService(db)
    audit.log(
        action="create", entity_type="project_member",
        entity_id=result.data[0].get("id", str(project_id)),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"user_id": data.get("user_id"), "project_role": data.get("project_role")},
    )
    return result.data[0]


@router.put("/{project_id}/members/{user_id}")
def update_member(
    project_id: UUID,
    user_id: UUID,
    body: ProjectMemberUpdate,
    access: dict = Depends(require_cm_role),
    db=Depends(get_db),
):
    data = body.model_dump(exclude_none=True)
    result = (
        db.table("project_members")
        .update(data)
        .eq("project_id", str(project_id))
        .eq("user_id", str(user_id))
        .execute()
    )
    audit = AuditService(db)
    audit.log(
        action="update", entity_type="project_member",
        entity_id=str(user_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value=data,
    )
    return result.data[0] if result.data else {}


# ── Parties ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/parties")
def list_parties(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
    db=Depends(get_db),
):
    result = (
        db.table("project_parties")
        .select("*")
        .eq("project_id", str(project_id))
        .eq("is_active", True)
        .execute()
    )
    return result.data or []


@router.post("/{project_id}/parties", status_code=201)
def add_party(
    project_id: UUID,
    body: ProjectPartyCreate,
    access: dict = Depends(require_cm_role),
    db=Depends(get_db),
):
    data = body.model_dump()
    data["project_id"] = str(project_id)
    data["added_by"] = access["user"]["id"]
    result = db.table("project_parties").insert(data).execute()
    audit = AuditService(db)
    audit.log(
        action="create", entity_type="project_party",
        entity_id=result.data[0].get("id", str(project_id)),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"party_type": data.get("party_type"), "party_name": data.get("party_name")},
    )
    return result.data[0]
