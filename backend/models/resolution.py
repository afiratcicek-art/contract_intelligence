from pydantic import BaseModel
from typing import Optional, Literal
from datetime import date
from uuid import UUID


# B3 — Contract & Amendments resolution response models (ADR-013 Stage 1).
# Read-only projection of the CM-confirmed in-force graph. The system does NOT
# infer operativeness: these shapes carry only what registered amendments and
# status='confirmed' overrides assert. changes.status is surfaced RAW (never a
# filter, never relabeled here — the UI maps it via documents.py:833-838).


class AmendmentRef(BaseModel):
    # Provenance for a winning amendment (the "which instrument + why" half).
    id: UUID
    amendment_number: str
    amendment_date: Optional[date] = None
    arrival_path: str


class ClauseResolution(BaseModel):
    # "For clause X, which instrument is in force?" One row per subject_key that
    # has a confirmed override. A targeted subject_key with no override resolves
    # to the contract (governing_instrument='contract', amendment=null).
    subject_key: str
    governing_instrument: Literal["contract", "amendment"]
    amendment: Optional[AmendmentRef] = None
    override_id: Optional[UUID] = None


class ChangeOrderResolution(BaseModel):
    # Per VO: its RAW status + whether a confirmed amendment supersedes it +
    # amendment_pending. status is passed through verbatim (no relabeling).
    change_id: UUID
    change_number: str
    title: str
    status: str
    superseded_by_amendment: Optional[AmendmentRef] = None
    amendment_pending: bool


class ResolutionResponse(BaseModel):
    clauses: list[ClauseResolution]
    change_orders: list[ChangeOrderResolution]
