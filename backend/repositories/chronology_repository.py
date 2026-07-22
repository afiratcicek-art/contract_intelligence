from typing import Optional
from backend.repositories.base import BaseRepository


class ChronologyRepository(BaseRepository):
    table_name = "chronologies"
    soft_delete_field = None  # Forensic — silinmez, is_active kullanılır

    def get_by_entity(self, entity_type: str, entity_id: str) -> Optional[dict]:
        result = (
            self.db.table("chronologies")
            .select("*")
            .eq("entity_type", entity_type)
            .eq("entity_id", entity_id)
            .single()
            .execute()
        )
        return result.data

    def get_events(
        self,
        chronology_id: str,
        include_inactive: bool = False,
    ) -> list[dict]:
        query = (
            self.db.table("chronology_events")
            .select("*")
            .eq("chronology_id", chronology_id)
        )
        if not include_inactive:
            query = query.eq("is_active", True)
        result = query.order("event_date").execute()
        return result.data or []

    def list_events_by_type(
        self,
        project_id: str,
        event_type: str,
        include_inactive: bool = False,
    ) -> list[dict]:
        # PROJECT-SCOPE INVARIANT: chronology_events has NO project_id column (only chronology_id).
        # Project scope is enforced via the parent chronology join, NOT a direct .eq("project_id").
        # chronologies!inner + .eq("chronologies.project_id", ...) prunes to the caller's project
        # (RLS on chronology_events — migration 002 — is the backstop). Do NOT copy the sibling
        # entities' .eq("project_id") pattern here: that column does not exist on events and would
        # either error or, if the join were dropped, leak cross-project events.
        query = (
            self.db.table("chronology_events")
            .select("*, chronologies!inner(id, title, entity_type)")
            .eq("chronologies.project_id", project_id)
            .eq("event_type", event_type)
        )
        # ACTIVE SEMANTICS deliberately aligned with by_chronology_type (the card's count source):
        # both filter event-level is_active ONLY, never parent chronologies.is_active — kept identical
        # so click-result === card-count. No chronology-level inactivate endpoint exists today, so the
        # parent is always active and a parent filter would be a no-op here. IF chronology-level
        # inactivate is ever added, BOTH this method AND by_chronology_type must gain
        # .eq("chronologies.is_active", True) TOGETHER — else retired-parent events leak here and the
        # count diverges (parent-lifecycle → child-visibility, cf. the amendment-lifecycle fix). TB-30
        if not include_inactive:
            query = query.eq("is_active", True)
        result = query.order("event_date").execute()
        return result.data or []

    def list_by_project(self, project_id: str) -> list[dict]:
        """Simple chronology list — no events included.
        Use list_chronologies endpoint for event counts.
        """
        result = (
            self.db.table("chronologies")
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []
