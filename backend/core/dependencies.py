from uuid import UUID
from fastapi import Depends
from backend.database import get_authed_db
from backend.core.security import get_current_user
from backend.core.exceptions import NotFoundError, ForbiddenError
from backend.services.permission_service import PermissionService


def verify_project_access(
    project_id: UUID,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Proje erişim kontrolü: tenant izolasyonu + üyelik. Sync.

    Döndürür: {"user": ..., "member": ..., "project_id": str, "db": ...}
    """
    db = get_authed_db(current_user["_meta"]["token"])

    project = (
        db.table("projects")
        .select("id, tenant_id")
        .eq("id", str(project_id))
        .eq("is_deleted", False)
        .single()
        .execute()
    )

    if not project.data:
        raise NotFoundError()

    if project.data["tenant_id"] != current_user["tenant_id"]:
        raise NotFoundError()

    member = (
        db.table("project_members")
        .select("*")
        .eq("project_id", str(project_id))
        .eq("user_id", current_user["id"])
        .eq("is_active", True)
        .single()
        .execute()
    )

    if not member.data:
        raise NotFoundError()

    return {
        "user": current_user,
        "member": member.data,
        "project_id": str(project_id),
        "db": db,
    }


def require_cm_role(access: dict = Depends(verify_project_access)) -> dict:
    """Sadece 'cm' rolüne izin verir."""
    if access["member"]["project_role"] != "cm":
        raise ForbiddenError()
    return access


def require_not_viewer(access: dict = Depends(verify_project_access)) -> dict:
    """'viewer' rolünü engeller, diğerlerine izin verir."""
    if access["member"]["project_role"] == "viewer":
        raise ForbiddenError()
    return access


def require_permission(entity_type: str, permission: str):
    """project_role_permissions tablosuna göre ince taneli yetki kontrolü."""
    def _dependency(
        access: dict = Depends(verify_project_access),
    ) -> dict:
        db = access["db"]
        PermissionService(db).require(
            access["user"]["id"],
            access["project_id"],
            entity_type,
            permission,
        )
        return access
    return _dependency
