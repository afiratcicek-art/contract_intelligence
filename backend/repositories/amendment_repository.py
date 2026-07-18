from typing import Optional
from backend.repositories.base import BaseRepository


class AmendmentRepository(BaseRepository):
    table_name = "amendments"

    def list_by_project(
        self,
        project_id: str,
        arrival_path: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        query = (
            self.db.table("amendments")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
        )
        if arrival_path:
            query = query.eq("arrival_path", arrival_path)
        # Mirrors CorrespondenceRepository.list_by_project, ordering by the
        # domain date. amendment_date is nullable (migration 037), so NULLs sort
        # per PostgREST's default for DESC; create/get/update/soft_delete are
        # inherited from BaseRepository unchanged (same as CorrespondenceRepository).
        result = query.order("amendment_date", desc=True).limit(limit).offset(offset).execute()
        return result.data or []
