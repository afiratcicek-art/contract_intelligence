from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from backend.core.dependencies import verify_project_access, require_cm_role
from backend.services.audit_service import AuditService

router = APIRouter(prefix="/projects/{project_id}/config", tags=["config"])


class ProjectConfigUpdate(BaseModel):
    notice_day_type: Optional[str] = None
    rfi_day_type: Optional[str] = None
    correspondence_day_type: Optional[str] = None
    notice_period_days: Optional[int] = None
    rfi_response_days: Optional[int] = None
    teamul_warning: Optional[bool] = None
    pm_approval_required: Optional[bool] = None
    pm_approval_types: Optional[list[str]] = None
    cm_can_proxy_pm: Optional[bool] = None
    active_corr_types: Optional[list[str]] = None
    employer_ref: Optional[str] = None
    engineer_ref: Optional[str] = None
    contractor_ref: Optional[str] = None


class CalendarConfigCreate(BaseModel):
    country_code: str
    year: int
    weekend_days: Optional[list[int]] = None
    public_holidays: Optional[list[str]] = None
    working_day_def: str = "business"
    is_default: bool = False


@router.get("")
def get_config(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    result = (
        db.table("project_config")
        .select("*")
        .eq("project_id", str(project_id))
        .single()
        .execute()
    )
    return result.data


@router.put("")
def update_config(
    project_id: UUID,
    body: ProjectConfigUpdate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    audit = AuditService()
    data = body.model_dump(mode="json", exclude_none=True)

    existing = (
        db.table("project_config")
        .select("id")
        .eq("project_id", str(project_id))
        .single()
        .execute()
    )

    if existing.data:
        result = (
            db.table("project_config")
            .update(data)
            .eq("project_id", str(project_id))
            .execute()
        )
    else:
        data["project_id"] = str(project_id)
        result = db.table("project_config").insert(data).execute()

    audit.log(
        action="update", entity_type="project_config", entity_id=str(project_id),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value=data,
    )
    return result.data[0] if result.data else {}


@router.get("/calendar")
def list_calendar_configs(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    result = (
        db.table("calendar_config")
        .select("*")
        .eq("project_id", str(project_id))
        .execute()
    )
    return result.data or []


@router.post("/calendar", status_code=201)
def add_calendar_config(
    project_id: UUID,
    body: CalendarConfigCreate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    data = body.model_dump(mode="json")
    data["project_id"] = str(project_id)
    result = db.table("calendar_config").insert(data).execute()
    audit = AuditService()
    audit.log(
        action="create", entity_type="calendar_config",
        entity_id=result.data[0].get("id", str(project_id)),
        user_id=access["user"]["id"], project_id=str(project_id),
        new_value={"country_code": data.get("country_code"), "year": data.get("year")},
    )
    return result.data[0]
