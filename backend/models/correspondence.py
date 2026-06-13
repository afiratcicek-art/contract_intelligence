from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from uuid import UUID
from backend.models.common import Direction, DayType, DeadlineSource, ContractualStatus, PMApprovalStatus


class CorrespondenceCreate(BaseModel):
    parent_id: Optional[UUID] = None
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


class ContractualStatusUpdate(BaseModel):
    contractual_status: ContractualStatus
    contractual_status_note: Optional[str] = None


class CorrespondencePublish(BaseModel):
    publication_channel: Optional[str] = None
    publication_ref: Optional[str] = None


class CorrespondenceClose(BaseModel):
    close_note: Optional[str] = None


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
    version: int
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime


# ── References ─────────────────────────────────────────────────────────────

class CorrespondenceReferenceAdd(BaseModel):
    ref_type: str
    rfi_id: Optional[UUID] = None
    ref_corr_id: Optional[UUID] = None
    change_id: Optional[UUID] = None
    external_doc_number: Optional[str] = None
    external_doc_title: Optional[str] = None
    external_doc_date: Optional[date] = None
    note: Optional[str] = None


# ── Drafts ─────────────────────────────────────────────────────────────────

class DraftSave(BaseModel):
    content: str
    note: Optional[str] = None
    confidence_score: Optional[float] = None
    review_required: Optional[bool] = None
    warnings: Optional[list[str]] = None
    objectivity_flag: Optional[bool] = None
    resolved_by_gate: Optional[bool] = None


class DraftResponse(BaseModel):
    id: UUID
    correspondence_id: UUID
    content: str
    draft_type: str
    saved_by: Optional[UUID] = None
    saved_at: datetime
    note: Optional[str] = None
