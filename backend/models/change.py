from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import date, datetime
from uuid import UUID
from backend.models.common import DayType
from backend.core.sanitizer import sanitize_short, sanitize_medium, sanitize_long


class ChangeCreate(BaseModel):
    change_number: str
    title: str
    description: Optional[str] = None
    origin: str
    notice_due_date: Optional[date] = None
    notice_due_source: Optional[str] = None
    notice_due_day_type: Optional[DayType] = None
    impact_due_date: Optional[date] = None
    impact_due_source: Optional[str] = None

    @field_validator("change_number", "notice_due_source", "impact_due_source", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("title", "origin", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)

    @field_validator("description", mode="before")
    @classmethod
    def clean_description(cls, v): return sanitize_long(v)


class ChangeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    origin: Optional[str] = None
    status: Optional[str] = None
    cost_claimed_amount: Optional[float] = None
    cost_claimed_date: Optional[date] = None
    cost_agreed_amount: Optional[float] = None
    cost_agreed_date: Optional[date] = None
    cost_currency: Optional[str] = None
    cost_impact_status: Optional[str] = None
    time_impact_days_claimed: Optional[int] = None
    time_impact_days_agreed: Optional[int] = None
    time_impact_claimed_date: Optional[date] = None
    time_impact_agreed_date: Optional[date] = None
    time_impact_status: Optional[str] = None
    time_impact_note: Optional[str] = None
    notice_sent: Optional[bool] = None
    notice_sent_date: Optional[date] = None
    notice_due_date: Optional[date] = None
    notice_due_source: Optional[str] = None
    notice_due_day_type: Optional[DayType] = None
    impact_due_date: Optional[date] = None
    impact_due_source: Optional[str] = None
    impact_submitted_date: Optional[date] = None
    version: Optional[int] = None

    @field_validator("notice_due_source", "impact_due_source", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("title", "origin", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)

    @field_validator("description", "time_impact_note", mode="before")
    @classmethod
    def clean_long_fields(cls, v): return sanitize_long(v)


class ChangeResponse(BaseModel):
    id: UUID
    project_id: UUID
    change_number: str
    title: str
    description: Optional[str] = None
    origin: str
    status: str
    cost_claimed_amount: Optional[float] = None
    cost_claimed_date: Optional[date] = None
    cost_agreed_amount: Optional[float] = None
    cost_agreed_date: Optional[date] = None
    cost_currency: str
    cost_impact_status: str
    time_impact_days_claimed: Optional[int] = None
    time_impact_days_agreed: Optional[int] = None
    time_impact_claimed_date: Optional[date] = None
    time_impact_agreed_date: Optional[date] = None
    time_impact_status: str
    time_impact_note: Optional[str] = None
    notice_sent: bool
    notice_sent_date: Optional[date] = None
    notice_due_date: Optional[date] = None
    notice_due_source: Optional[str] = None
    notice_due_day_type: Optional[str] = None
    impact_due_date: Optional[date] = None
    impact_submitted_date: Optional[date] = None
    trigger_source: str
    version: int
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime


class ChangeReferenceAdd(BaseModel):
    ref_type: str
    ref_number: str
    ref_date: Optional[date] = None
    revision: Optional[str] = None
    description: Optional[str] = None

    @field_validator("ref_type", "ref_number", "revision", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("description", mode="before")
    @classmethod
    def clean_description(cls, v): return sanitize_long(v)


class ChangeLinkCreate(BaseModel):
    correspondence_id: UUID
    note: Optional[str] = None

    @field_validator("note", mode="before")
    @classmethod
    def clean_note(cls, v): return sanitize_long(v)
