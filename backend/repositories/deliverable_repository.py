from typing import Optional
from backend.repositories.base import BaseRepository


class DeliverableRepository(BaseRepository):
    table_name = "deliverables"

    def list_by_project(
        self,
        project_id: str,
        status: Optional[str] = None,
        category: Optional[str] = None,
        contract_id: Optional[str] = None,
        kind: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        # Single round-trip: embed contract title for list chrome (no N+1).
        query = (
            self.db.table("deliverables")
            .select("*, contracts(id, title)")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
        )
        if status:
            query = query.eq("status", status)
        if category:
            query = query.eq("category", category)
        if contract_id:
            query = query.eq("contract_id", contract_id)
        if kind:
            query = query.eq("kind", kind)
        result = query.order("due_date").limit(limit).offset(offset).execute()
        return result.data or []

    def get_with_contract(self, deliverable_id: str) -> Optional[dict]:
        result = (
            self.db.table("deliverables")
            .select(
                "*, contracts(id, title, contract_parties(role, name))"
            )
            .eq("id", deliverable_id)
            .eq("is_deleted", False)
            .maybe_single()
            .execute()
        )
        return result.data if result.data else None

    def get_documents(self, deliverable_id: str) -> list[dict]:
        result = (
            self.db.table("deliverable_documents")
            .select("*")
            .eq("deliverable_id", deliverable_id)
            .order("uploaded_at", desc=True)
            .execute()
        )
        return result.data or []

    def list_sub_items(self, deliverable_id: str) -> list[dict]:
        result = (
            self.db.table("deliverable_sub_items")
            .select("*")
            .eq("deliverable_id", deliverable_id)
            .order("sort_order")
            .order("created_at")
            .execute()
        )
        return result.data or []

    def create_sub_item(self, data: dict) -> dict:
        result = self.db.table("deliverable_sub_items").insert(data).execute()
        return result.data[0]

    def get_sub_item(self, sub_item_id: str) -> Optional[dict]:
        result = (
            self.db.table("deliverable_sub_items")
            .select("*")
            .eq("id", sub_item_id)
            .maybe_single()
            .execute()
        )
        return result.data if result.data else None

    def update_sub_item(self, sub_item_id: str, data: dict) -> dict:
        result = (
            self.db.table("deliverable_sub_items")
            .update(data)
            .eq("id", sub_item_id)
            .execute()
        )
        return result.data[0] if result.data else None

    def delete_sub_item(self, sub_item_id: str) -> None:
        self.db.table("deliverable_sub_items").delete().eq("id", sub_item_id).execute()

    def update_with_version_check(
        self, deliverable_id: str, data: dict, expected_version: int
    ) -> Optional[dict]:
        """Optimistic locking — race condition koruması."""
        data["version"] = expected_version + 1
        result = (
            self.db.table("deliverables")
            .update(data)
            .eq("id", deliverable_id)
            .eq("version", expected_version)
            .execute()
        )
        return result.data[0] if result.data else None

    def assert_contract_in_project(self, contract_id: str, project_id: str) -> dict:
        result = (
            self.db.table("contracts")
            .select("id, project_id, title, contract_parties(role, name)")
            .eq("id", contract_id)
            .eq("is_deleted", False)
            .maybe_single()
            .execute()
        )
        row = result.data
        if not row or row["project_id"] != project_id:
            from backend.core.exceptions import NotFoundError
            raise NotFoundError("Contract not found in this project")
        return row
