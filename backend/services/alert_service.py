"""
Alert servisi — internal_alerts yönetimi.
LLM KULLANMAZ. Deterministic deadline hesaplama.
Chronology tablosuna ASLA yazmaz.
"""
import logging
from datetime import date
from typing import Optional
from uuid import uuid4

from backend.repositories.alert_repository import AlertRepository
from backend.repositories.notice_config_repository import NoticeConfigRepository
from backend.services.audit_service import AuditService
from backend.services.deadline_service import DeadlineService
from backend.database import get_admin_client

logger = logging.getLogger(__name__)


class AlertService:

    def __init__(self, db):
        self.db = db
        self._alert_repo = AlertRepository(db)
        self._config_repo = NoticeConfigRepository(db)
        self._audit = AuditService()
        self._deadline = DeadlineService()

    def create_potential_impact_alert(
        self,
        project_id: str,
        flagged_by: str,
        source_entity_type: str,
        source_entity_id: str,
        narrative: str,
        notice_config_id: Optional[str],
        notice_start_date: Optional[date],
        calendar_config: Optional[dict] = None,
    ) -> dict:
        """
        Mühendis/mimarın 'Potential Impact' flag etmesiyle
        oluşturulan alert.
        Deadline hesabı deterministik — LLM yok.
        """
        notice_deadline = None
        if notice_config_id and notice_start_date:
            config = (
                get_admin_client()
                .table("project_notice_config")
                .select("notice_period_days, day_type")
                .eq("id", notice_config_id)
                .single()
                .execute()
            )
            if config.data:
                notice_deadline = self._deadline.calculate_deadline(
                    start_date=notice_start_date,
                    period_days=config.data["notice_period_days"],
                    day_type=config.data["day_type"],
                    calendar_config=calendar_config,
                )

        data = {
            "project_id": project_id,
            "alert_type": "potential_impact",
            "status": "pending",
            "priority": self._calculate_priority(notice_deadline),
            "action_party": "us",
            "assigned_to_role": "cm",
            "source_entity_type": source_entity_type,
            "source_entity_id": source_entity_id,
            "flagged_by": flagged_by,
            "narrative": narrative,
            "notice_config_id": notice_config_id,
            "notice_start_date": notice_start_date.isoformat()
            if notice_start_date else None,
            "notice_deadline": notice_deadline.isoformat()
            if notice_deadline else None,
        }

        alert = self._alert_repo.create(data)

        self._audit.log(
            action="alert_created",
            entity_type="internal_alerts",
            entity_id=alert["id"],
            user_id=flagged_by,
            project_id=project_id,
            new_value={
                "alert_type": "potential_impact",
                "source": f"{source_entity_type}:{source_entity_id}",
                "notice_deadline": str(notice_deadline)
                if notice_deadline else None,
            },
        )

        return alert

    def apply_decision(
        self,
        alert_id: str,
        project_id: str,
        decision: str,
        decided_by: str,
        note: Optional[str],
        snoozed_until: Optional[date],
        expected_version: int,
    ) -> dict:
        """CM kararını uygular."""
        result = self._alert_repo.apply_decision(
            alert_id=alert_id,
            decision=decision,
            decided_by=decided_by,
            note=note,
            snoozed_until=snoozed_until,
            expected_version=expected_version,
        )
        if result is None:
            from backend.core.exceptions import RaceConditionError
            raise RaceConditionError()

        self._audit.log(
            action="alert_actioned",
            entity_type="internal_alerts",
            entity_id=alert_id,
            user_id=decided_by,
            project_id=project_id,
            new_value={"decision": decision, "note": note},
        )
        return result

    def _calculate_priority(
        self, notice_deadline: Optional[date]
    ) -> str:
        """Deadline'a göre öncelik hesapla — deterministik."""
        if not notice_deadline:
            return "normal"
        days_remaining = (notice_deadline - date.today()).days
        if days_remaining <= 3:
            return "critical"
        if days_remaining <= 7:
            return "high"
        return "normal"
