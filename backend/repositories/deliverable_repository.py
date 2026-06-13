from typing import Optional
from backend.repositories.base import BaseRepository


class DeliverableRepository(BaseRepository):
    table_name = "deliverables"

    def list_by_project(
        self,
        project_id: str,
        status: Optional[str] = None,
        category: Optional[str] = None,
        is_pre_completion: Optional[bool] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        query = (
            self.db.table("deliverables")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
        )
        if status:
            query = query.eq("status", status)
        if category:
            query = query.eq("category", category)
        if is_pre_completion is not None:
            query = query.eq("is_pre_completion", is_pre_completion)
        result = query.order("due_date").limit(limit).offset(offset).execute()
        return result.data or []

    def get_documents(self, deliverable_id: str) -> list[dict]:
        result = (
            self.db.table("deliverable_documents")
            .select("*")
            .eq("deliverable_id", deliverable_id)
            .order("uploaded_at", desc=True)
            .execute()
        )
        return result.data or []
