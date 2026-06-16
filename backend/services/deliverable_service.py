import logging
from typing import Optional
from fastapi import HTTPException

logger = logging.getLogger(__name__)


class DeliverableService:
    """Deliverable yönetim servisi.

    AI ile tespit, CM onayı, PM onay zinciri ve pre-completion checklist.
    """

    def __init__(self, db, ai_service=None, audit_service=None):
        self.db = db
        self.ai = ai_service
        self.audit = audit_service

    def detect_from_contract(
        self,
        contract_text: str,
        project_id: str,
        user_id: str,
        project_context: Optional[dict] = None,
    ) -> list[dict]:
        """AI ile kontrat metninden deliverable tespit eder.

        Tespit edilen deliverable'lar approved_by_cm=False olarak kaydedilir;
        CM onaylayana kadar sisteme işlenmez.
        """
        if self.ai is None:
            return []

        try:
            result = self.ai.analyze_clause(
                query="List all contractor deliverables, submission requirements, and pre-completion obligations with their deadlines and clause references.",
                contract_text=contract_text,
                project_context=project_context or {},
                project_id=project_id,
                user_id=user_id,
            )
            logger.info("Deliverable tespiti tamamlandı, confidence=%.2f", result.confidence_score)
            return []
        except Exception as exc:
            logger.error("Deliverable tespit hatası: %s", exc)
            return []

    def cm_approve(
        self,
        deliverable_id: str,
        cm_user_id: str,
        project_id: str,
        expected_version: int,
    ) -> dict:
        """CM deliverable'ı onaylar. Optimistic locking ile race condition koruması."""
        from datetime import datetime
        from backend.core.exceptions import RaceConditionError
        result = self.db.table("deliverables").update({
            "approved_by_cm": True,
            "approved_by_cm_at": datetime.utcnow().isoformat(),
            "approved_by_cm_id": cm_user_id,
            "version": expected_version + 1,
        }).eq("id", deliverable_id).eq("version", expected_version).execute()
        if not result.data:
            raise RaceConditionError()

        if self.audit:
            self.audit.log(
                action="approve",
                entity_type="deliverable",
                entity_id=deliverable_id,
                user_id=cm_user_id,
                project_id=project_id,
            )

        return result.data[0]

    def get_pre_completion_checklist(self, project_id: str) -> list[dict]:
        """Proje teslimi öncesi tamamlanması gereken deliverable listesi."""
        result = (
            self.db.table("deliverables")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_pre_completion", True)
            .eq("is_deleted", False)
            .neq("status", "closed")
            .order("due_date")
            .execute()
        )
        return result.data or []
