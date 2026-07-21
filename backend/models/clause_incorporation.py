from pydantic import BaseModel, field_validator, model_validator
from uuid import UUID
from backend.core.sanitizer import sanitize_short


class IncorporationCreate(BaseModel):
    # Relationship fields ONLY. Provenance (status / proposed_by / confirmed_by /
    # confirmed_at) is NOT accepted from the client — the router sets it (same
    # forge-proof pattern as OverrideCreate / overrides.py).
    source_document_id: UUID
    source_clause_ref: str
    target_document_id: UUID
    target_clause_ref: str

    @field_validator("source_clause_ref", "target_clause_ref", mode="before")
    @classmethod
    def clean_clause_refs(cls, v):
        # clause_ref is short (e.g. "3.b", "App C §5"); sanitize_short max 200.
        cleaned = sanitize_short(v)
        if cleaned is None or cleaned == "":
            raise ValueError("clause_ref is required")
        return cleaned

    @model_validator(mode="after")
    def _no_self_edge(self):
        # Edge mirror of clause_incorporations_no_self_ck (043): same
        # (document_id, clause_ref) as both source and target is refused as 422
        # before find-or-create would mint a single node and trip the DB CHECK.
        if (self.source_document_id == self.target_document_id
                and self.source_clause_ref == self.target_clause_ref):
            raise ValueError(
                "source and target cannot be the same (document_id, clause_ref)."
            )
        return self
