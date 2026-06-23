from typing import Optional
from backend.repositories.base import BaseRepository


class NoticeConfigRepository(BaseRepository):
    table_name = "project_notice_config"
    soft_delete_field = None  # soft delete yok — is_active kullanılıyor

    def list_by_project(self, project_id: str) -> list[dict]:
        result = (
            self.db.table("project_notice_config")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_active", True)
            .order("event_type")
            .execute()
        )
        return result.data or []

    def get_by_event_type(
        self, project_id: str, event_type: str
    ) -> Optional[dict]:
        result = (
            self.db.table("project_notice_config")
            .select("*")
            .eq("project_id", project_id)
            .eq("event_type", event_type)
            .eq("is_active", True)
            .single()
            .execute()
        )
        return result.data if result.data else None

    def upsert(self, project_id: str, data: dict) -> dict:
        """
        event_type bazında upsert — aynı proje + event_type
        varsa günceller, yoksa ekler.
        """
        existing = self.get_by_event_type(
            project_id, data["event_type"]
        )
        if existing:
            result = (
                self.db.table("project_notice_config")
                .update(data)
                .eq("id", existing["id"])
                .execute()
            )
        else:
            data["project_id"] = project_id
            result = (
                self.db.table("project_notice_config")
                .insert(data)
                .execute()
            )
        return result.data[0]
