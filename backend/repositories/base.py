from typing import Optional
from fastapi import HTTPException


class BaseRepository:
    """Tüm repository'ler için ortak CRUD metodları.

    Alt sınıflar table_name ve primary_key sağlamalı.
    Soft delete için is_deleted=True kolonunun tabloda olması gerekir.
    """

    table_name: str = ""
    primary_key: str = "id"
    soft_delete_field: Optional[str] = "is_deleted"

    def __init__(self, db):
        self.db = db

    def get(self, record_id: str) -> Optional[dict]:
        query = self.db.table(self.table_name).select("*").eq(self.primary_key, record_id)
        if self.soft_delete_field:
            query = query.eq(self.soft_delete_field, False)
        result = query.single().execute()
        return result.data if result.data else None

    def get_or_404(self, record_id: str) -> dict:
        record = self.get(record_id)
        if record is None:
            raise HTTPException(404, "Kaynak bulunamadı")
        return record

    def list(
        self,
        filters: Optional[dict] = None,
        order_by: str = "created_at",
        desc: bool = True,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        query = self.db.table(self.table_name).select("*")
        if self.soft_delete_field:
            query = query.eq(self.soft_delete_field, False)
        if filters:
            for key, value in filters.items():
                query = query.eq(key, value)
        query = query.order(order_by, desc=desc).limit(limit).offset(offset)
        result = query.execute()
        return result.data or []

    def create(self, data: dict) -> dict:
        result = self.db.table(self.table_name).insert(data).execute()
        return result.data[0]

    def update(self, record_id: str, data: dict) -> dict:
        result = (
            self.db.table(self.table_name)
            .update(data)
            .eq(self.primary_key, record_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(404, "Kaynak bulunamadı")
        return result.data[0]

    def soft_delete(self, record_id: str, deleted_by: Optional[str] = None) -> None:
        if not self.soft_delete_field:
            raise NotImplementedError("Bu tablo soft delete desteklemiyor")
        from postgrest.types import ReturnMethod
        from backend.database import get_admin_client

        data: dict = {self.soft_delete_field: True}
        if deleted_by:
            data["deleted_by"] = deleted_by
        # Measured (user JWT): UPDATE is_deleted=true → Postgres 42501
        # "new row violates row-level security policy" because SELECT policies
        # require is_deleted=false and Postgres CHECKS the new row on UPDATE.
        # Prefer return=minimal does NOT avoid that check. Callers must authz
        # first (get_or_404 under user RLS); service role then applies the flag.
        admin = get_admin_client()
        (
            admin.table(self.table_name)
            .update(data, returning=ReturnMethod.minimal)
            .eq(self.primary_key, record_id)
            .eq(self.soft_delete_field, False)
            .execute()
        )
