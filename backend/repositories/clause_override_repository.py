from backend.repositories.base import BaseRepository


class ClauseOverrideRepository(BaseRepository):
    table_name = "clause_overrides"
    # EK-15: clause_overrides has NO is_deleted column (migration 037 — an
    # override is created then moved through status; removal = status='rejected',
    # not soft-delete). soft_delete_field = None disables BaseRepository's
    # is_deleted filter in get()/list(), both of which guard it behind
    # `if self.soft_delete_field` (base.py:21,41). soft_delete() is never used here.
    soft_delete_field = None

    def list_by_amendment(
        self,
        project_id: str,
        amendment_id: str,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        result = (
            self.db.table("clause_overrides")
            .select("*")
            .eq("project_id", project_id)
            .eq("overriding_amendment_id", amendment_id)
            .order("created_at", desc=True)
            .limit(limit)
            .offset(offset)
            .execute()
        )
        return result.data or []
