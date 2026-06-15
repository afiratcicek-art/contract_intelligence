from fastapi import HTTPException
import logging

logger = logging.getLogger(__name__)

VALID_PERMISSIONS = {"view", "create", "edit", "approve", "close", "publish", "inactivate"}
VALID_ENTITIES = {"rfi", "correspondence", "change", "chronology", "deliverable", "contract_document"}


class PermissionService:
    """Proje bazlı rol ve entity izin kontrolü."""

    def __init__(self, db):
        self.db = db

    def check(
        self,
        user_id: str,
        project_id: str,
        entity_type: str,
        permission: str,
    ) -> bool:
        """Kullanıcının belirtilen işlem için yetkisi var mı? Sync."""
        member = (
            self.db.table("project_members")
            .select("project_role")
            .eq("project_id", project_id)
            .eq("user_id", user_id)
            .eq("is_active", True)
            .single()
            .execute()
        )

        if not member.data:
            return False

        role = member.data["project_role"]

        perm_row = (
            self.db.table("project_role_permissions")
            .select("is_allowed")
            .eq("project_id", project_id)
            .eq("project_role", role)
            .eq("entity_type", entity_type)
            .eq("permission", permission)
            .single()
            .execute()
        )

        if not perm_row.data:
            # Kayıt yoksa varsayılan: cm tüm yetkiye sahip, viewer hiçbir şeye
            return role == "cm"

        return perm_row.data.get("is_allowed", False)

    def require(
        self,
        user_id: str,
        project_id: str,
        entity_type: str,
        permission: str,
    ) -> None:
        """check() False dönerse 404 fırlatır (bilgi sızdırmama)."""
        if not self.check(user_id, project_id, entity_type, permission):
            raise HTTPException(404, "Kaynak bulunamadı")
