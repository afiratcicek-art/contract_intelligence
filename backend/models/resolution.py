from pydantic import BaseModel
from typing import Optional, Literal
from datetime import date
from uuid import UUID
from backend.models.common import ContractType


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


# ── Hierarchy root (ADR-014) ────────────────────────────────────────────────
# The In-Force view is DOCUMENT-CENTRIC (Ali's ruling 2026-07-20: "madde madde
# değil, belge belge"): the base contract is the ROOT of the hierarchy, with
# amendments and change orders as document-level entries beneath it. clauses[]
# stays in the payload as the underlying engine (drill-down / future RAG), but
# it is no longer the dashboard's primary rendering.


class ContractPartyRef(BaseModel):
    role: str
    name: str


class ContractDocumentRef(BaseModel):
    # One constituent document / annex (ek) of the contract, with its bespoke
    # precedence. pdf_document_id is nullable (migration 040): an annex may be
    # registered as a label before its file arrives; the row survives if the
    # file is later removed (ON DELETE SET NULL).
    id: UUID
    pdf_document_id: Optional[UUID] = None
    label: Optional[str] = None
    precedence_rank: Optional[int] = None   # 1 = highest; None = unranked
    original_filename: Optional[str] = None  # display + click-through


class ContractRoot(BaseModel):
    id: UUID
    title: str
    contract_number: Optional[str] = None
    description: Optional[str] = None
    # Same vocabulary as projects.contract_type / ContractType (migration 042;
    # TB-28 dual-source with projects).
    contract_type: Optional[ContractType] = None
    # dlp_days is the DLP's LENGTH only — its window derives from ACTUAL
    # completion (dynamic), never stored (ADR-014 term decision).
    commencement_date: Optional[date] = None
    duration_days: Optional[int] = None
    dlp_days: Optional[int] = None
    parties: list[ContractPartyRef] = []
    documents: list[ContractDocumentRef] = []


class InForceAmendment(BaseModel):
    # Document-level amendment card for the hierarchy (contrast AmendmentRef,
    # which is per-clause provenance). A REGISTERED amendment is a CM-confirmed
    # fact, so every non-deleted amendment appears here.
    id: UUID
    amendment_number: str
    title: str
    amendment_date: Optional[date] = None
    arrival_path: str
    source_pdf_id: Optional[UUID] = None


class ResolutionResponse(BaseModel):
    # contract=None means "not yet registered" — the UI renders the HITL
    # registration prompt, it does NOT invent a synthetic root.
    contract: Optional[ContractRoot] = None
    amendments: list[InForceAmendment] = []
    clauses: list[ClauseResolution]
    change_orders: list[ChangeOrderResolution]
