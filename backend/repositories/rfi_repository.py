from typing import Optional
from backend.repositories.base import BaseRepository


class RFIRepository(BaseRepository):
    table_name = "rfis"

    def list_by_project(
        self,
        project_id: str,
        status: Optional[str] = None,
        discipline: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        query = (
            self.db.table("rfis")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
        )
        if status:
            query = query.eq("status", status)
        if discipline:
            query = query.eq("discipline", discipline)
        result = query.order("submitted_date", desc=True).limit(limit).offset(offset).execute()
        return result.data or []

    def get_pending_deadlines(self, project_id: str, days: int = 7) -> list[dict]:
        """Önümüzdeki N günde deadline'ı olan açık RFI'lar."""
        from datetime import date, timedelta
        today = date.today()
        cutoff = today + timedelta(days=days)

        result = (
            self.db.table("rfis")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
            .in_("status", ["open", "overdue"])
            .lte("response_due_date", str(cutoff))
            .order("response_due_date")
            .execute()
        )
        return result.data or []

    def get_linked_correspondences(self, rfi_id: str) -> list[dict]:
        """Bu RFI'ya referans veren correspondence'ları getirir."""
        result = (
            self.db.table("correspondence_references")
            .select("correspondence_id, correspondences(id, corr_number, type, subject, correspondence_date, status)")
            .eq("rfi_id", rfi_id)
            .eq("ref_type", "rfi")
            .execute()
        )
        return result.data or []
