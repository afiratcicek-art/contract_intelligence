from pydantic import BaseModel, field_validator
from backend.core.sanitizer import sanitize_short, sanitize_medium
from typing import Optional
from datetime import date, datetime
from uuid import UUID
from backend.models.common import ProjectRole, ContractType, ProjectStatus


# ── Profiles ───────────────────────────────────────────────────────────────

class ProfileCreate(BaseModel):
    full_name: str
    email: str
    company: Optional[str] = None


class ProfileResponse(BaseModel):
    id: UUID
    full_name: str
    email: str
    system_role: str
    company: Optional[str] = None
    tenant_id: UUID
    is_active: bool
    created_at: datetime


# ── Projects ───────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    contract_type: Optional[ContractType] = None
    contract_value: Optional[float] = None
    currency: str = "USD"
    employer_name: str
    contractor_name: str
    engineer_name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None

    @field_validator("name", "employer_name", "contractor_name",
                     "engineer_name", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)

    @field_validator("currency", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    contract_type: Optional[ContractType] = None
    contract_value: Optional[float] = None
    currency: Optional[str] = None
    employer_name: Optional[str] = None
    contractor_name: Optional[str] = None
    engineer_name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[ProjectStatus] = None

    @field_validator("name", "employer_name", "contractor_name",
                     "engineer_name", mode="before")
    @classmethod
    def clean_medium_fields(cls, v): return sanitize_medium(v)

    @field_validator("currency", mode="before")
    @classmethod
    def clean_short_fields(cls, v): return sanitize_short(v)


class ProjectResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    contract_type: Optional[str] = None
    contract_value: Optional[float] = None
    currency: str
    employer_name: str
    contractor_name: str
    engineer_name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: str
    created_by: Optional[UUID] = None
    created_at: datetime


# ── Project Members ────────────────────────────────────────────────────────

class ProjectMemberAdd(BaseModel):
    user_id: UUID
    project_role: ProjectRole
    can_approve: bool = False
    can_publish: bool = False


class ProjectMemberUpdate(BaseModel):
    project_role: Optional[ProjectRole] = None
    can_approve: Optional[bool] = None
    can_publish: Optional[bool] = None
    is_active: Optional[bool] = None


class ProjectMemberResponse(BaseModel):
    id: UUID
    project_id: UUID
    user_id: UUID
    project_role: str
    can_approve: bool
    can_publish: bool
    is_active: bool
    joined_at: datetime


# ── Project Parties ────────────────────────────────────────────────────────

class ProjectPartyCreate(BaseModel):
    party_name: str
    party_type: Optional[str] = None

    @field_validator("party_name", mode="before")
    @classmethod
    def clean_party_name(cls, v): return sanitize_medium(v)

    @field_validator("party_type", mode="before")
    @classmethod
    def clean_party_type(cls, v): return sanitize_short(v)


class ProjectPartyResponse(BaseModel):
    id: UUID
    project_id: UUID
    party_name: str
    party_type: Optional[str] = None
    is_active: bool
    added_at: datetime
