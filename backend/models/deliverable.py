from pydantic import BaseModel
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


class DeliverableUpdate(BaseModel):
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
