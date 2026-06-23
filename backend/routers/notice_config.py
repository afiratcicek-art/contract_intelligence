from fastapi import APIRouter, Depends
from uuid import UUID

from backend.core.dependencies import verify_project_access, require_cm_role
from backend.models.alert import NoticeConfigCreate, NoticeConfigUpdate
from backend.repositories.notice_config_repository import NoticeConfigRepository
from backend.services.audit_service import AuditService

router = APIRouter(
    prefix="/projects/{project_id}/notice-config",
    tags=["notice-config"],
)

# Varsayılan FIDIC notice period'ları
# Proje kurulumunda bu değerler yüklenir, CM override edebilir
FIDIC_DEFAULTS = [
    {
        "event_type": "employer_instruction",
        "label": "Employer Instruction",
        "clause_reference": "FIDIC 3.5 / 20.1",
        "notice_period_days": 28,
        "day_type": "calendar",
    },
    {
        "event_type": "unforeseeable_condition",
        "label": "Unforeseeable Physical Condition",
        "clause_reference": "FIDIC 4.12 / 20.1",
        "notice_period_days": 28,
        "day_type": "calendar",
    },
    {
        "event_type": "extension_of_time",
        "label": "Extension of Time",
        "clause_reference": "FIDIC 8.4 / 20.1",
        "notice_period_days": 28,
        "day_type": "calendar",
    },
    {
        "event_type": "variation",
        "label": "Variation / Change Order",
        "clause_reference": "FIDIC 13.3",
        "notice_period_days": 14,
        "day_type": "calendar",
    },
    {
        "event_type": "suspension",
        "label": "Suspension of Works",
        "clause_reference": "FIDIC 8.11 / 20.1",
        "notice_period_days": 28,
        "day_type": "calendar",
    },
]


@router.get("")
def list_notice_configs(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """Projeye ait notice period tanımlarını listeler."""
    db = access["db"]
    repo = NoticeConfigRepository(db)
    return repo.list_by_project(str(project_id))


@router.post("/initialize", status_code=201)
def initialize_defaults(
    project_id: UUID,
    access: dict = Depends(require_cm_role),
):
    """
    Proje kurulumunda FIDIC varsayılan notice period'larını yükler.
    Mevcut kayıtların üzerine yazmaz — sadece eksik olanları ekler.
    """
    db = access["db"]
    repo = NoticeConfigRepository(db)
    audit = AuditService()
    created = []
    for default in FIDIC_DEFAULTS:
        existing = repo.get_by_event_type(
            str(project_id), default["event_type"]
        )
        if not existing:
            default["created_by"] = str(access["user"]["id"])
            record = repo.upsert(str(project_id), default.copy())
            created.append(record)
    audit.log(
        action="create",
        entity_type="project_notice_config",
        entity_id=str(project_id),
        user_id=str(access["user"]["id"]),
        project_id=str(project_id),
        new_value={"initialized": len(created)},
    )
    return {"initialized": len(created), "configs": created}


@router.put("/{config_id}")
def update_notice_config(
    project_id: UUID,
    config_id: UUID,
    body: NoticeConfigUpdate,
    access: dict = Depends(require_cm_role),
):
    """CM notice period'u override eder."""
    db = access["db"]
    repo = NoticeConfigRepository(db)
    audit = AuditService()
    data = body.model_dump(mode="json", exclude_none=True)
    result = repo.update(str(config_id), data)
    audit.log(
        action="update",
        entity_type="project_notice_config",
        entity_id=str(config_id),
        user_id=str(access["user"]["id"]),
        project_id=str(project_id),
        new_value=data,
    )
    return result


@router.post("", status_code=201)
def add_custom_notice_config(
    project_id: UUID,
    body: NoticeConfigCreate,
    access: dict = Depends(require_cm_role),
):
    """CM özel notice period ekler (bespoke kontrat için)."""
    db = access["db"]
    repo = NoticeConfigRepository(db)
    audit = AuditService()
    data = body.model_dump(mode="json", exclude_none=True)
    data["created_by"] = str(access["user"]["id"])
    result = repo.upsert(str(project_id), data)
    audit.log(
        action="create",
        entity_type="project_notice_config",
        entity_id=result["id"],
        user_id=str(access["user"]["id"]),
        project_id=str(project_id),
        new_value=data,
    )
    return result
