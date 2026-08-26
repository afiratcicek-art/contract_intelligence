from datetime import date
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from backend.core.html_sanitizer import sanitize_body_html
from backend.core.sanitizer import sanitize_content, sanitize_medium, sanitize_short


class TemplateCreate(BaseModel):
    doc_type: Literal["letter", "rfi"]
    name: str
    header_text: Optional[str] = None
    footer_text: Optional[str] = None
    field_config: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True

    @field_validator("name", mode="before")
    @classmethod
    def clean_name(cls, v):
        return sanitize_medium(v)

    @field_validator("header_text", "footer_text", mode="before")
    @classmethod
    def clean_chrome_text(cls, v):
        return sanitize_medium(v)


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    header_text: Optional[str] = None
    footer_text: Optional[str] = None
    field_config: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None

    @field_validator("name", "header_text", "footer_text", mode="before")
    @classmethod
    def clean_text(cls, v):
        return sanitize_medium(v)


class DraftCreate(BaseModel):
    doc_type: Literal["letter", "rfi"]
    subject: Optional[str] = None
    body_html: str = ""
    field_values: dict[str, Any] = Field(default_factory=dict)
    template_id: Optional[UUID] = None

    @field_validator("subject", mode="before")
    @classmethod
    def clean_subject(cls, v):
        return sanitize_medium(v)

    @field_validator("body_html", mode="before")
    @classmethod
    def clean_body(cls, v):
        return sanitize_body_html(v if v is not None else "")


class DraftUpdate(BaseModel):
    version: int
    subject: Optional[str] = None
    body_html: Optional[str] = None
    field_values: Optional[dict[str, Any]] = None

    @field_validator("subject", mode="before")
    @classmethod
    def clean_subject(cls, v):
        return sanitize_medium(v)

    @field_validator("body_html", mode="before")
    @classmethod
    def clean_body(cls, v):
        if v is None:
            return None
        return sanitize_body_html(v)


class DraftSnapshot(BaseModel):
    snapshot_reason: Literal["manual"] = "manual"


class AiChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = ""

    @field_validator("content", mode="before")
    @classmethod
    def clean_content(cls, v):
        return sanitize_content(v if v is not None else "") or ""


class AiChatRequest(BaseModel):
    """C2-B: ephemeral multi-turn chat — no server-side transcript store."""
    messages: list[AiChatMessage]
    selection_text: Optional[str] = None
    language: Literal["en", "ar", "tr"] = "en"
    version: int
    # Live editor HTML (sanitized). Falls back to the stored draft body when omitted.
    current_body: Optional[str] = None
    # comment = notes only; revise = replacement text for selection or full body.
    intent: Literal["revise", "comment"] = "revise"

    @field_validator("selection_text", mode="before")
    @classmethod
    def clean_selection(cls, v):
        if v is None:
            return None
        return sanitize_content(v)

    @field_validator("current_body", mode="before")
    @classmethod
    def clean_live_body(cls, v):
        if v is None:
            return None
        return sanitize_body_html(v)


class GenerateDocxRequest(BaseModel):
    """Opt-in for appending reference PDF copies to the generated e-bundle.
    Default True preserves legacy "always attach when refs exist" behavior.
    Persisted on draft.field_values.include_reference_copies for approve.
    """
    include_reference_copies: bool = True


class DraftApprove(BaseModel):
    """Materialization inputs — number/type required to create RFI/corr row.

    parent_id + relation: optional chain link (response / followup / revision).
    Both must be set together, or both omitted (root / original).
    """
    version: int
    document_number: str  # rfi_number or corr_number
    correspondence_date: Optional[date] = None  # letter only; default today
    direction: Optional[Literal["incoming", "outgoing"]] = "outgoing"
    corr_type: Optional[str] = "letter"
    discipline: Optional[str] = None
    parent_id: Optional[UUID] = None
    relation: Optional[Literal["response", "followup", "revision"]] = None

    @field_validator("document_number", "corr_type", "discipline", mode="before")
    @classmethod
    def clean_short(cls, v):
        return sanitize_short(v)
