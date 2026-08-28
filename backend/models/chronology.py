from pydantic import BaseModel, field_validator
from backend.core.sanitizer import sanitize_short, sanitize_medium, sanitize_content
from typing import Optional
from datetime import date, datetime
from uuid import UUID


# Valid entity types for a chronology container.
# Each chronology belongs to one entity.
CHRONOLOGY_ENTITY_TYPES = {
    "change", "rfi", "correspondence", "general", "dispute"
}


class ChronologyCreate(BaseModel):
    title: str
    entity_type: str
    entity_id: Optional[UUID] = None

    @field_validator("title", mode="before")
    @classmethod
    def clean_title(cls, v): return sanitize_medium(v)

    @field_validator("entity_type", mode="before")
    @classmethod
    def clean_and_validate_entity_type(cls, v):
        if not v:
            raise ValueError("entity_type is required")
        cleaned = sanitize_short(str(v))
        if cleaned not in CHRONOLOGY_ENTITY_TYPES:
            raise ValueError(
                f"entity_type must be one of: "
                f"{sorted(CHRONOLOGY_ENTITY_TYPES)}"
            )
        return cleaned


# Event types allowed for manual user entry.
# 'dispute_step' is system-triggered (Dispute Register)
# and not listed here but remains valid in DB.
MANUAL_EVENT_TYPES = {
    "rfi", "correspondence", "notice",
    "submission", "response", "meeting",
    "inspection", "work_permit", "other",
}
# 'status_change' kaldirildi (2026-07-10): statu gecisi bir belge degil.
# Kaynak: rfis.status / correspondences.status + audit_log.
# Uretimdeki 2 kayit silindi; kaldirma geriye donuk kirilma uretmiyor.


class ChronologyEventCreate(BaseModel):
    event_date: date
    event_type: str
    document_ref_id: Optional[UUID] = None
    document_ref_type: Optional[str] = None
    is_key_event: bool = False
    activity_id: Optional[str] = None
    boq_ref: Optional[str] = None
    manual_narrative: Optional[str] = None
    subject: Optional[str] = None

    @field_validator("subject", mode="before")
    @classmethod
    def clean_subject(cls, v):
        if v is None:
            return v
        return sanitize_medium(str(v))

    @field_validator("event_type", mode="before")
    @classmethod
    def clean_and_validate_event_type(cls, v):
        if not v:
            raise ValueError("event_type is required")
        cleaned = sanitize_short(str(v))
        # dispute_step is valid but system-triggered only
        all_valid = MANUAL_EVENT_TYPES | {"dispute_step"}
        if cleaned not in all_valid:
            raise ValueError(
                f"event_type must be one of: "
                f"{sorted(all_valid)}"
            )
        return cleaned

    @field_validator("manual_narrative", mode="before")
    @classmethod
    def clean_manual_narrative(cls, v):
        if v is None:
            return v
        return sanitize_content(str(v))


class NarrativePreview(BaseModel):
    """On-demand LLM narrative (HITL) — does not persist."""
    event_type: str
    event_date: date
    subject: Optional[str] = None
    document_ref_id: Optional[UUID] = None
    document_ref_type: Optional[str] = None
    dispute_id: Optional[UUID] = None
    chronology_id: Optional[UUID] = None
    note: Optional[str] = None

    @field_validator("subject", "note", "document_ref_type", mode="before")
    @classmethod
    def clean_optional(cls, v):
        if v is None:
            return v
        return sanitize_medium(str(v))


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


class ChronologyEventUpdate(BaseModel):
    """Partial update for chronology event metadata.
    Narrative changes go through approve-narrative endpoint.
    document_ref_id and document_ref_type are immutable.
    event_date and subject are only editable for manual
    entries (enforced in router).
    """
    event_type: Optional[str] = None
    is_key_event: Optional[bool] = None
    event_date: Optional[date] = None
    subject: Optional[str] = None

    @field_validator("subject", mode="before")
    @classmethod
    def clean_subject_update(cls, v):
        if v is None:
            return v
        return sanitize_medium(str(v))

    @field_validator("event_type", mode="before")
    @classmethod
    def clean_event_type(cls, v):
        if v is None:
            return v
        from backend.models.chronology import MANUAL_EVENT_TYPES
        cleaned = sanitize_short(str(v))
        all_valid = MANUAL_EVENT_TYPES | {"dispute_step"}
        if cleaned not in all_valid:
            raise ValueError(
                f"event_type must be one of: {sorted(all_valid)}"
            )
        return cleaned


class ChronologyEventResponse(BaseModel):
    id: UUID
    chronology_id: UUID
    event_date: date
    event_type: str
    document_ref_id: Optional[UUID] = None
    document_ref_type: Optional[str] = None
    is_key_event: bool
    is_active: bool
    subject: Optional[str] = None
    inactivation_reason: Optional[str] = None
    auto_narrative: Optional[str] = None
    approved_narrative: Optional[str] = None
    narrative_approved_by: Optional[UUID] = None
    narrative_approved_at: Optional[datetime] = None
    activity_id: Optional[str] = None
    boq_ref: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: datetime


class ChronologyUpdate(BaseModel):
    """Partial update for chronology — title only."""
    title: str

    @field_validator("title", mode="before")
    @classmethod
    def clean_title(cls, v):
        return sanitize_medium(v)


class ChronologyListResponse(BaseModel):
    """Lightweight response for chronology list view.
    Returns event_count instead of full event objects.
    Avoids N+1 queries and response model validation issues.
    """
    id: UUID
    project_id: UUID
    title: str
    entity_type: str
    entity_id: Optional[UUID] = None
    is_active: bool
    created_by: Optional[UUID] = None
    created_at: datetime
    event_count: int = 0


class ChronologyResponse(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    entity_type: str
    entity_id: Optional[UUID] = None
    is_active: bool
    created_by: Optional[UUID] = None
    created_at: datetime
    events: list[ChronologyEventResponse] = []
