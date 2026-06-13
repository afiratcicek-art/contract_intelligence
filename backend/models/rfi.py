from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from uuid import UUID
from backend.models.common import DayType, DeadlineSource


class RFICreate(BaseModel):
    rfi_number: str
    subject: str
    description: Optional[str] = None
    discipline: Optional[str] = None
    submitted_by: Optional[str] = None
    submitted_date: date
    response_due_date: Optional[date] = None
    response_due_source: Optional[DeadlineSource] = None
    response_due_day_type: Optional[DayType] = None
    assigned_to: Optional[UUID] = None
    external_ref: Optional[str] = None


class RFIUpdate(BaseModel):
    subject: Optional[str] = None
    description: Optional[str] = None
    discipline: Optional[str] = None
    submitted_by: Optional[str] = None
    response_due_date: Optional[date] = None
    response_due_source: Optional[DeadlineSource] = None
    response_due_day_type: Optional[DayType] = None
    actual_response_date: Optional[date] = None
    status: Optional[str] = None
    assigned_to: Optional[UUID] = None
    external_ref: Optional[str] = None


class RFIClose(BaseModel):
    close_note: Optional[str] = None


class RFIResponse(BaseModel):
    id: UUID
    project_id: UUID
    rfi_number: str
    subject: str
    description: Optional[str] = None
    discipline: Optional[str] = None
    submitted_by: Optional[str] = None
    submitted_date: date
    response_due_date: Optional[date] = None
    response_due_source: Optional[str] = None
    response_due_day_type: Optional[str] = None
    actual_response_date: Optional[date] = None
    status: str
    closed_by: Optional[UUID] = None
    closed_at: Optional[datetime] = None
    close_note: Optional[str] = None
    assigned_to: Optional[UUID] = None
    external_ref: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime


class RFIDeadlineResponse(BaseModel):
    rfi_id: UUID
    rfi_number: str
    subject: str
    deadline: Optional[date] = None
    deadline_source: Optional[str] = None
    days_remaining: Optional[int] = None
    urgency: str
