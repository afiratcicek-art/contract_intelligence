from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, Literal
from datetime import date, datetime
from uuid import UUID
from backend.models.common import DayType, DeadlineSource
from backend.core.sanitizer import sanitize_short, sanitize_medium, sanitize_long


class RFICreate(BaseModel):
    rfi_number: str
    subject: str
    description: Optional[str] = None
    discipline: Optional[str] = None
    submitted_by: Optional[str] = None
    submitted_date: Optional[date] = None
    response_due_date: Optional[date] = None
    response_due_source: Optional[DeadlineSource] = None
    response_due_day_type: Optional[DayType] = None
    assigned_to: Optional[UUID] = None
    external_ref: Optional[str] = None
    parent_id: Optional[UUID] = None
    rfi_type: Optional[str] = "original"
    entry_mode: Literal["authored", "recorded"] = "recorded"
    keywords: Optional[list[str]] = None
    references: Optional[list["RFIReferenceAdd"]] = None

    @field_validator("rfi_number", mode="before")
    @classmethod
    def clean_rfi_number(cls, v): return sanitize_short(v)

    @field_validator("subject", mode="before")
    @classmethod
    def clean_subject(cls, v): return sanitize_medium(v)

    @field_validator("description", mode="before")
    @classmethod
    def clean_description(cls, v): return sanitize_long(v)

    @field_validator("discipline", "submitted_by", "external_ref", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @model_validator(mode="after")
    def _recorded_requires_submitted_date(self):
        # Kaydedilen belge zaten sunulmustur: tarihi bilinir ve zorunludur.
        # Yoksa deadline hic hesaplanmaz -> sessiz time-bar kaybi.
        # DB'de ayni invaryant var (rfis_recorded_needs_submitted_date);
        # burada kesmek 500 yerine 422 dondurur.
        if self.entry_mode == "recorded" and self.submitted_date is None:
            raise ValueError("submitted_date is required when entry_mode is 'recorded'")
        return self


# status buradan degistirilemez. Gecisler kendi endpoint'lerine aittir:
#   draft -> open      : POST /rfis/{id}/approve  (rfi:approve)
#   * -> closed        : POST /rfis/{id}/close    (rfi:close)
#   * -> responded     : cocuk RFI olusturuldugunda otomatik
# Aksi halde 'edit' izni olan biri onay kapisini baypas eder.
class RFIUpdate(BaseModel):
    version: int
    subject: Optional[str] = None
    description: Optional[str] = None
    discipline: Optional[str] = None
    submitted_by: Optional[str] = None
    response_due_date: Optional[date] = None
    response_due_source: Optional[DeadlineSource] = None
    response_due_day_type: Optional[DayType] = None
    actual_response_date: Optional[date] = None
    assigned_to: Optional[UUID] = None
    external_ref: Optional[str] = None
    keywords: Optional[list[str]] = None

    @field_validator("subject", mode="before")
    @classmethod
    def clean_subject(cls, v): return sanitize_medium(v)

    @field_validator("description", mode="before")
    @classmethod
    def clean_description(cls, v): return sanitize_long(v)

    @field_validator("discipline", "submitted_by", "external_ref", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)


class RFIClose(BaseModel):
    version: int
    close_note: Optional[str] = None

    @field_validator("close_note", mode="before")
    @classmethod
    def clean_close_note(cls, v): return sanitize_long(v)


class RFIApprove(BaseModel):
    version: int


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
    parent_id: Optional[UUID] = None
    rfi_type: str = "original"
    keywords: list[str] = []
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


class RFIReferenceAdd(BaseModel):
    ref_type: str
    rfi_id: Optional[UUID] = None
    ref_corr_id: Optional[UUID] = None
    change_id: Optional[UUID] = None
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


RFICreate.model_rebuild()
