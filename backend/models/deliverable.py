from pydantic import BaseModel, field_validator, Field
from backend.core.sanitizer import sanitize_short, sanitize_medium, sanitize_long
from typing import Literal, Optional
from datetime import date, datetime
from uuid import UUID

Category = Literal[
    "hse", "insurance", "bond_security", "statutory",
    "report", "certification", "permit_approval", "administrative", "other",
]
Source = Literal["contract_clause", "handover", "employer_imposition", "statutory"]
Kind = Literal["artifact", "compliance"]
Direction = Literal["we_owe", "they_owe"]
Cadence = Literal["one_time", "recurring", "standing_renewal"]
Status = Literal["open", "in_progress", "completed", "not_applicable"]
EntrySource = Literal["scan", "library", "manual"]
SubOrigin = Literal["user_added", "cadence_generated"]
Fulfillment = Literal["pending", "fulfilled", "waived"]
TimeStatus = Literal["ok", "expiring_soon", "overdue"]


class DeliverableCreate(BaseModel):
    title: str
    contract_id: UUID
    category: Category
    source: Source
    kind: Kind
    cadence: Cadence = "one_time"
    source_ref: Optional[str] = None
    cadence_rule: Optional[str] = None
    # If set with direction_override=True, stored as-is; else server derives.
    direction: Optional[Direction] = None
    direction_override: bool = False
    status: Status = "open"
    due_date: Optional[date] = None
    expiry_date: Optional[date] = None
    responsible: Optional[str] = None
    notes: Optional[str] = None
    pending_detail: bool = False
    entry_source: EntrySource = "manual"

    @field_validator("title", "category", "responsible", mode="before")
    @classmethod
    def clean_medium_fields(cls, v):
        return sanitize_medium(v)

    @field_validator("source", "source_ref", "kind", "cadence", "cadence_rule",
                     "direction", "status", "entry_source", mode="before")
    @classmethod
    def clean_short_fields(cls, v):
        return sanitize_short(v)

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, v):
        return sanitize_long(v)


class DeliverableUpdate(BaseModel):
    version: int
    title: Optional[str] = None
    category: Optional[Category] = None
    source: Optional[Source] = None
    source_ref: Optional[str] = None
    kind: Optional[Kind] = None
    direction: Optional[Direction] = None
    direction_override: Optional[bool] = None
    cadence: Optional[Cadence] = None
    cadence_rule: Optional[str] = None
    status: Optional[Status] = None
    due_date: Optional[date] = None
    expiry_date: Optional[date] = None
    responsible: Optional[str] = None
    notes: Optional[str] = None
    pending_detail: Optional[bool] = None

    @field_validator("title", "category", "responsible", mode="before")
    @classmethod
    def clean_medium_fields(cls, v):
        return sanitize_medium(v)

    @field_validator("source", "source_ref", "kind", "cadence", "cadence_rule",
                     "direction", "status", mode="before")
    @classmethod
    def clean_short_fields(cls, v):
        return sanitize_short(v)

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, v):
        return sanitize_long(v)


class SubItemCreate(BaseModel):
    name: str
    due_date: Optional[date] = None
    status: Status = "open"
    fulfillment: Fulfillment = "pending"
    notes: Optional[str] = None
    origin: SubOrigin = "user_added"
    sort_order: int = 0

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, v):
        return sanitize_medium(v)

    @field_validator("status", "fulfillment", "origin", mode="before")
    @classmethod
    def clean_short(cls, v):
        return sanitize_short(v)

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, v):
        return sanitize_long(v)


class SubItemUpdate(BaseModel):
    name: Optional[str] = None
    due_date: Optional[date] = None
    status: Optional[Status] = None
    fulfillment: Optional[Fulfillment] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, v):
        return sanitize_medium(v)

    @field_validator("status", "fulfillment", mode="before")
    @classmethod
    def clean_short(cls, v):
        return sanitize_short(v)

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, v):
        return sanitize_long(v)


class SubItemResponse(BaseModel):
    id: UUID
    deliverable_id: UUID
    name: str
    due_date: Optional[date] = None
    status: str
    fulfillment: str
    notes: Optional[str] = None
    origin: str
    sort_order: int
    created_at: datetime
    updated_at: datetime


class DeliverableResponse(BaseModel):
    id: UUID
    project_id: UUID
    contract_id: UUID
    title: str
    category: str
    source: str
    source_ref: Optional[str] = None
    kind: str
    direction: str
    direction_override: bool
    cadence: str
    cadence_rule: Optional[str] = None
    status: str
    due_date: Optional[date] = None
    expiry_date: Optional[date] = None
    responsible: Optional[str] = None
    notes: Optional[str] = None
    pending_detail: bool
    entry_source: str
    version: int
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    # Computed (not stored) — DeadlineService urgency mapped to time_status
    time_status: Optional[TimeStatus] = None
    days_remaining: Optional[int] = None


class SuggestionAccept(BaseModel):
    """HITL multi-accept from library suggestions (entry_source=library)."""
    contract_id: UUID
    keys: list[str] = Field(min_length=1, max_length=50)
