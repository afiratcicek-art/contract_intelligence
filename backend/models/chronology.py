from pydantic import BaseModel, field_validator
from backend.core.sanitizer import sanitize_short, sanitize_medium, sanitize_content
from typing import Optional
from datetime import date, datetime
from uuid import UUID


class ChronologyCreate(BaseModel):
    title: str
    entity_type: str
    entity_id: Optional[UUID] = None

    @field_validator("title", mode="before")
    @classmethod
    def clean_title(cls, v): return sanitize_medium(v)

    @field_validator("entity_type", mode="before")
    @classmethod
    def clean_entity_type(cls, v): return sanitize_short(v)


class ChronologyEventCreate(BaseModel):
    event_date: date
    event_type: str
    document_ref_id: Optional[UUID] = None
    document_ref_type: Optional[str] = None
    is_key_event: bool = False
    activity_id: Optional[str] = None
    boq_ref: Optional[str] = None


class NarrativeApprove(BaseModel):
    approved_narrative: str

    @field_validator("approved_narrative", mode="before")
    @classmethod
    def clean_narrative(cls, v): return sanitize_content(v)


class EventInactivate(BaseModel):
    reason: str

    @field_validator("reason", mode="before")
    @classmethod
    def clean_reason(cls, v): return sanitize_medium(v)


class ChronologyResponse(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    entity_type: str
    entity_id: Optional[UUID] = None
    is_active: bool
    created_by: Optional[UUID] = None
    created_at: datetime


class ChronologyEventResponse(BaseModel):
    id: UUID
    chronology_id: UUID
    event_date: date
    event_type: str
    document_ref_id: Optional[UUID] = None
    document_ref_type: Optional[str] = None
    is_key_event: bool
    is_active: bool
    inactivation_reason: Optional[str] = None
    auto_narrative: Optional[str] = None
    approved_narrative: Optional[str] = None
    narrative_approved_by: Optional[UUID] = None
    narrative_approved_at: Optional[datetime] = None
    activity_id: Optional[str] = None
    boq_ref: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: datetime
