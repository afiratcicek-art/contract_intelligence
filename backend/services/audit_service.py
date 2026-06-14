import logging
from typing import Optional

logger = logging.getLogger(__name__)


class AuditService:
    """INSERT-only audit log servisi.

    audit_log tablosunda RLS aktif, INSERT policy yok.
    Tüm yazma işlemleri service_role (admin) client ile yapılır.
    RLS bypass için get_admin_client() singleton'ı kullanılır.

    db parametresi backward compatibility için korunmuştur
    ancak kullanılmamaktadır — admin client her zaman
    get_admin_client() singleton'ından alınır.
    """

    def __init__(self, db=None):
        from backend.database import get_admin_client
        self._db = get_admin_client()

    def log(
        self,
        action: str,
        entity_type: str,
        entity_id: str,
        user_id: Optional[str] = None,
        project_id: Optional[str] = None,
        old_value: Optional[dict] = None,
        new_value: Optional[dict] = None,
        note: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> None:
        """Audit kaydı oluşturur. Hata durumunda sistemi
        durdurmaz, sadece loglar."""
        try:
            self._db.table("audit_log").insert({
                "user_id":     user_id,
                "project_id":  project_id,
                "action":      action,
                "entity_type": entity_type,
                "entity_id":   entity_id,
                "old_value":   old_value,
                "new_value":   new_value,
                "note":        note,
                "ip_address":  ip_address,
            }).execute()
        except Exception as exc:
            logger.error(
                "Audit log hatası: %s | "
                "action=%s entity=%s id=%s",
                exc, action, entity_type, entity_id,
            )
