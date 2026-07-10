from uuid import UUID
from backend.core.exceptions import NotFoundError


def assert_target_in_project(db, table: str, target_id, project_id: UUID) -> None:
    """Referans hedefi ayni projede mi dogrular.

    Hedef baska projedeyse ya da yoksa NotFoundError (404) firlatir;
    yetki hatasi 404 olarak maskelenir (bilgi sizdirmama, exceptions.py).
    RLS INSERT with_check yalniz referansin SAHIBINI dogrular, hedefini
    DEGIL (olculdu, 2026-07-10). Bu yuzden hedef kontrolu uygulama
    katmaninda yapilir. RFI tarafinda ayni desen zaten mevcut
    (rfis.py add_reference).
    """
    res = db.table(table).select("project_id").eq("id", str(target_id)).execute()
    if not res.data or res.data[0].get("project_id") != str(project_id):
        raise NotFoundError()
