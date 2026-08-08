from typing import Optional

from backend.repositories.base import BaseRepository


class DocumentTemplateRepository(BaseRepository):
    table_name = "document_templates"
    soft_delete_field = None

    def list_by_project(
        self,
        project_id: str,
        doc_type: Optional[str] = None,
        active_only: bool = False,
    ) -> list[dict]:
        query = (
            self.db.table(self.table_name)
            .select("*")
            .eq("project_id", project_id)
        )
        if doc_type:
            query = query.eq("doc_type", doc_type)
        if active_only:
            query = query.eq("is_active", True)
        result = query.order("created_at", desc=True).execute()
        return result.data or []

    def get_active(self, project_id: str, doc_type: str) -> Optional[dict]:
        result = (
            self.db.table(self.table_name)
            .select("*")
            .eq("project_id", project_id)
            .eq("doc_type", doc_type)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    def deactivate_others(self, project_id: str, doc_type: str, keep_id: str) -> None:
        """Ensure partial unique (one active per type) before activating keep_id."""
        self.db.table(self.table_name).update({"is_active": False}).eq(
            "project_id", project_id
        ).eq("doc_type", doc_type).neq("id", keep_id).eq("is_active", True).execute()

    def hard_delete(self, record_id: str) -> None:
        """Permanent remove. Callers must CM-authz first (get_or_404 + project assert).

        Prefer user JWT once 054 DELETE policy is applied. Admin fallback covers
        environments still on 044 (no DELETE policy → 42501 on user client).
        """
        from backend.database import get_admin_client

        get_admin_client().table(self.table_name).delete().eq(
            self.primary_key, record_id
        ).execute()
