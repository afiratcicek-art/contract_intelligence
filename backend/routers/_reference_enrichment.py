"""Shared enrichment for RFI / correspondence reference lists.

Owner-agnostic: callers resolve the parent record + IDOR guard, then pass the
already-fetched `refs` list. This helper only derives target label/subject via
batched (N+1-free) lookups scoped to `project_id`. It never scans
pdf_document.entity for membership (ADR-eBundle-002).
"""
from uuid import UUID


def enrich_references(db, refs: list[dict], project_id: UUID) -> list[dict]:
    if not refs:
        return []
    # Hedef etiketleri TOPLU cekilir. Referans basina sorgu ACMA (N+1 yasak).
    rfi_ids    = list({r["rfi_id"]      for r in refs if r.get("rfi_id")})
    corr_ids   = list({r["ref_corr_id"] for r in refs if r.get("ref_corr_id")})
    change_ids = list({r["change_id"]   for r in refs if r.get("change_id")})
    doc_ids    = list({r["document_id"] for r in refs if r.get("document_id")})
    rfi_map, corr_map, change_map, doc_map = {}, {}, {}, {}
    if rfi_ids:
        res = (db.table("rfis").select("id, rfi_number, subject, project_id")
               .in_("id", rfi_ids).eq("is_deleted", False).execute())
        rfi_map = {x["id"]: x for x in (res.data or [])
                   if x.get("project_id") == str(project_id)}
    if corr_ids:
        res = (db.table("correspondences").select("id, corr_number, subject, project_id")
               .in_("id", corr_ids).eq("is_deleted", False).execute())
        corr_map = {x["id"]: x for x in (res.data or [])
                    if x.get("project_id") == str(project_id)}
    if change_ids:
        res = (db.table("changes").select("id, change_number, title, project_id")
               .in_("id", change_ids).eq("is_deleted", False).execute())
        change_map = {x["id"]: x for x in (res.data or [])
                      if x.get("project_id") == str(project_id)}
    if doc_ids:
        # storage_path ASLA cekilmez (TB-145 over-fetch).
        res = (db.table("pdf_document")
               .select("id, original_filename, project_id, "
                       "file_size_bytes, parse_status, doc_type, keywords, location")
               .in_("id", doc_ids).execute())
        doc_map = {x["id"]: x for x in (res.data or [])
                   if x.get("project_id") == str(project_id)}
    out = []
    for r in refs:
        label, subject = None, None
        doc_meta: dict = {}
        if r.get("rfi_id") and r["rfi_id"] in rfi_map:
            t = rfi_map[r["rfi_id"]]
            label, subject = t["rfi_number"], t["subject"]
        elif r.get("ref_corr_id") and r["ref_corr_id"] in corr_map:
            t = corr_map[r["ref_corr_id"]]
            label, subject = t["corr_number"], t["subject"]
        elif r.get("change_id") and r["change_id"] in change_map:
            t = change_map[r["change_id"]]
            label, subject = t["change_number"], t["title"]
        elif r.get("external_doc_number") or r.get("external_doc_title"):
            label, subject = r.get("external_doc_number"), r.get("external_doc_title")
        elif r.get("document_id") and r["document_id"] in doc_map:
            t = doc_map[r["document_id"]]
            label, subject = t["original_filename"], None
            # Belge meta'si yalniz document satirlarinda tasinir. EKLI paneli
            # bunlari referanstan okur; entity-scan'e gerek kalmaz (ADR-eBundle-002).
            doc_meta = {
                "file_size_bytes": t.get("file_size_bytes"),
                "parse_status": t.get("parse_status"),
                "doc_type": t.get("doc_type"),
                "keywords": t.get("keywords"),
                "location": t.get("location"),
            }
        out.append({
            **r,
            "target_label": label,
            "target_subject": subject,
            **doc_meta,
        })
    return out
