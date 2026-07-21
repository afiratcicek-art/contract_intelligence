from backend.repositories.base import BaseRepository


class ClauseIncorporationRepository(BaseRepository):
    table_name = "clause_incorporations"
    # Migration 043: no is_deleted — rejected = tombstone (HITL), like overrides.
    soft_delete_field = None

    def list_by_project(
        self,
        project_id: str,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        result = (
            self.db.table("clause_incorporations")
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(limit)
            .offset(offset)
            .execute()
        )
        return result.data or []

    def list_confirmed_with_clauses(self, project_id: str) -> list[dict]:
        # Resolution fetch (I/O only). ONE round-trip: source + target clause
        # nodes FK-embedded via PostgREST hints (FOOTGUN 1) — no N+1.
        # Only status='confirmed' rows enter the in-force graph (043 HITL gate).
        result = (
            self.db.table("clause_incorporations")
            .select(
                "*, "
                "source_clause:contract_clauses!source_clause_id("
                "id,clause_ref,contract_document_id,parent_clause_id), "
                "target_clause:contract_clauses!target_clause_id("
                "id,clause_ref,contract_document_id,parent_clause_id)"
            )
            .eq("project_id", project_id)
            .eq("status", "confirmed")
            .execute()
        )
        return result.data or []
