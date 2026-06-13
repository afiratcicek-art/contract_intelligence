import logging
from typing import Optional

logger = logging.getLogger(__name__)


class NotificationService:
    """Platform içi bildirim servisi.

    V1: Sadece logging. V1.5'te gerçek bildirim tablosu eklenecek.
    """

    def __init__(self, db=None):
        self.db = db

    def notify_deadline_approaching(
        self,
        entity_type: str,
        entity_id: str,
        days_remaining: int,
        assigned_to: str,
        project_id: Optional[str] = None,
    ) -> None:
        if days_remaining <= 3:
            urgency = "ACIL"
        elif days_remaining <= 7:
            urgency = "UYARI"
        else:
            return

        logger.warning(
            "Deadline %s: %s=%s days=%d user=%s project=%s",
            urgency, entity_type, entity_id, days_remaining, assigned_to, project_id,
        )

    def notify_approval_required(
        self,
        entity_type: str,
        entity_id: str,
        approver_id: str,
        requested_by: str,
        project_id: Optional[str] = None,
    ) -> None:
        logger.info(
            "Onay gerekli: %s=%s approver=%s by=%s project=%s",
            entity_type, entity_id, approver_id, requested_by, project_id,
        )

    def notify_pm_proxy_used(
        self,
        entity_id: str,
        pm_id: str,
        proxied_by: str,
        project_id: Optional[str] = None,
    ) -> None:
        logger.info(
            "PM proxy kullanıldı: entity=%s pm=%s by=%s project=%s",
            entity_id, pm_id, proxied_by, project_id,
        )
