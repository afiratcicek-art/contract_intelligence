from typing import Any, Optional

from backend.repositories.base import BaseRepository


class DocumentDraftRepository(BaseRepository):
    table_name = "document_drafts"
    soft_delete_field = None

    def list_by_project(
        self,
        project_id: str,
        status: Optional[str] = None,
        doc_type: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        # Single round-trip with template embed (N+1 guard).
        query = (
            self.db.table(self.table_name)
            .select("*, document_templates(id, name, doc_type, header_text, footer_text, header_image_path, footer_image_path, watermark_image_path, field_config)")
            .eq("project_id", project_id)
        )
        if status:
            query = query.eq("status", status)
        if doc_type:
            query = query.eq("doc_type", doc_type)
        result = (
            query.order("updated_at", desc=True)
            .limit(limit)
            .offset(offset)
            .execute()
        )
        return result.data or []

    def get_with_template(self, draft_id: str) -> Optional[dict]:
        result = (
            self.db.table(self.table_name)
            .select("*, document_templates(*)")
            .eq("id", draft_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    def update_with_version_check(
        self, draft_id: str, data: dict, expected_version: int
    ) -> Optional[dict]:
        """Optimistic locking — mirrors RFI/correspondence version TOCTOU pattern."""
        data["version"] = expected_version + 1
        result = (
            self.db.table(self.table_name)
            .update(data)
            .eq("id", draft_id)
            .eq("version", expected_version)
            .execute()
        )
        return result.data[0] if result.data else None

    def create_version_snapshot(
        self,
        draft_id: str,
        body_html: str,
        field_values: dict,
        snapshot_reason: str,
        created_by: Optional[str],
    ) -> dict:
        result = (
            self.db.table("document_draft_versions")
            .insert({
                "draft_id": draft_id,
                "body_html": body_html,
                "field_values": field_values,
                "snapshot_reason": snapshot_reason,
                "created_by": created_by,
            })
            .execute()
        )
        return result.data[0]

    def add_provenance(
        self,
        draft_id: str,
        event_type: str,
        *,
        target: Optional[str] = None,
        actor_user_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        llm_role: Optional[str] = None,
    ) -> dict:
        """Server-side provenance only — NEVER store draft/prompt content."""
        row = {
            "draft_id": draft_id,
            "event_type": event_type,
            "target": target,
            "actor_user_id": actor_user_id,
            "metadata": metadata or {},
        }
        if llm_role:
            row["llm_role"] = llm_role
        result = self.db.table("document_provenance").insert(row).execute()
        return result.data[0]

    def list_provenance(self, draft_id: str) -> list[dict]:
        result = (
            self.db.table("document_provenance")
            .select("id, draft_id, event_type, llm_role, target, actor_user_id, metadata, created_at")
            .eq("draft_id", draft_id)
            .order("created_at")
            .execute()
        )
        return result.data or []
