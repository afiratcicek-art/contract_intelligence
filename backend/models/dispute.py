from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, Literal
from datetime import date
from uuid import UUID
from backend.core.sanitizer import sanitize_short, sanitize_medium, sanitize_content


DisputeStatus = Literal["draft", "open", "prepared", "closed"]
DisputeOrigin = Literal["change", "correspondence", "mixed", "manual"]
ImpactType = Literal["cost", "time", "other"]
PositionSide = Literal["claim", "response"]
PositionRefType = Literal["change", "correspondence", "rfi", "document", "manual"]

NESTED_SELECT = (
    "*, dispute_impacts(*), "
    "dispute_issues(*, dispute_positions(*, dispute_position_refs(*)))"
)


class DisputeCreate(BaseModel):
    title: str
    origin: DisputeOrigin = "manual"
    summary: Optional[str] = None
    venue: Optional[str] = None
    source_change_id: Optional[UUID] = None
    source_correspondence_id: Optional[UUID] = None
    status: DisputeStatus = "draft"

    @field_validator("title", "venue", mode="before")
    @classmethod
    def clean_medium(cls, v):
        return sanitize_medium(v)

    @field_validator("summary", mode="before")
    @classmethod
    def clean_summary(cls, v):
        if v is None:
            return v
        return sanitize_content(str(v))


class DisputeUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[DisputeStatus] = None
    origin: Optional[DisputeOrigin] = None
    summary: Optional[str] = None
    venue: Optional[str] = None
    source_change_id: Optional[UUID] = None
    source_correspondence_id: Optional[UUID] = None
    chronology_id: Optional[UUID] = None

    @field_validator("title", "venue", mode="before")
    @classmethod
    def clean_medium(cls, v):
        return sanitize_medium(v)

    @field_validator("summary", mode="before")
    @classmethod
    def clean_summary(cls, v):
        if v is None:
            return v
        return sanitize_content(str(v))


class ImpactCreate(BaseModel):
    type: ImpactType
    label: str
    amount: Optional[float] = None
    unit: Optional[str] = None
    notes: Optional[str] = None
    sort_order: int = 0

    @field_validator("label", "unit", mode="before")
    @classmethod
    def clean_short(cls, v):
        return sanitize_short(v)

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, v):
        if v is None:
            return v
        return sanitize_medium(str(v))


class ImpactUpdate(BaseModel):
    type: Optional[ImpactType] = None
    label: Optional[str] = None
    amount: Optional[float] = None
    unit: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None

    @field_validator("label", "unit", mode="before")
    @classmethod
    def clean_short(cls, v):
        return sanitize_short(v)

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, v):
        if v is None:
            return v
        return sanitize_medium(str(v))


class IssueCreate(BaseModel):
    title: str
    sort_order: int = 0

    @field_validator("title", mode="before")
    @classmethod
    def clean_title(cls, v):
        return sanitize_medium(v)


class IssueUpdate(BaseModel):
    title: Optional[str] = None
    sort_order: Optional[int] = None

    @field_validator("title", mode="before")
    @classmethod
    def clean_title(cls, v):
        return sanitize_medium(v)


class PositionGenerate(BaseModel):
    side: PositionSide
    issue_id: UUID


class PositionCreate(BaseModel):
    side: PositionSide
    title: str
    summary: Optional[str] = None
    sort_order: int = 0

    @field_validator("title", mode="before")
    @classmethod
    def clean_title(cls, v):
        return sanitize_medium(v)

    @field_validator("summary", mode="before")
    @classmethod
    def clean_summary(cls, v):
        if v is None:
            return v
        return sanitize_content(str(v))


class PositionUpdate(BaseModel):
    side: Optional[PositionSide] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    sort_order: Optional[int] = None

    @field_validator("title", mode="before")
    @classmethod
    def clean_title(cls, v):
        return sanitize_medium(v)

    @field_validator("summary", mode="before")
    @classmethod
    def clean_summary(cls, v):
        if v is None:
            return v
        return sanitize_content(str(v))


class PositionRefCreate(BaseModel):
    ref_type: PositionRefType
    entity_id: Optional[UUID] = None
    document_id: Optional[UUID] = None
    manual_title: Optional[str] = None
    manual_date: Optional[date] = None
    manual_note: Optional[str] = None

    @field_validator("manual_title", mode="before")
    @classmethod
    def clean_manual_title(cls, v):
        return sanitize_medium(v)

    @field_validator("manual_note", mode="before")
    @classmethod
    def clean_manual_note(cls, v):
        if v is None:
            return v
        return sanitize_medium(str(v))

    @model_validator(mode="after")
    def xor_system_manual(self):
        if self.ref_type == "manual":
            if self.entity_id is not None or self.document_id is not None:
                raise ValueError("manual ref cannot carry entity_id or document_id")
            if not self.manual_title:
                raise ValueError("manual ref requires manual_title")
        else:
            if self.entity_id is None and self.document_id is None:
                raise ValueError("system ref requires entity_id or document_id")
            if self.manual_title:
                raise ValueError("system ref cannot carry manual_title")
        return self
