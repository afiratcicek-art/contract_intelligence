from pydantic import BaseModel, field_validator
from typing import Optional, Literal
from datetime import date, datetime
from uuid import UUID
from backend.models.common import Direction, DayType, DeadlineSource, ContractualStatus
from backend.core.sanitizer import sanitize_short, sanitize_medium, sanitize_long, sanitize_content


class CorrespondenceCreate(BaseModel):
    parent_id: Optional[UUID] = None
    references: Optional[list["CorrespondenceReferenceAdd"]] = None
    corr_number: str
    direction: Direction
    type: str
    subject: str
    from_party_id: Optional[UUID] = None
    to_party_id: Optional[UUID] = None
    from_external: bool = False
    external_actor_name: Optional[str] = None
    correspondence_date: date
    response_due_date: Optional[date] = None
    response_due_source: Optional[DeadlineSource] = None
    response_due_clause: Optional[str] = None
    response_due_day_type: Optional[DayType] = None
    external_ref: Optional[str] = None
    keywords: Optional[list[str]] = None
    # Migration 044 — NULL-tolerant; authored materialization sets this.
    entry_mode: Optional[Literal["authored", "recorded"]] = None

    @field_validator("corr_number", "external_ref", "response_due_clause", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("type", "subject", "external_actor_name", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)


class CorrespondenceUpdate(BaseModel):
    subject: Optional[str] = None
    correspondence_date: Optional[date] = None
    response_due_date: Optional[date] = None
    response_due_source: Optional[DeadlineSource] = None
    response_due_clause: Optional[str] = None
    response_due_day_type: Optional[DayType] = None
    actual_response_date: Optional[date] = None
    assigned_to: Optional[UUID] = None
    external_ref: Optional[str] = None
    final_content: Optional[str] = None
    keywords: Optional[list[str]] = None

    @field_validator("external_ref", "response_due_clause", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("subject", mode="before")
    @classmethod
    def clean_subject(cls, v): return sanitize_medium(v)

    @field_validator("final_content", mode="before")
    @classmethod
    def clean_final_content(cls, v): return sanitize_content(v)


class ContractualStatusUpdate(BaseModel):
    contractual_status: ContractualStatus
    contractual_status_note: Optional[str] = None

    @field_validator("contractual_status_note", mode="before")
    @classmethod
    def clean_note(cls, v): return sanitize_long(v)


class CorrespondencePublish(BaseModel):
    publication_channel: Optional[str] = None
    publication_ref: Optional[str] = None

    @field_validator("publication_channel", "publication_ref", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)


class CorrespondenceClose(BaseModel):
    close_note: Optional[str] = None

    @field_validator("close_note", mode="before")
    @classmethod
    def clean_close_note(cls, v): return sanitize_long(v)


class CorrespondenceResponse(BaseModel):
    id: UUID
    project_id: UUID
    parent_id: Optional[UUID] = None
    corr_number: str
    direction: str
    type: str
    subject: str
    from_party_id: Optional[UUID] = None
    to_party_id: Optional[UUID] = None
    from_external: bool
    external_actor_name: Optional[str] = None
    correspondence_date: date
    response_due_date: Optional[date] = None
    response_due_source: Optional[str] = None
    response_due_clause: Optional[str] = None
    response_due_day_type: Optional[str] = None
    actual_response_date: Optional[date] = None
    contractual_status: str
    contractual_status_note: Optional[str] = None
    status: str
    assigned_to: Optional[UUID] = None
    pm_approval_status: str
    has_response: bool = False
    response_corr_id: Optional[UUID] = None
    approved_by: Optional[UUID] = None
    approved_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    published_by: Optional[UUID] = None
    publication_channel: Optional[str] = None
    closed_by: Optional[UUID] = None
    closed_at: Optional[datetime] = None
    external_ref: Optional[str] = None
    keywords: list[str] = []
    version: int
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime


class CorrespondenceReferenceAdd(BaseModel):
    ref_type: str
    rfi_id: Optional[UUID] = None
    ref_corr_id: Optional[UUID] = None
    change_id: Optional[UUID] = None
    document_id: Optional[UUID] = None
    external_doc_number: Optional[str] = None
    external_doc_title: Optional[str] = None
    external_doc_date: Optional[date] = None
    note: Optional[str] = None

    @field_validator("ref_type", "external_doc_number", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("external_doc_title", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)

    @field_validator("note", mode="before")
    @classmethod
    def clean_note(cls, v): return sanitize_long(v)


class DraftSave(BaseModel):
    content: str
    note: Optional[str] = None
    confidence_score: Optional[float] = None
    review_required: Optional[bool] = None
    warnings: Optional[list[str]] = None
    objectivity_flag: Optional[bool] = None
    resolved_by_gate: Optional[bool] = None

    @field_validator("content", mode="before")
    @classmethod
    def clean_content(cls, v): return sanitize_content(v)

    @field_validator("note", mode="before")
    @classmethod
    def clean_note(cls, v): return sanitize_long(v)


class DraftResponse(BaseModel):
    id: UUID
    correspondence_id: UUID
    content: str
    draft_type: str
    saved_by: Optional[UUID] = None
    saved_at: datetime
    note: Optional[str] = None
