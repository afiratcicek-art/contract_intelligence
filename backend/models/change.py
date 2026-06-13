from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from uuid import UUID
from backend.models.common import DayType, DeadlineSource


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


# ── Change References ──────────────────────────────────────────────────────

class ChangeReferenceAdd(BaseModel):
    ref_type: str
    ref_number: str
    ref_date: Optional[date] = None
    revision: Optional[str] = None
    description: Optional[str] = None


# ── Correspondence-Change Link ─────────────────────────────────────────────

class ChangeLinkCreate(BaseModel):
    correspondence_id: UUID
    note: Optional[str] = None
