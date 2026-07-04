from fastapi import APIRouter, Depends
from uuid import UUID
from backend.database import get_authed_db, get_admin_client
from backend.core.security import get_current_user
from backend.core.dependencies import verify_project_access, require_cm_role, invalidate_access_cache
from backend.core.cache import cache_get, cache_set, cache_delete, cache_delete_prefix
from backend.models.project import (
    ProjectCreate, ProjectUpdate,
    ProjectMemberAdd, ProjectMemberUpdate,
    ProjectPartyCreate,
)
from backend.repositories.project_repository import ProjectRepository
from backend.services.audit_service import AuditService

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
def list_projects(
    current_user: dict = Depends(get_current_user),
):
    cache_key = f"projects:list:{current_user['tenant_id']}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    db = get_authed_db(current_user["_meta"]["token"])
    repo = ProjectRepository(db)
    result = repo.list_by_tenant(current_user["tenant_id"])
    cache_set(cache_key, result, ttl=60)
    return result


@router.post("", status_code=201)
def create_project(
    body: ProjectCreate,
    current_user: dict = Depends(get_current_user),
):
    db = get_authed_db(current_user["_meta"]["token"])
    repo = ProjectRepository(db)
    audit = AuditService()

    data = body.model_dump(mode="json", exclude_none=True)
    data["tenant_id"] = current_user["tenant_id"]
    data["created_by"] = current_user["id"]

    project = repo.create(data)

    # Proje oluşturanı CM olarak ekle.
    # RLS: kullanıcı henüz bu projenin üyesi değil — tavuk-yumurta problemi.
    # İlk üyelik kaydı sistem kararı olduğundan admin client kullanılır.
    get_admin_client().table("project_members").insert({
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
    cache_delete_prefix(f"projects:list:{current_user['tenant_id']}")
    return project


@router.get("/{project_id}")
def get_project(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    cache_key = f"projects:detail:{str(project_id)}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    db = access["db"]
    repo = ProjectRepository(db)
    result = repo.get_with_config(str(project_id))
    cache_set(cache_key, result, ttl=30)
    return result


@router.put("/{project_id}")
def update_project(
    project_id: UUID,
    body: ProjectUpdate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = ProjectRepository(db)
    audit = AuditService()

    old = repo.get_or_404(str(project_id))
    data = body.model_dump(mode="json", exclude_none=True)
    updated = repo.update(str(project_id), data)

    audit.log(
        action="update", entity_type="project", entity_id=str(project_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        old_value={k: old.get(k) for k in data},
        new_value=data,
    )
    cache_delete_prefix(f"projects:list:{access['user']['tenant_id']}")
    cache_delete(f"projects:detail:{str(project_id)}")
    cache_delete(f"projects:health:{str(project_id)}")
    cache_delete(f"projects:activity:{str(project_id)}")
    cache_delete_prefix(f"projects:deadlines:{str(project_id)}")
    cache_delete(f"projects:overdue:{str(project_id)}")
    return updated


# ── Members ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/members")
def list_members(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
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
):
    db = access["db"]
    data = body.model_dump(mode="json")
    data["project_id"] = str(project_id)
    result = db.table("project_members").insert(data).execute()
    audit = AuditService()
    audit.log(
        action="create", entity_type="project_member",
        entity_id=result.data[0].get("id", str(project_id)),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"user_id": data.get("user_id"), "project_role": data.get("project_role")},
    )
    invalidate_access_cache(data.get("user_id", ""), str(project_id))
    return result.data[0]


@router.put("/{project_id}/members/{user_id}")
def update_member(
    project_id: UUID,
    user_id: UUID,
    body: ProjectMemberUpdate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    data = body.model_dump(mode="json", exclude_none=True)
    result = (
        db.table("project_members")
        .update(data)
        .eq("project_id", str(project_id))
        .eq("user_id", str(user_id))
        .execute()
    )
    audit = AuditService()
    audit.log(
        action="update", entity_type="project_member",
        entity_id=str(user_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value=data,
    )
    invalidate_access_cache(str(user_id), str(project_id))
    if "project_role" in data:
        cache_delete_prefix(f"perm:{str(project_id)}:")
    return result.data[0] if result.data else {}


# ── Parties ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/parties")
def list_parties(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
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
):
    db = access["db"]
    data = body.model_dump(mode="json")
    data["project_id"] = str(project_id)
    data["added_by"] = access["user"]["id"]
    result = db.table("project_parties").insert(data).execute()
    audit = AuditService()
    audit.log(
        action="create", entity_type="project_party",
        entity_id=result.data[0].get("id", str(project_id)),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"party_type": data.get("party_type"), "party_name": data.get("party_name")},
    )
    return result.data[0]
