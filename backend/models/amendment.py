from pydantic import BaseModel, field_validator
from typing import Optional, Literal
from datetime import date
from uuid import UUID
from backend.core.sanitizer import sanitize_short, sanitize_medium


# arrival_path values mirror the DB CHECK in migration 037
# (amendments.arrival_path IN ('letter', 'change_order', 'standalone')) — how the
# employer's instrument reached us. Kept as a Literal so an invalid value is a
# 422 at the edge, not a DB CHECK violation deeper in.
ArrivalPath = Literal["letter", "change_order", "standalone"]


class AmendmentCreate(BaseModel):
    amendment_number: str
    title: str
    description: Optional[str] = None
    amendment_date: Optional[date] = None
    arrival_path: ArrivalPath
    source_pdf_id: Optional[UUID] = None
    source_change_id: Optional[UUID] = None

    @field_validator("amendment_number", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("title", "description", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)


class AmendmentUpdate(BaseModel):
    amendment_number: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    amendment_date: Optional[date] = None
    arrival_path: Optional[ArrivalPath] = None
    source_pdf_id: Optional[UUID] = None
    source_change_id: Optional[UUID] = None

    @field_validator("amendment_number", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)

    @field_validator("title", "description", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)
