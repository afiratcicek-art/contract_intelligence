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

    def create_action(
        self,
        alert_id: str,
        action_type: str,
        created_by: str,
        note: str | None = None,
        assigned_to_user: str | None = None,
        assigned_to_role: str | None = None,
        due_date=None,
    ) -> dict:
        """Insert into alert_actions, return created row."""
        payload = {
            "alert_id": alert_id,
            "action_type": action_type,
            "created_by": created_by,
            "note": note,
            "assigned_to_user": assigned_to_user,
            "assigned_to_role": assigned_to_role,
            "due_date": str(due_date) if due_date else None,
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        res = self.db.table("alert_actions").insert(payload).execute()
        return res.data[0]

    def list_actions(self, alert_id: str) -> list[dict]:
        """List active actions for an alert, oldest first."""
        res = (
            self.db.table("alert_actions")
            .select("*")
            .eq("alert_id", alert_id)
            .eq("is_deleted", False)
            .order("created_at", desc=False)
            .execute()
        )
        return res.data or []

    def link_document(
        self,
        alert_id: str,
        document_id: str,
        uploaded_by: str,
    ) -> dict:
        """Insert into alert_documents junction table."""
        res = (
            self.db.table("alert_documents")
            .insert({
                "alert_id": alert_id,
                "document_id": document_id,
                "uploaded_by": uploaded_by,
            })
            .execute()
        )
        return res.data[0]

    def list_documents(self, alert_id: str) -> list[dict]:
        """List active documents linked to an alert."""
        res = (
            self.db.table("alert_documents")
            .select("*, pdf_document(*)")
            .eq("alert_id", alert_id)
            .eq("is_deleted", False)
            .order("uploaded_at", desc=False)
            .execute()
        )
        return res.data or []

    def mark_as_read(
        self, alert_id: str, user_id: str
    ) -> dict:
        """
        Mark alert as read for a specific user.
        Uses UPSERT — safe to call multiple times.
        Returns the alert_reads row.
        """
        res = (
            self.db.table("alert_reads")
            .upsert(
                {"alert_id": alert_id, "user_id": user_id},
                on_conflict="alert_id,user_id",
            )
            .execute()
        )
        return res.data[0] if res.data else {}

    def get_read_alert_ids(
        self, user_id: str, alert_ids: list[str]
    ) -> set[str]:
        """
        Return set of alert_ids already read by this user
        from the given list. Used to compute unread count.
        """
        if not alert_ids:
            return set()
        res = (
            self.db.table("alert_reads")
            .select("alert_id")
            .eq("user_id", user_id)
            .in_("alert_id", alert_ids)
            .execute()
        )
        return {row["alert_id"] for row in (res.data or [])}
