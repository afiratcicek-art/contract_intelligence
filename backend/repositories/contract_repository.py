from typing import Optional
from backend.repositories.base import BaseRepository


class ContractRepository(BaseRepository):
    table_name = "contracts"

    def get_by_project(self, project_id: str) -> Optional[dict]:
        """The project's contract, with parties + documents embedded (one
        round-trip, nested PostgREST FK-embed through contract_documents to
        pdf_document for the display filename).

        Pilot cardinality (ADR-014, TB-27): the schema allows N contracts per
        project but the pilot runs 1:1, so this returns THE contract —
        newest-first + limit(1) keeps the pick deterministic even if data
        somehow holds more than one before the multi-contract UX exists.
        """
        result = (
            self.db.table("contracts")
            .select(
                "*, contract_parties(role, name),"
                " contract_documents(id, pdf_document_id, label, precedence_rank,"
                " pdf_document(original_filename))"
            )
            .eq("project_id", project_id)
            .eq("is_deleted", False)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    # contract_parties / contract_documents are child tables of ONE aggregate
    # (a contract is meaningless without them and vice versa), so their I/O
    # lives here rather than in two single-method repository files. Parties
    # stay INSERT-only (039: no DELETE policy). Documents support INSERT +
    # UPDATE (attach-later for label-only annexes, migration 040) — still no
    # DELETE (forensic archive).

    def add_parties(self, contract_id: str, parties: list[dict]) -> None:
        if not parties:
            return
        rows = [{"contract_id": contract_id, **p} for p in parties]
        self.db.table("contract_parties").insert(rows).execute()

    def link_documents(self, contract_id: str, links: list[dict]) -> None:
        if not links:
            return
        rows = [{"contract_id": contract_id, **link} for link in links]
        self.db.table("contract_documents").insert(rows).execute()

    def add_document(self, contract_id: str, data: dict) -> dict:
        result = (
            self.db.table("contract_documents")
            .insert({"contract_id": contract_id, **data})
            .execute()
        )
        return result.data[0]

    def get_document(self, link_id: str) -> Optional[dict]:
        result = (
            self.db.table("contract_documents")
            .select("*")
            .eq("id", link_id)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    def update_document(self, link_id: str, data: dict) -> dict:
        result = (
            self.db.table("contract_documents")
            .update(data)
            .eq("id", link_id)
            .execute()
        )
        return result.data[0]

    def unlink_document(self, link_id: str) -> None:
        # Hard-delete the LINK only (migration 041) — the pdf_document row and
        # storage object are left alone (forensic archive of the filed file).
        self.db.table("contract_documents").delete().eq("id", link_id).execute()
