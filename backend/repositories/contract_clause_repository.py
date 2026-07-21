from typing import Optional

from backend.repositories.base import BaseRepository


class ContractClauseRepository(BaseRepository):
    table_name = "contract_clauses"
    # Migration 043: no is_deleted — registry nodes are not soft-deleted.
    soft_delete_field = None

    def find_or_create(
        self,
        project_id: str,
        *,
        contract_document_id: str,
        clause_ref: str,
        created_by: Optional[str] = None,
    ) -> dict:
        # HITL-sparse find-or-create key = partial UNIQUE
        # (contract_document_id, clause_ref) WHERE contract_document_id IS NOT NULL
        # (043). v1 path is document-only; amendment_id is schema-ready unused here.
        existing = (
            self.db.table("contract_clauses")
            .select("*")
            .eq("contract_document_id", str(contract_document_id))
            .eq("clause_ref", clause_ref)
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]

        row = {
            "project_id": project_id,
            "contract_document_id": str(contract_document_id),
            "clause_ref": clause_ref,
        }
        if created_by is not None:
            row["created_by"] = created_by

        try:
            result = self.db.table("contract_clauses").insert(row).execute()
            return result.data[0]
        except Exception as e:
            # Race backstop (FOOTGUN 3): concurrent insert hit the partial UNIQUE
            # → re-SELECT the winner. PostgREST surfaces PG 23505 as APIError.code
            # or in the message; accept either form.
            code = getattr(e, "code", None)
            msg = str(e)
            if code == "23505" or "23505" in msg or "duplicate key" in msg.lower():
                again = (
                    self.db.table("contract_clauses")
                    .select("*")
                    .eq("contract_document_id", str(contract_document_id))
                    .eq("clause_ref", clause_ref)
                    .limit(1)
                    .execute()
                )
                if again.data:
                    return again.data[0]
            raise
