from pydantic import BaseModel, field_validator
from backend.core.sanitizer import sanitize_short, sanitize_medium, sanitize_long
from typing import Optional
from datetime import date, datetime
from uuid import UUID
from backend.models.common import DayType


class DeliverableCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: str
    subcategory: Optional[str] = None
    source: str = "manual"
    source_clause: Optional[str] = None
    due_date: Optional[date] = None
    due_date_source: Optional[str] = None
    due_date_clause: Optional[str] = None
    due_date_day_type: Optional[DayType] = None
    is_pre_completion: bool = True
    correspondence_id: Optional[UUID] = None
    change_id: Optional[UUID] = None

    @field_validator("title", "category", "subcategory", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)

    @field_validator("source", "source_clause",
                     "due_date_source", "due_date_clause", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("description", mode="before")
    @classmethod
    def clean_description(cls, v): return sanitize_long(v)


class DeliverableUpdate(BaseModel):
    version: int
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    source_clause: Optional[str] = None
    due_date: Optional[date] = None
    due_date_source: Optional[str] = None
    due_date_clause: Optional[str] = None
    due_date_day_type: Optional[DayType] = None
    is_pre_completion: Optional[bool] = None
    status: Optional[str] = None
    rejection_reason: Optional[str] = None

    @field_validator("title", "category", "subcategory", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)

    @field_validator("source_clause", "due_date_source",
                     "due_date_clause", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("description", "rejection_reason", mode="before")
    @classmethod
    def clean_long_fields(cls, v): return sanitize_long(v)


class DeliverableResponse(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    description: Optional[str] = None
    category: str
    subcategory: Optional[str] = None
    source: str
    source_clause: Optional[str] = None
    ai_confidence: Optional[float] = None
    approved_by_cm: bool
    approved_by_cm_at: Optional[datetime] = None
    due_date: Optional[date] = None
    due_date_source: Optional[str] = None
    due_date_clause: Optional[str] = None
    is_pre_completion: bool
    status: str
    pm_approval_required: bool = True
    pm_approval_status: str
    pm_approved_by: Optional[UUID] = None
    pm_approved_at: Optional[datetime] = None
    revision_number: int
    rejection_reason: Optional[str] = None
    correspondence_id: Optional[UUID] = None
    change_id: Optional[UUID] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
