import logging
from typing import Optional
from fastapi import HTTPException

logger = logging.getLogger(__name__)


class ChronologyService:
    """Chronology of Events otomasyonu.

    Change oluşturulduğunda otomatik chronology açar ve event kaydeder.
    AI narrative önerisi oluşturur, CM onaylayana kadar taslak olarak kalır.
    """

    def __init__(self, db, ai_service=None, audit_service=None):
        self.db = db
        self.ai = ai_service
        self.audit = audit_service

    def auto_create_for_change(
        self,
        change_id: str,
        change_title: str,
        project_id: str,
        created_by: str,
    ) -> dict:
        """Change oluşturulduğunda otomatik çağrılır."""
        existing = (
            self.db.table("chronologies")
            .select("id")
            .eq("entity_type", "change")
            .eq("entity_id", change_id)
            .execute()
        )
        if existing.data:
            return existing.data[0]

        result = self.db.table("chronologies").insert({
            "project_id": project_id,
            "title": f"Chronology — {change_title}",
            "entity_type": "change",
            "entity_id": change_id,
            "created_by": created_by,
        }).execute()

        chronology = result.data[0]

        self.record_event(
            chronology_id=chronology["id"],
            event_type="status_change",
            event_date=None,
            document_ref_id=change_id,
            document_ref_type=None,
            created_by=created_by,
            auto_generate_narrative=False,
            note="Change identified",
        )

        return chronology

    def record_event(
        self,
        chronology_id: str,
        event_type: str,
        event_date,
        document_ref_id: Optional[str] = None,
        document_ref_type: Optional[str] = None,
        created_by: Optional[str] = None,
        auto_generate_narrative: bool = True,
        is_key_event: bool = False,
        note: Optional[str] = None,
        activity_id: Optional[str] = None,
        boq_ref: Optional[str] = None,
        change_context: Optional[dict] = None,
    ) -> dict:
        """Chronology'ye event kaydeder, opsiyonel AI narrative üretir."""
        from datetime import date as date_type
        if event_date is None:
            event_date = date_type.today()

        auto_narrative = None
        if auto_generate_narrative and self.ai is not None:
            try:
                preceding = self._get_preceding_events(chronology_id, limit=5)
                result = self.ai.generate_chronology_narrative(
                    event={"type": event_type, "date": str(event_date), "ref": document_ref_id, "note": note},
                    change_context=change_context or {},
                    preceding_events=preceding,
                )
                auto_narrative = result.narrative_text
            except Exception as exc:
                logger.warning("Narrative üretme hatası: %s", exc)

        event = self.db.table("chronology_events").insert({
            "chronology_id": chronology_id,
            "event_date": str(event_date),
            "event_type": event_type,
            "document_ref_id": document_ref_id,
            "document_ref_type": document_ref_type,
            "is_key_event": is_key_event,
            "auto_narrative": auto_narrative,
            "activity_id": activity_id,
            "boq_ref": boq_ref,
            "created_by": created_by,
        }).execute()

        return event.data[0]

    def approve_narrative(
        self,
        event_id: str,
        approved_narrative: str,
        approved_by: str,
        project_id: str,
    ) -> dict:
        """CM narrative'i onaylar."""
        from datetime import datetime
        result = self.db.table("chronology_events").update({
            "approved_narrative": approved_narrative,
            "narrative_approved_by": approved_by,
            "narrative_approved_at": datetime.utcnow().isoformat(),
        }).eq("id", event_id).execute()

        if not result.data:
            raise HTTPException(404, "Kaynak bulunamadı")

        if self.audit:
            self.audit.log(
                action="approve",
                entity_type="chronology_event",
                entity_id=event_id,
                user_id=approved_by,
                project_id=project_id,
            )

        return result.data[0]

    def inactivate_event(
        self,
        event_id: str,
        user_id: str,
        project_id: str,
        reason: str,
    ) -> dict:
        """Sadece CM rolü çağırabilir. Event silinmez, is_active=False yapılır."""
        from datetime import datetime
        result = self.db.table("chronology_events").update({
            "is_active": False,
            "inactivated_by": user_id,
            "inactivated_at": datetime.utcnow().isoformat(),
            "inactivation_reason": reason,
        }).eq("id", event_id).execute()

        if not result.data:
            raise HTTPException(404, "Kaynak bulunamadı")

        if self.audit:
            self.audit.log(
                action="inactivate",
                entity_type="chronology_event",
                entity_id=event_id,
                user_id=user_id,
                project_id=project_id,
                note=reason,
            )

        return result.data[0]

    def _get_preceding_events(self, chronology_id: str, limit: int = 5) -> list:
        result = (
            self.db.table("chronology_events")
            .select("event_date, event_type, approved_narrative, auto_narrative")
            .eq("chronology_id", chronology_id)
            .eq("is_active", True)
            .order("event_date", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
