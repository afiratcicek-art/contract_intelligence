from typing import Optional
from backend.repositories.base import BaseRepository


class ChronologyRepository(BaseRepository):
    table_name = "chronologies"
    soft_delete_field = None  # Forensic — silinmez, is_active kullanılır

    def get_by_entity(self, entity_type: str, entity_id: str) -> Optional[dict]:
        result = (
            self.db.table("chronologies")
            .select("*")
            .eq("entity_type", entity_type)
            .eq("entity_id", entity_id)
            .single()
            .execute()
        )
        return result.data

    def get_events(
        self,
        chronology_id: str,
        include_inactive: bool = False,
    ) -> list[dict]:
        query = (
            self.db.table("chronology_events")
            .select("*")
            .eq("chronology_id", chronology_id)
        )
        if not include_inactive:
            query = query.eq("is_active", True)
        result = query.order("event_date").execute()
        return result.data or []

    def list_by_project(self, project_id: str) -> list[dict]:
        """Simple chronology list — no events included.
        Use list_chronologies endpoint for event counts.
        """
        result = (
            self.db.table("chronologies")
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []
