from pydantic import BaseModel, field_validator
from backend.core.sanitizer import sanitize_short, sanitize_medium
from typing import Optional
from datetime import date, datetime
from uuid import UUID


class DocumentMetadataUpdate(BaseModel):
    """User-supplied metadata for a PDF document.
    Applied at upload time (optional) or via PATCH endpoint.
    User input always takes precedence over Haiku extraction.
    Keywords are sanitized individually (max 200 chars each).
    """
    keywords: Optional[list[str]] = None
    location: Optional[str] = None
    doc_date: Optional[date] = None

    @field_validator("keywords", mode="before")
    @classmethod
    def clean_keywords(cls, v):
        if v is None:
            return v
        if not isinstance(v, list):
            raise ValueError("keywords must be a list")
        cleaned = [sanitize_short(str(k)) for k in v if k]
        # Remove duplicates preserving order, max 20 keywords
        seen = set()
        result = []
        for k in cleaned:
            if k and k not in seen:
                seen.add(k)
                result.append(k)
        return result[:20]

    @field_validator("location", mode="before")
    @classmethod
    def clean_location(cls, v):
        if v is None:
            return v
        return sanitize_medium(str(v))


class DocumentMetadataApprove(BaseModel):
    """CM approval of Haiku-extracted metadata.
    Approved values replace the draft extraction.
    """
    keywords: Optional[list[str]] = None
    location: Optional[str] = None
    doc_date: Optional[date] = None

    @field_validator("keywords", mode="before")
    @classmethod
    def clean_keywords(cls, v):
        if v is None:
            return v
        if not isinstance(v, list):
            raise ValueError("keywords must be a list")
        cleaned = [sanitize_short(str(k)) for k in v if k]
        seen = set()
        result = []
        for k in cleaned:
            if k and k not in seen:
                seen.add(k)
                result.append(k)
        return result[:20]

    @field_validator("location", mode="before")
    @classmethod
    def clean_location(cls, v):
        if v is None:
            return v
        return sanitize_medium(str(v))


class DocumentMetadataResponse(BaseModel):
    """Metadata fields returned with document detail."""
    id: UUID
    keywords: list[str] = []
    location: Optional[str] = None
    doc_date: Optional[date] = None
    metadata_status: str
    metadata_source: Optional[str] = None
    metadata_approved_by: Optional[UUID] = None
    metadata_approved_at: Optional[datetime] = None
