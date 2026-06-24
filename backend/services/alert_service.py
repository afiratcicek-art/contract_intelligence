"""
Alert servisi — internal_alerts yönetimi.
LLM KULLANMAZ. Deterministic deadline hesaplama.
Chronology tablosuna ASLA yazmaz.
"""
import logging
from datetime import date
from typing import Optional

from backend.models.alert import AlertActionCreate
from backend.repositories.alert_repository import AlertRepository
from backend.services.audit_service import AuditService
from backend.services.deadline_service import DeadlineService
from backend.database import get_admin_client

logger = logging.getLogger(__name__)


class AlertService:

    def __init__(self, db):
        self.db = db
        self._alert_repo = AlertRepository(db)
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
        assigned_to_user: Optional[str],
        calendar_config: Optional[dict] = None,
    ) -> dict:
        """
        Mühendis/mimarın 'Potential Impact' flag etmesiyle
        oluşturulan alert.
        Deadline hesabı deterministik — LLM yok.
        """
        # Deadline hesabı: source entity tarihinden itibaren
        # notice_start_date kullanıcıdan alınmaz —
        # backend source entity created_at/submitted_date kullanır
        notice_deadline = None
        if notice_config_id:
            config = (
                get_admin_client()
                .table("project_notice_config")
                .select("notice_period_days, day_type")
                .eq("id", notice_config_id)
                .single()
                .execute()
            )
            if config.data:
                # Source entity tarihini al
                source_date = self._get_source_date(
                    source_entity_type, source_entity_id
                )
                if source_date:
                    notice_deadline = self._deadline.calculate_deadline(
                        start_date=source_date,
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
            "assigned_to_role": "any" if not assigned_to_user else None,
            "assigned_to_user": assigned_to_user,
            "source_entity_type": source_entity_type,
            "source_entity_id": source_entity_id,
            "flagged_by": flagged_by,
            "narrative": narrative,
            "notice_config_id": notice_config_id,
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

    def list_alerts(
        self,
        project_id: str,
        user_role: str,
        user_id: str,
        status: Optional[str] = "pending",
        limit: int = 50,
    ) -> list[dict]:
        """Role-filtered alert list for current user."""
        return self._alert_repo.list_for_user(
            project_id=project_id,
            user_role=user_role,
            user_id=user_id,
            status=status,
            limit=limit,
        )

    def get_alert(
        self,
        alert_id: str,
        project_id: str,
    ) -> Optional[dict]:
        """
        Get single alert.
        Returns None if not found or project mismatch.
        """
        alert = self._alert_repo.get(alert_id)
        if not alert or alert.get("project_id") != project_id:
            return None
        return alert

    def create_action(
        self,
        project_id: str,
        alert_id: str,
        body: AlertActionCreate,
        current_user: dict,
    ) -> dict:
        """Create a note or assignment action on an alert."""
        body.validate_type_fields()
        action = self._alert_repo.create_action(
            alert_id=alert_id,
            action_type=body.action_type,
            created_by=str(current_user["id"]),
            note=body.note,
            assigned_to_user=str(body.assigned_to_user)
            if body.assigned_to_user else None,
            assigned_to_role=body.assigned_to_role,
            due_date=body.due_date,
        )
        self._audit.log(
            project_id=project_id,
            user_id=str(current_user["id"]),
            action="alert_action_created",
            entity_type="internal_alert",
            entity_id=alert_id,
            new_value={"action_type": body.action_type},
        )
        return action

    def list_actions(self, alert_id: str) -> list[dict]:
        """Return active actions for an alert."""
        return self._alert_repo.list_actions(alert_id)

    def link_document(
        self,
        project_id: str,
        alert_id: str,
        document_id: str,
        current_user: dict,
    ) -> dict:
        """Link an existing pdf_document to an alert."""
        result = self._alert_repo.link_document(
            alert_id=alert_id,
            document_id=document_id,
            uploaded_by=str(current_user["id"]),
        )
        self._audit.log(
            project_id=project_id,
            user_id=str(current_user["id"]),
            action="alert_document_linked",
            entity_type="internal_alert",
            entity_id=alert_id,
            new_value={"document_id": document_id},
        )
        return result

    def list_documents(self, alert_id: str) -> list[dict]:
        """Return active documents linked to an alert."""
        return self._alert_repo.list_documents(alert_id)

    def _get_source_date(
        self, entity_type: str, entity_id: str
    ) -> Optional[date]:
        """
        Source entity'nin tarihini döndürür.
        RFI → submitted_date
        Correspondence → correspondence_date
        Tarih bulunamazsa None döner — deadline hesaplanamaz.
        """
        try:
            if entity_type == "rfi":
                result = (
                    get_admin_client()
                    .table("rfis")
                    .select("submitted_date")
                    .eq("id", entity_id)
                    .single()
                    .execute()
                )
                if result.data and result.data.get("submitted_date"):
                    from datetime import date as date_type
                    return date_type.fromisoformat(
                        result.data["submitted_date"]
                    )
            elif entity_type == "correspondence":
                result = (
                    get_admin_client()
                    .table("correspondences")
                    .select("correspondence_date")
                    .eq("id", entity_id)
                    .single()
                    .execute()
                )
                if result.data and result.data.get("correspondence_date"):
                    from datetime import date as date_type
                    return date_type.fromisoformat(
                        result.data["correspondence_date"]
                    )
        except Exception as exc:
            logger.warning(
                "Source date alınamadı: %s | %s | %s",
                entity_type, entity_id, exc
            )
        return None

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
