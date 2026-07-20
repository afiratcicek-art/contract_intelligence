from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, Literal
from datetime import date
from uuid import UUID
from backend.core.sanitizer import sanitize_short, sanitize_medium


# Contract registration models (ADR-014). The base contract is a record the CM
# REGISTERS at project setup (HITL) — the fields describe an instrument that
# already exists in the world, same registration (not drafting) framing as
# amendments. role values mirror the DB CHECK in migration 039.
PartyRole = Literal["employer", "contractor", "engineer", "other"]


class ContractPartyIn(BaseModel):
    role: PartyRole
    name: str

    @field_validator("name", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)


class ContractCreate(BaseModel):
    title: str
    contract_number: Optional[str] = None
    description: Optional[str] = None
    # TERM (ADR-014): dlp_days is the DLP's LENGTH only — its window is derived
    # from actual completion, never stored. gt=0 mirrors the DB CHECKs.
    commencement_date: Optional[date] = None
    duration_days: Optional[int] = Field(None, gt=0)
    dlp_days: Optional[int] = Field(None, gt=0)
    parties: list[ContractPartyIn] = []

    @field_validator("contract_number", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("title", "description", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)


class ContractDocumentCreate(BaseModel):
    # One constituent document / annex (ek) of the contract. Registration-time
    # fact: the row may exist BEFORE its file (label-only annex, migration 040)
    # or carry an already-uploaded pdf_document. At least one of the two must
    # be present — an empty row asserts nothing.
    label: Optional[str] = None
    pdf_document_id: Optional[UUID] = None
    precedence_rank: Optional[int] = Field(None, gt=0)

    @field_validator("label", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @model_validator(mode="after")
    def require_label_or_pdf(self):
        if self.label is None and self.pdf_document_id is None:
            raise ValueError("label veya pdf_document_id gerekli")
        return self


class ContractDocumentUpdate(BaseModel):
    # Attach-later path: a file-less annex row gets its pdf_document_id when
    # the file arrives; label/rank may be corrected the same way.
    label: Optional[str] = None
    pdf_document_id: Optional[UUID] = None
    precedence_rank: Optional[int] = Field(None, gt=0)

    @field_validator("label", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)


class ContractUpdate(BaseModel):
    # Scalar fields only. Parties are set at registration and are NOT editable
    # through this update in Phase-1: replacing them would require a DELETE on
    # contract_parties, and no table in this schema grants a DELETE policy
    # (forensic-archive principle, 037/039 headers).
    title: Optional[str] = None
    contract_number: Optional[str] = None
    description: Optional[str] = None
    commencement_date: Optional[date] = None
    duration_days: Optional[int] = Field(None, gt=0)
    dlp_days: Optional[int] = Field(None, gt=0)

    @field_validator("contract_number", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("title", "description", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)
