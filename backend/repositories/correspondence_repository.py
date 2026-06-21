from typing import Optional
from backend.repositories.base import BaseRepository


class CorrespondenceRepository(BaseRepository):
    table_name = "correspondences"

    def list_by_project(
        self,
        project_id: str,
        direction: Optional[str] = None,
        corr_type: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        query = (
            self.db.table("correspondences")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
        )
        if direction:
            query = query.eq("direction", direction)
        if corr_type:
            query = query.eq("type", corr_type)
        if status:
            query = query.eq("status", status)
        result = query.order("correspondence_date", desc=True).limit(limit).offset(offset).execute()
        return result.data or []

    def get_with_breadcrumb(self, corr_id: str) -> Optional[dict]:
        """Correspondence + tüm parent zincirini döndürür."""
        corr = self.get(corr_id)
        if not corr:
            return None

        breadcrumb = []
        current = corr
        depth = 0
        while current.get("parent_id") and depth < 10:
            parent = self.get(current["parent_id"])
            if not parent:
                break
            breadcrumb.append({
                "id": parent["id"],
                "corr_number": parent["corr_number"],
                "type": parent["type"],
                "subject": parent["subject"],
                "direction": parent["direction"],
            })
            current = parent
            depth += 1

        corr["breadcrumb"] = list(reversed(breadcrumb))
        return corr

    def get_children(self, corr_id: str, project_id: str) -> list[dict]:
        """Bu correspondence'a yanıt olarak yazılmış belgeler."""
        result = (
            self.db.table("correspondences")
            .select("id, corr_number, subject, type, direction, status, correspondence_date, has_response")
            .eq("parent_id", corr_id)
            .eq("project_id", project_id)
            .eq("is_deleted", False)
            .order("correspondence_date", desc=False)
            .execute()
        )
        return result.data or []

    def update_parent_response_status(
        self, parent_id: str, response_corr_id: str
    ) -> None:
        """
        Bir yanıt yazışması oluşturulduğunda parent'ı günceller.
        has_response = True, response_corr_id = yeni yanıtın ID'si.
        status = "responded" — otomatik.
        Forensic: sadece has_response False iken günceller.
        """
        self.db.table("correspondences").update({
            "has_response": True,
            "response_corr_id": response_corr_id,
            "status": "responded",
        }).eq("id", parent_id).eq("has_response", False).execute()

    def get_references(self, corr_id: str) -> list[dict]:
        result = (
            self.db.table("correspondence_references")
            .select("*")
            .eq("correspondence_id", corr_id)
            .execute()
        )
        return result.data or []

    def get_drafts(self, corr_id: str) -> list[dict]:
        result = (
            self.db.table("correspondence_drafts")
            .select("*")
            .eq("correspondence_id", corr_id)
            .order("saved_at", desc=True)
            .execute()
        )
        return result.data or []

    def get_documents(self, corr_id: str) -> list[dict]:
        result = (
            self.db.table("correspondence_documents")
            .select("*")
            .eq("correspondence_id", corr_id)
            .execute()
        )
        return result.data or []

    def get_pending_deadlines(self, project_id: str, days: int = 7) -> list[dict]:
        from datetime import date, timedelta
        today = date.today()
        cutoff = today + timedelta(days=days)

        result = (
            self.db.table("correspondences")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
            .in_("status", ["draft", "under_review", "approved", "published"])
            .lte("response_due_date", str(cutoff))
            .order("response_due_date")
            .execute()
        )
        return result.data or []

    def update_with_version_check(
        self, corr_id: str, data: dict, expected_version: int
    ) -> Optional[dict]:
        """Optimistic locking ile güncelleme — race condition koruması."""
        data["version"] = expected_version + 1
        result = (
            self.db.table("correspondences")
            .update(data)
            .eq("id", corr_id)
            .eq("version", expected_version)
            .execute()
        )
        return result.data[0] if result.data else None
