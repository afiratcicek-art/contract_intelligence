from typing import Optional
from backend.repositories.base import BaseRepository


class ChangeRepository(BaseRepository):
    table_name = "changes"

    def list_by_project(
        self,
        project_id: str,
        status: Optional[str] = None,
        origin: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        query = (
            self.db.table("changes")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
        )
        if status:
            query = query.eq("status", status)
        if origin:
            query = query.eq("origin", origin)
        result = query.order("created_at", desc=True).limit(limit).offset(offset).execute()
        return result.data or []

    def list_for_resolution(self, project_id: str) -> list[dict]:
        # B3 resolution fetch (I/O only). ONE round-trip. Dedicated method (not
        # list_by_project) because the in-force graph must see ALL matching change
        # orders (no limit=100 truncation). Selects only the resolver's columns;
        # status is returned RAW (never relabeled here — ADR-013 §6 is a UI concern).
        # in-force = agreed|closed (Ali's ruling); identified/draft live in the Working sub-tab.
        result = (
            self.db.table("changes")
            .select("id, change_number, title, status")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
            .in_("status", ["agreed", "closed"])
            .execute()
        )
        return result.data or []

    def get_linked_correspondences(self, change_id: str) -> list[dict]:
        result = (
            self.db.table("correspondence_change_links")
            .select("*, correspondences(id, corr_number, type, subject, correspondence_date, status, direction)")
            .eq("change_id", change_id)
            .execute()
        )
        return result.data or []

    def get_references(self, change_id: str) -> list[dict]:
        result = (
            self.db.table("change_references")
            .select("*")
            .eq("change_id", change_id)
            .execute()
        )
        return result.data or []

    def link_correspondence(
        self,
        change_id: str,
        correspondence_id: str,
        linked_by: str,
        note: Optional[str] = None,
    ) -> dict:
        result = self.db.table("correspondence_change_links").insert({
            "change_id": change_id,
            "correspondence_id": correspondence_id,
            "linked_by": linked_by,
            "note": note,
        }).execute()
        return result.data[0]

    def update_with_version_check(
        self, change_id: str, data: dict, expected_version: int
    ) -> Optional[dict]:
        data["version"] = expected_version + 1
        result = (
            self.db.table("changes")
            .update(data)
            .eq("id", change_id)
            .eq("version", expected_version)
            .execute()
        )
        return result.data[0] if result.data else None
