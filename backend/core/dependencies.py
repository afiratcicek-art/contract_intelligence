from uuid import UUID
from concurrent.futures import ThreadPoolExecutor
from fastapi import Depends
from backend.database import get_authed_db
from backend.core.security import get_current_user
from backend.core.exceptions import NotFoundError, ForbiddenError
from backend.core.cache import cache_get, cache_set

_PERM_CACHE_TTL = 300  # 5 minutes

def _perm_cache_key(project_id: str, role: str, entity: str, permission: str) -> str:
    return f"perm:{project_id}:{role}:{entity}:{permission}"

def verify_project_access(
    project_id: UUID,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Proje erişim kontrolü: tenant izolasyonu + üyelik.
    projects ve project_members sorguları paralel çalışır.
    """
    db = get_authed_db(current_user["_meta"]["token"])
    project_id_str = str(project_id)

    def fetch_project():
        try:
            return db.table("projects") \
                .select("id, tenant_id") \
                .eq("id", project_id_str) \
                .eq("is_deleted", False) \
                .single() \
                .execute()
        except Exception:
            return None

    def fetch_member():
        try:
            return db.table("project_members") \
                .select("*") \
                .eq("project_id", project_id_str) \
                .eq("user_id", current_user["id"]) \
                .eq("is_active", True) \
                .single() \
                .execute()
        except Exception:
            return None

    # Paralel sorgular — ~120ms kazanım
    with ThreadPoolExecutor(max_workers=2) as executor:
        f_project = executor.submit(fetch_project)
        f_member = executor.submit(fetch_member)
        project_resp = f_project.result()
        member_resp = f_member.result()

    if not project_resp or not project_resp.data:
        raise NotFoundError()
    if project_resp.data["tenant_id"] != current_user["tenant_id"]:
        raise NotFoundError()
    if not member_resp or not member_resp.data:
        raise NotFoundError()

    return {
        "user": current_user,
        "member": member_resp.data,
        "project_id": project_id_str,
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
    """project_role_permissions tablosuna göre ince taneli yetki kontrolü.
    Rol bilgisi verify_project_access'ten gelir — duplicate sorgu yok.
    İzin sonucu 5 dakika cache'lenir.
    """
    def _dependency(
        access: dict = Depends(verify_project_access),
    ) -> dict:
        db = access["db"]
        role = access["member"]["project_role"]
        project_id = access["project_id"]

        # Cache kontrolü
        cache_key = _perm_cache_key(project_id, role, entity_type, permission)
        cached = cache_get(cache_key)
        if cached is not None:
            if not cached:
                raise NotFoundError()
            return access

        # DB sorgusu — project_members duplicate sorgu yok
        perm_result = (
            db.table("project_role_permissions")
            .select("is_allowed")
            .eq("project_id", project_id)
            .eq("project_role", role)
            .eq("entity_type", entity_type)
            .eq("permission", permission)
            .limit(1)
            .execute()
        )

        if not perm_result.data:
            is_allowed = (role == "cm")
        else:
            is_allowed = perm_result.data[0].get("is_allowed", False)

        # Cache'e yaz
        cache_set(cache_key, is_allowed, _PERM_CACHE_TTL)

        if not is_allowed:
            from backend.core.exceptions import NotFoundError
            raise NotFoundError()

        return access
    return _dependency
