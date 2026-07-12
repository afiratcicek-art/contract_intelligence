from uuid import UUID
from backend.core.exceptions import NotFoundError, ConflictError


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


def assert_document_not_already_linked(
    db, table: str, owner_col: str, owner_id, document_id
) -> None:
    """Ayni belge ayni referans-sahibine iki kez baglanmasin (409).

    Migration 033'un partial UNIQUE index'i (uq_*_owner_document,
    WHERE document_id IS NOT NULL) bunu DB'de zaten engeller; ama TB-115
    duzelene kadar 23505 client'a 500 olarak ulasir. Bu on-kontrol
    kullaniciya net 409 ('zaten bagli') dondurur. document_id NULL ise
    cagrilmaz (sistem/manuel referanslar etkilenmez).

    NOT: create-context'te user-client'in referans tablosuna erisimi
    RLS acisindan sorunlu (TB-135); cagiran, insert ile ayni client'i
    (create yolunda admin) gecmelidir ki ayni transaction tutarli okunsun.
    """
    res = (db.table(table).select("id")
           .eq(owner_col, str(owner_id))
           .eq("document_id", str(document_id))
           .execute())
    if res.data:
        raise ConflictError(detail="Bu belge bu kayda zaten bagli.")
