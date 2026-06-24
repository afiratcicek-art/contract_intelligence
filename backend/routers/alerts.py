from fastapi import APIRouter, Depends, Query
from typing import Optional
from uuid import UUID

from backend.core.dependencies import (
    verify_project_access,
    require_permission,
)
from backend.core.exceptions import NotFoundError
from backend.models.alert import AlertCreate, AlertDecision
from backend.services.alert_service import AlertService
from backend.services.deadline_service import DeadlineService

router = APIRouter(
    prefix="/projects/{project_id}/alerts",
    tags=["alerts"],
)


@router.get("")
def list_alerts(
    project_id: UUID,
    status: Optional[str] = Query("pending"),
    limit: int = Query(50, le=200),
    access: dict = Depends(verify_project_access),
):
    """
    Kullanıcının rolüne göre filtrelenmiş alert listesi.
    Sadece action_party = 'us' ve kullanıcıya atanmış
    alertlar döner. Filtre DB katmanında uygulanır.
    """
    db = access["db"]
    user = access["user"]
    svc = AlertService(db)
    return svc._alert_repo.list_for_user(
        project_id=str(project_id),
        user_role=access["member"]["project_role"],
        user_id=str(user["id"]),
        status=status,
        limit=limit,
    )


@router.get("/count")
def alert_count(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """
    Sidebar badge için bekleyen alert sayısı.
    Liste endpoint'i ile aynı filtre mantığı.
    """
    db = access["db"]
    user = access["user"]
    svc = AlertService(db)
    alerts = svc._alert_repo.list_for_user(
        project_id=str(project_id),
        user_role=access["member"]["project_role"],
        user_id=str(user["id"]),
        status="pending",
        limit=200,
    )
    return {"count": len(alerts)}


@router.post("", status_code=201)
def create_alert(
    project_id: UUID,
    body: AlertCreate,
    access: dict = Depends(verify_project_access),
):
    """
    Potential Impact flag veya sistem alertı oluşturur.
    Viewer rolü flag koyamaz.
    Deadline hesabı deterministik — LLM kullanılmaz.
    """
    if access["member"]["project_role"] == "viewer":
        raise NotFoundError()

    db = access["db"]
    user_id = str(access["user"]["id"])

    _, calendar_config = DeadlineService.fetch_configs(
        db, str(project_id)
    )

    svc = AlertService(db)
    return svc.create_potential_impact_alert(
        project_id=str(project_id),
        flagged_by=user_id,
        source_entity_type=body.source_entity_type,
        source_entity_id=str(body.source_entity_id)
        if body.source_entity_id else None,
        narrative=body.narrative or "",
        notice_config_id=str(body.notice_config_id)
        if body.notice_config_id else None,
        assigned_to_user=str(body.assigned_to_user)
        if body.assigned_to_user else None,
        document_references=[str(d) for d in body.document_references]
        if body.document_references else None,
        calendar_config=calendar_config,
    )


@router.get("/{alert_id}")
def get_alert(
    project_id: UUID,
    alert_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """
    Tek alert detayı.
    Proje izolasyonu: project_id eşleşmezse 404.
    """
    db = access["db"]
    svc = AlertService(db)
    alert = svc._alert_repo.get(str(alert_id))
    if not alert or alert.get("project_id") != str(project_id):
        raise NotFoundError()
    return alert


@router.post("/{alert_id}/decision", status_code=200)
def apply_decision(
    project_id: UUID,
    alert_id: UUID,
    body: AlertDecision,
    access: dict = Depends(
        require_permission("internal_alerts", "approve")
    ),
):
    """
    CM kararı uygular.
    İzin verilen kararlar:
      notice_written | moved_to_changes |
      snoozed | dismissed | no_action_required
    Sadece CM rolü (require_permission ile korunuyor).
    Optimistic locking: version çakışmasında 409.
    """
    db = access["db"]
    user_id = str(access["user"]["id"])
    svc = AlertService(db)
    return svc.apply_decision(
        alert_id=str(alert_id),
        project_id=str(project_id),
        decision=body.cm_decision,
        decided_by=user_id,
        note=body.cm_decision_note,
        snoozed_until=body.snoozed_until,
        expected_version=body.version,
    )
