from typing import Optional
from backend.repositories.base import BaseRepository


class RFIRepository(BaseRepository):
    table_name = "rfis"

    def list_by_project(
        self,
        project_id: str,
        status: Optional[str] = None,
        discipline: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        query = (
            self.db.table("rfis")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
        )
        if status:
            query = query.eq("status", status)
        if discipline:
            query = query.eq("discipline", discipline)
        result = query.order("submitted_date", desc=True).limit(limit).offset(offset).execute()
        return result.data or []

    def get_pending_deadlines(self, project_id: str, days: int = 7) -> list[dict]:
        """Önümüzdeki N günde deadline'ı olan açık RFI'lar."""
        from datetime import date, timedelta
        today = date.today()
        cutoff = today + timedelta(days=days)

        result = (
            self.db.table("rfis")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_deleted", False)
            .in_("status", ["open", "overdue"])
            .lte("response_due_date", str(cutoff))
            .order("response_due_date")
            .execute()
        )
        return result.data or []

    def get_chain(self, rfi_id: str, project_id: str) -> dict:
        """
        Bu RFI'nın tam zincirini döndürür.
        root: zincirin ilk RFI'ı (parent_id IS NULL)
        ancestors: parent'tan root'a doğru sıralı liste
        children: bu RFI'ya doğrudan yanıt/revize olanlar
        is_latest: bu RFI'nın hiç child'ı yok mu
        """
        # Mevcut RFI
        rfi = self.get(rfi_id)
        if not rfi or rfi["project_id"] != project_id:
            return {"ancestors": [], "children": [], "is_latest": True}

        # Ancestors (parent zinciri — en yakın parent'tan root'a)
        ancestors = []
        current = rfi
        depth = 0
        while current.get("parent_id") and depth < 20:
            parent = self.get(current["parent_id"])
            if not parent or parent["project_id"] != project_id:
                break
            ancestors.append({
                "id": parent["id"],
                "rfi_number": parent["rfi_number"],
                "subject": parent["subject"],
                "rfi_type": parent.get("rfi_type", "original"),
                "status": parent["status"],
                "submitted_date": parent["submitted_date"],
            })
            current = parent
            depth += 1
        ancestors = list(reversed(ancestors))  # root'tan bu RFI'ya doğru

        # Children (bu RFI'ya doğrudan bağlı yanıt/revizeler)
        children_result = (
            self.db.table("rfis")
            .select("id, rfi_number, subject, rfi_type, status, submitted_date")
            .eq("parent_id", rfi_id)
            .eq("project_id", project_id)
            .eq("is_deleted", False)
            .order("submitted_date", desc=False)
            .execute()
        )
        children = children_result.data or []

        return {
            "ancestors": ancestors,
            "children": children,
            "is_latest": len(children) == 0,
        }

    def update_parent_rfi_status(self, parent_id: str) -> None:
        """
        Bir yanıt veya revize RFI oluşturulduğunda parent RFI'ı günceller.
        status = "responded" — otomatik.
        Forensic: sadece open veya overdue iken günceller.
        """
        self.db.table("rfis").update({
            "status": "responded",
        }).eq("id", parent_id).in_("status", ["open", "overdue"]).execute()

    def approve_draft(self, rfi_id: str, data: dict, expected_version: int) -> Optional[dict]:
        """
        Draft -> open gecisi. TOCTOU-safe: yalnizca status='draft' VE version
        eslesirken gunceller. Eszamanli iki onay isteginde ikincisi bos doner (None).
        """
        data["version"] = expected_version + 1
        res = (
            self.db.table("rfis")
            .update(data)
            .eq("id", rfi_id)
            .eq("status", "draft")
            .eq("version", expected_version)
            .execute()
        )
        return res.data[0] if res.data else None

    def get_linked_correspondences(self, rfi_id: str) -> list[dict]:
        """Bu RFI'ya referans veren correspondence'ları getirir."""
        result = (
            self.db.table("correspondence_references")
            .select("correspondence_id, correspondences!correspondence_references_correspondence_id_fkey(id, corr_number, type, subject, correspondence_date, status)")
            .eq("rfi_id", rfi_id)
            .eq("ref_type", "rfi")
            .execute()
        )
        return result.data or []

    def get_references(self, owner_rfi_id: str) -> list[dict]:
        result = (
            self.db.table("rfi_references")
            .select("*")
            .eq("owner_rfi_id", owner_rfi_id)
            .execute()
        )
        return result.data or []

    def update_with_version_check(
        self, rfi_id: str, data: dict, expected_version: int
    ) -> Optional[dict]:
        """Optimistic locking ile güncelleme — race condition koruması."""
        data["version"] = expected_version + 1
        result = (
            self.db.table("rfis")
            .update(data)
            .eq("id", rfi_id)
            .eq("version", expected_version)
            .execute()
        )
        return result.data[0] if result.data else None
