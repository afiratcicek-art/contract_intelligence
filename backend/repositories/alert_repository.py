from datetime import date
from typing import Optional
from backend.repositories.base import BaseRepository


class AlertRepository(BaseRepository):
    table_name = "internal_alerts"

    def list_for_user(
        self,
        project_id: str,
        user_role: str,
        user_id: str,
        status: Optional[str] = "pending",
        limit: int = 50,
    ) -> list[dict]:
        """
        Kullanıcının rolüne ve atamasına göre filtrelenmiş
        alert listesi. Sadece action_party = 'us' olanlar.

        Filtre mantığı (DB katmanında OR — uygulama
        katmanında filtreleme yapılmaz):
          - assigned_to_role == user_role  (role atanmış)
          - assigned_to_role == 'any'      (herkese açık)
          - assigned_to_user == user_id    (kişiye atanmış)
          - flagged_by == user_id          (kendinin flaglediği)

        user_role ve user_id verify_project_access tarafından
        doğrulanmış değerlerdir — injection riski yok.
        user_role CHECK constraint ile sınırlı:
        cm | engineer | dcc | viewer
        """
        query = (
            self.db.table("internal_alerts")
            .select(
                "*, project_notice_config"
                "(event_type, label, clause_reference,"
                " notice_period_days)"
            )
            .eq("project_id", project_id)
            .eq("action_party", "us")
            .eq("is_deleted", False)
            .or_(
                f"assigned_to_role.eq.{user_role},"
                f"assigned_to_role.eq.any,"
                f"assigned_to_user.eq.{user_id},"
                f"flagged_by.eq.{user_id}"
            )
            .order("flagged_at", desc=True)
            .limit(limit)
        )
        if status:
            query = query.eq("status", status)
        result = query.execute()
        return result.data or []

    def get_pending_deadlines(
        self, days_ahead: int = 7
    ) -> list[dict]:
        """
        Yaklaşan notice deadline'ları — scheduler için.
        Tüm projeler taranır — admin client gerektirir.
        """
        from datetime import timedelta
        cutoff = (
            date.today() + timedelta(days=days_ahead)
        ).isoformat()
        result = (
            self.db.table("internal_alerts")
            .select("*")
            .eq("status", "pending")
            .eq("is_deleted", False)
            .lte("notice_deadline", cutoff)
            .order("notice_deadline")
            .execute()
        )
        return result.data or []

    def apply_decision(
        self,
        alert_id: str,
        decision: str,
        decided_by: str,
        note: Optional[str],
        snoozed_until: Optional[date],
        expected_version: int,
    ) -> Optional[dict]:
        """
        CM kararını uygular.
        Optimistic locking: version eşleşmezse None döner.
        Caller RaceConditionError fırlatır.
        """
        from datetime import datetime, timezone
        data = {
            "cm_decision": decision,
            "cm_decision_by": decided_by,
            "cm_decision_at": datetime.now(
                timezone.utc
            ).isoformat(),
            "cm_decision_note": note,
            "status": (
                "snoozed" if decision == "snoozed"
                else "actioned"
            ),
            "snoozed_until": snoozed_until.isoformat()
            if snoozed_until else None,
            "version": expected_version + 1,
        }
        result = (
            self.db.table("internal_alerts")
            .update(data)
            .eq("id", alert_id)
            .eq("version", expected_version)
            .execute()
        )
        return result.data[0] if result.data else None
