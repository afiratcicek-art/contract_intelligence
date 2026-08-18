"""Project Intelligence ask — request/response models (MVP)."""
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from backend.core.sanitizer import sanitize_content, sanitize_medium


class IntelligenceMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)

    @field_validator("content", mode="before")
    @classmethod
    def clean_content(cls, v):
        return sanitize_content(v) or ""


class IntelligenceAskRequest(BaseModel):
    question: str = Field(max_length=4000)
    messages: list[IntelligenceMessage] = Field(default_factory=list, max_length=50)
    language: Literal["en", "tr", "ar"] = "en"

    @field_validator("question", mode="before")
    @classmethod
    def clean_question(cls, v):
        return sanitize_medium(v) or ""


class IntelligenceCitation(BaseModel):
    index: int
    entity_type: Literal["correspondence", "rfi", "change", "deliverable"]
    entity_id: UUID
    ref: str
    subject: str
    date: Optional[str] = None
    status: Optional[str] = None


class IntelligenceAskResponse(BaseModel):
    answer_text: str
    citations: list[IntelligenceCitation] = Field(default_factory=list)
    confidence_score: float = 0.0
    warnings: list[str] = Field(default_factory=list)
    review_required: bool = True
    objectivity_flag: bool = False
    retrieval_mode: Literal["keyword"] = "keyword"
    source_count: int = 0
