from typing import Optional
from backend.repositories.base import BaseRepository


class ProjectRepository(BaseRepository):
    table_name = "projects"

    def list_by_tenant(self, tenant_id: str) -> list[dict]:
        result = (
            self.db.table("projects")
            .select("*")
            .eq("tenant_id", tenant_id)
            .eq("is_deleted", False)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []

    def get_with_config(self, project_id: str) -> Optional[dict]:
        project = self.get(project_id)
        if not project:
            return None

        config_result = (
            self.db.table("project_config")
            .select("*")
            .eq("project_id", project_id)
            .single()
            .execute()
        )
        project["config"] = config_result.data

        calendar_result = (
            self.db.table("calendar_config")
            .select("*")
            .eq("project_id", project_id)
            .execute()
        )
        project["calendar_configs"] = calendar_result.data or []

        return project
