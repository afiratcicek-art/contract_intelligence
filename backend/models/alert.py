from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import date
from uuid import UUID
from backend.core.sanitizer import sanitize_short, sanitize_medium, sanitize_long


class NoticeConfigCreate(BaseModel):
    event_type: str
    label: str
    clause_reference: Optional[str] = None
    notice_period_days: int = 28
    day_type: str = "calendar"
    is_active: bool = True

    @field_validator("event_type", "clause_reference", mode="before")
    @classmethod
    def clean_short(cls, v): return sanitize_short(v) if v else v

    @field_validator("label", mode="before")
    @classmethod
    def clean_label(cls, v): return sanitize_medium(v)


class NoticeConfigUpdate(BaseModel):
    label: Optional[str] = None
    clause_reference: Optional[str] = None
    notice_period_days: Optional[int] = None
    day_type: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("clause_reference", mode="before")
    @classmethod
    def clean_short(cls, v): return sanitize_short(v) if v else v

    @field_validator("label", mode="before")
    @classmethod
    def clean_label(cls, v): return sanitize_medium(v) if v else v


class AlertCreate(BaseModel):
    alert_type: str
    priority: str = "normal"
    action_party: str = "us"
    assigned_to_role: Optional[str] = None
    assigned_to_user: Optional[UUID] = None
    source_entity_type: Optional[str] = None
    source_entity_id: Optional[UUID] = None
    narrative: Optional[str] = None
    notice_config_id: Optional[UUID] = None

    @field_validator("narrative", mode="before")
    @classmethod
    def clean_narrative(cls, v): return sanitize_long(v) if v else v


class AlertDecision(BaseModel):
    cm_decision: str
    cm_decision_note: Optional[str] = None
    snoozed_until: Optional[date] = None
    version: int

    @field_validator("cm_decision_note", mode="before")
    @classmethod
    def clean_note(cls, v): return sanitize_long(v) if v else v


class AlertActionCreate(BaseModel):
    action_type: str  # 'note' or 'assignment'
    note: Optional[str] = None
    assigned_to_user: Optional[UUID] = None
    assigned_to_role: Optional[str] = None
    due_date: Optional[date] = None

    @field_validator("note", "assigned_to_role", mode="before")
    @classmethod
    def clean_text(cls, v):
        if v is None:
            return v
        return sanitize_medium(str(v))

    @field_validator("action_type", mode="before")
    @classmethod
    def clean_and_validate_action_type(cls, v):
        if not v:
            raise ValueError("action_type is required")
        cleaned = sanitize_short(str(v))
        if cleaned not in ("note", "assignment"):
            raise ValueError("action_type must be note or assignment")
        return cleaned

    def validate_type_fields(self):
        """Call after model init to enforce type-specific rules."""
        if self.action_type == "note" and not self.note:
            raise ValueError("note is required for action_type=note")
        if self.action_type == "assignment":
            if not self.assigned_to_user and not self.assigned_to_role:
                raise ValueError(
                    "assigned_to_user or assigned_to_role required "
                    "for action_type=assignment"
                )


class AlertDocumentLink(BaseModel):
    document_id: UUID
