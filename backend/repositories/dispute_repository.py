import re
from typing import Optional
from backend.models.dispute import NESTED_SELECT
from backend.repositories.base import BaseRepository

_DSP_RE = re.compile(r"^DSP-(\d+)$", re.IGNORECASE)


class DisputeRepository(BaseRepository):
    table_name = "disputes"
    soft_delete_field = None  # Forensic — satır silinmez; status=closed

    def list_by_project(
        self,
        project_id: str,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        query = (
            self.db.table("disputes")
            .select("*")
            .eq("project_id", project_id)
        )
        if status:
            query = query.eq("status", status)
        result = (
            query.order("created_at", desc=True)
            .limit(limit)
            .offset(offset)
            .execute()
        )
        return result.data or []

    def get_nested(self, dispute_id: str) -> Optional[dict]:
        result = (
            self.db.table("disputes")
            .select(NESTED_SELECT)
            .eq("id", dispute_id)
            .single()
            .execute()
        )
        return result.data if result.data else None

    def next_number(self, project_id: str) -> str:
        result = (
            self.db.table("disputes")
            .select("dispute_number")
            .eq("project_id", project_id)
            .execute()
        )
        max_n = 0
        for row in result.data or []:
            match = _DSP_RE.match((row.get("dispute_number") or "").strip())
            if match:
                max_n = max(max_n, int(match.group(1)))
        return f"DSP-{max_n + 1:03d}"

    def create_impact(self, data: dict) -> dict:
        result = self.db.table("dispute_impacts").insert(data).execute()
        return result.data[0]

    def update_impact(self, impact_id: str, data: dict) -> dict:
        result = (
            self.db.table("dispute_impacts")
            .update(data)
            .eq("id", impact_id)
            .execute()
        )
        if not result.data:
            from backend.core.exceptions import NotFoundError
            raise NotFoundError()
        return result.data[0]

    def delete_impact(self, impact_id: str) -> None:
        self.db.table("dispute_impacts").delete().eq("id", impact_id).execute()

    def create_issue(self, data: dict) -> dict:
        result = self.db.table("dispute_issues").insert(data).execute()
        return result.data[0]

    def update_issue(self, issue_id: str, data: dict) -> dict:
        result = (
            self.db.table("dispute_issues")
            .update(data)
            .eq("id", issue_id)
            .execute()
        )
        if not result.data:
            from backend.core.exceptions import NotFoundError
            raise NotFoundError()
        return result.data[0]

    def delete_issue(self, issue_id: str) -> None:
        self.db.table("dispute_issues").delete().eq("id", issue_id).execute()

    def get_issue(self, issue_id: str) -> Optional[dict]:
        result = (
            self.db.table("dispute_issues")
            .select("*")
            .eq("id", issue_id)
            .single()
            .execute()
        )
        return result.data if result.data else None

    def create_position(self, data: dict) -> dict:
        result = self.db.table("dispute_positions").insert(data).execute()
        return result.data[0]

    def update_position(self, position_id: str, data: dict) -> dict:
        result = (
            self.db.table("dispute_positions")
            .update(data)
            .eq("id", position_id)
            .execute()
        )
        if not result.data:
            from backend.core.exceptions import NotFoundError
            raise NotFoundError()
        return result.data[0]

    def delete_position(self, position_id: str) -> None:
        self.db.table("dispute_positions").delete().eq("id", position_id).execute()

    def get_position(self, position_id: str) -> Optional[dict]:
        result = (
            self.db.table("dispute_positions")
            .select("*")
            .eq("id", position_id)
            .single()
            .execute()
        )
        return result.data if result.data else None

    def create_ref(self, data: dict) -> dict:
        result = self.db.table("dispute_position_refs").insert(data).execute()
        return result.data[0]

    def delete_ref(self, ref_id: str) -> None:
        self.db.table("dispute_position_refs").delete().eq("id", ref_id).execute()

    def get_ref(self, ref_id: str) -> Optional[dict]:
        result = (
            self.db.table("dispute_position_refs")
            .select("*")
            .eq("id", ref_id)
            .single()
            .execute()
        )
        return result.data if result.data else None
