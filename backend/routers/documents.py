"""PDF belge yükleme ve yönetim endpoint'leri.

Tüm route'lar /projects/{project_id}/documents altında toplanır.
entity_type parametresi ile aynı endpoint RFI, correspondence,
change, deliverable, chronology ve contract_document entity'lerine
belge ekleyebilir.

Async parse mimarisi:
  Upload → Storage → DB (pending) → 202 Accepted
  Worker ayrı process'te pending kayıtları poll eder ve işler.
  Kullanıcı parse_status'u GET /documents/{doc_id} ile takip eder.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import JSONResponse

from backend.core.dependencies import verify_project_access
from backend.core.limiter import limiter
from backend.database import get_admin_client
from backend.services.permission_service import PermissionService
from backend.utils.file_handler import upload_document, delete_document, get_signed_url
from backend.utils.pdf_utils import validate_pdf_bytes, validate_document_bytes
from fastapi import BackgroundTasks
from backend.models.document import (
    DocumentMetadataUpdate,
    DocumentMetadataApprove,
    DocumentMetadataResponse,
)
from backend.services.extraction_service import get_extraction_service
from backend.services.audit_service import AuditService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/documents",
    tags=["documents"],
)

VALID_ENTITY_TYPES = {
    "correspondence",
    "rfi",
    "change",
    "deliverable",
    "chronology",
    "contract_document",
    "internal_alert",
}


# ----------------------------------------------------------
# POST /projects/{project_id}/documents/upload
# ----------------------------------------------------------
@router.post("/upload", status_code=202)
@limiter.limit("20/minute")
def upload_pdf(
    request: Request,
    background_tasks: BackgroundTasks,
    project_id: str,
    entity_type: str = Query(..., description="correspondence | rfi | change | deliverable | chronology | contract_document"),
    entity_id: str = Query(..., description="Belgenin bağlı olduğu kaydın UUID'si."),
    file: UploadFile = File(...),
    keywords: Optional[str] = Query(None, description="Comma-separated keywords (optional)."),
    location: Optional[str] = Query(None, description="Site location or zone (optional)."),
    access=Depends(verify_project_access),
):
    """
    PDF'i Storage'a yükler, parse kuyruğuna alır, 202 Accepted döndürür.
    Parse işlemi arka planda pdf_worker tarafından yapılır.
    İşlem durumu GET /documents/{doc_id} ile parse_status alanından takip edilir.
      pending    — kuyrukta bekliyor
      processing — işleniyor
      completed  — metin hazır
      failed     — hata oluştu, parse_error alanını kontrol et

    # TECHNICAL DEBT: TD-001
    # Şu an kullanıcı parse_status'u manuel yenileyerek takip eder.
    # Frontend aşamasında WebSocket veya polling ile otomatik güncelleme eklenecek.
    """
    db = access["db"]
    user_id = str(access["user"]["id"])

    # entity_type doğrulama
    if entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Geçersiz entity_type. İzin verilenler: {sorted(VALID_ENTITY_TYPES)}",
        )

    # contract_document özel guard
    if entity_type == "contract_document" and entity_id != project_id:
        raise HTTPException(
            status_code=400,
            detail="contract_document için entity_id, project_id ile aynı olmalıdır.",
        )

    # İzin kontrolü
    PermissionService(db).require(
        user_id=user_id,
        project_id=project_id,
        entity_type=entity_type,
        permission="edit",
    )

    # Parse optional user metadata
    # keywords query param: comma-separated string → list
    user_meta = DocumentMetadataUpdate(
        keywords=[k.strip() for k in keywords.split(",") if k.strip()] if keywords else None,
        location=location or None,
    )

    file_bytes = file.file.read()
    filename = file.filename or "upload.pdf"

    # Temel doğrulama — boyut, uzantı, magic bytes
    # Ağır işlem (OCR) worker'a bırakılır
    try:
        validate_document_bytes(file_bytes, filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Storage'a yükle
    try:
        storage_path = upload_document(
            file_bytes=file_bytes,
            file_name=filename,
            project_id=project_id,
            entity_type=entity_type,
            entity_id=entity_id,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # pdf_document tablosuna pending kaydı yaz — worker bu kaydı işleyecek
    doc_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    pending_record = {
        "id": doc_id,
        "project_id": project_id,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "original_filename": filename,
        "storage_path": storage_path,
        "file_size_bytes": len(file_bytes),
        "parse_status": "pending",
        "created_by": user_id,
        "created_at": now,
        "updated_at": now,
    }

    try:
        get_admin_client().table("pdf_document").insert(pending_record).execute()
    except Exception as exc:
        # DB yazma başarısız — storage'daki dosyayı temizle
        delete_document(storage_path)
        logger.error("PDF pending kaydı yazılamadı: %s | id=%s", exc, doc_id)
        raise HTTPException(status_code=500, detail="Belge kaydedilemedi.")

    # Schedule Haiku metadata extraction as background task
    # Extraction needs parsed text — triggered after pdf_pipeline
    # completes. For now schedule with empty text; pdf_pipeline
    # worker will re-trigger extraction when text is ready.
    # TB-13: Wire extraction trigger from pdf_pipeline_service
    # after extracted_text is populated.
    extraction_service = get_extraction_service()
    background_tasks.add_task(
        extraction_service.extract,
        doc_id=doc_id,
        project_id=project_id,
        user_id=user_id,
        text="",  # placeholder — see TB-13
        user_keywords=user_meta.keywords,
        user_location=user_meta.location,
    )

    return JSONResponse(
        status_code=202,
        content={
            "doc_id": doc_id,
            "parse_status": "pending",
            "metadata_status": "pending",
            "message": "Belge alındı, işleme kuyruğuna eklendi.",
            "status_url": f"/api/v1/projects/{project_id}/documents/{doc_id}",
        },
    )


# ----------------------------------------------------------
# GET /projects/{project_id}/documents
# ----------------------------------------------------------
@router.get("/", status_code=200)
def list_documents(
    project_id: str,
    entity_type: str = Query(None),
    entity_id: str = Query(None),
    access=Depends(verify_project_access),
):
    """
    Projeye ait PDF belgelerini listeler.
    entity_type ve entity_id ile filtreleme yapılabilir.
    extracted_text döndürülmez.
    """
    db = access["db"]
    try:
        query = (
            db.table("pdf_document")
            .select(
                "id, project_id, entity_type, entity_id, "
                "original_filename, storage_path, file_size_bytes, "
                "parse_method, parse_status, page_count, quality_score, "
                "parse_error, keywords, location, doc_date, doc_type, "
                "created_by, created_at, updated_at"
            )
            .eq("project_id", project_id)
            .order("created_at", desc=True)
        )
        if entity_type:
            query = query.eq("entity_type", entity_type)
        if entity_id:
            query = query.eq("entity_id", entity_id)

        result = query.execute()
        return result.data or []
    except Exception as exc:
        logger.error("Belge listesi hatası: %s | project=%s", exc, project_id)
        raise HTTPException(status_code=500, detail="Belgeler alınamadı.")


# ----------------------------------------------------------
# GET /projects/{project_id}/documents/search
# ----------------------------------------------------------
@router.get("/all-relations", status_code=200)
def get_all_document_relations(
    project_id: str,
    access=Depends(verify_project_access),
):
    """Graph payload for DocumentRelationGraph.

    Nodes: all correspondences + RFIs in project.
    Edges (three layers):
      1. Structural  — parent_id chain (score=1.0)
      2. Bilateral   — same-parent siblings (score=0.9)
      3. Content     — avg(keyword_jaccard, subject_overlap)
                       cross-entity included, threshold >= 0.25

    No pdf_document / document_relations dependency.
    TB-5: Haiku keywords feed into Layer 3 automatically
    when API key is configured.
    """
    db = access["db"]
    try:
        # ── Fetch ──────────────────────────────────────────
        corr_res = (
            db.table("correspondences")
            .select(
                "id, corr_number, subject, status, "
                "parent_id, correspondence_date, keywords"
            )
            .eq("project_id", project_id)
            .execute()
        )
        corrs: list[dict] = corr_res.data or []

        rfi_res = (
            db.table("rfis")
            .select(
                "id, rfi_number, subject, status, "
                "parent_id, rfi_type, submitted_date, keywords"
            )
            .eq("project_id", project_id)
            .execute()
        )
        rfis: list[dict] = rfi_res.data or []

        if not corrs and not rfis:
            return {"nodes": [], "edges": []}

        # ── Nodes ──────────────────────────────────────────
        nodes: list[dict] = []
        for c in corrs:
            nodes.append({
                "id":          c["id"],
                "ref":         c["corr_number"],
                "subject":     c["subject"],
                "status":      c["status"],
                "entity_type": "correspondence",
                "date":        c.get("correspondence_date"),
                "keywords":    c.get("keywords") or [],
            })
        for r in rfis:
            nodes.append({
                "id":          r["id"],
                "ref":         r["rfi_number"],
                "subject":     r["subject"],
                "status":      r["status"],
                "entity_type": "rfi",
                "rfi_type":    r.get("rfi_type"),
                "date":        r.get("submitted_date"),
                "keywords":    r.get("keywords") or [],
            })

        # ── Helpers ────────────────────────────────────────
        def _jaccard(a: set, b: set) -> float:
            if not a or not b:
                return 0.0
            return len(a & b) / len(a | b)

        def _subject_overlap(s1: str, s2: str) -> float:
            """Token overlap between two subjects."""
            t1 = set((s1 or "").lower()
                     .replace(",", " ").replace(".", " ")
                     .replace(":", " ").replace("-", " ")
                     .split())
            t2 = set((s2 or "").lower()
                     .replace(",", " ").replace(".", " ")
                     .replace(":", " ").replace("-", " ")
                     .split())
            # Remove very short tokens (≤2 chars)
            t1 = {t for t in t1 if len(t) > 2}
            t2 = {t for t in t2 if len(t) > 2}
            if not t1 or not t2:
                return 0.0
            return len(t1 & t2) / len(t1 | t2)

        def _content_score(n1: dict, n2: dict) -> float:
            """Average of keyword Jaccard + subject overlap."""
            kw  = _jaccard(
                set(n1.get("keywords") or []),
                set(n2.get("keywords") or []),
            )
            sub = _subject_overlap(
                n1.get("subject") or "",
                n2.get("subject") or "",
            )
            return round((kw + sub) / 2, 3)

        # ── Edges ──────────────────────────────────────────
        edges: list[dict] = []
        seen_edges: set[tuple] = set()

        def _add_edge(src: str, tgt: str, score: float,
                      layer: str) -> None:
            key = (min(src, tgt), max(src, tgt))
            if key in seen_edges:
                return
            seen_edges.add(key)
            edges.append({
                "source": src,
                "target": tgt,
                "score":  score,
                "layer":  layer,
            })

        # All nodes for content scoring
        all_nodes = nodes  # already built above

        # Layer 1 — parent_id chain (score=1.0)
        for c in corrs:
            if c.get("parent_id"):
                _add_edge(c["parent_id"], c["id"],
                          1.0, "chain")
        for r in rfis:
            if r.get("parent_id"):
                _add_edge(r["parent_id"], r["id"],
                          1.0, "chain")

        # Layer 2 — bilateral siblings (same parent, score=0.9)
        # Group by parent_id
        from collections import defaultdict
        corr_siblings: dict = defaultdict(list)
        for c in corrs:
            if c.get("parent_id"):
                corr_siblings[c["parent_id"]].append(c["id"])
        for sibs in corr_siblings.values():
            for i in range(len(sibs)):
                for j in range(i + 1, len(sibs)):
                    _add_edge(sibs[i], sibs[j], 0.9, "sibling")

        rfi_siblings: dict = defaultdict(list)
        for r in rfis:
            if r.get("parent_id"):
                rfi_siblings[r["parent_id"]].append(r["id"])
        for sibs in rfi_siblings.values():
            for i in range(len(sibs)):
                for j in range(i + 1, len(sibs)):
                    _add_edge(sibs[i], sibs[j], 0.9, "sibling")

        # Layer 3 — content scoring (keyword + subject, threshold=0.25)
        # Build node lookup for scoring
        node_map = {n["id"]: n for n in all_nodes}
        node_ids = list(node_map.keys())
        for i in range(len(node_ids)):
            for j in range(i + 1, len(node_ids)):
                nid1, nid2 = node_ids[i], node_ids[j]
                # Skip if already connected by chain/sibling
                key = (min(nid1, nid2), max(nid1, nid2))
                if key in seen_edges:
                    continue
                score = _content_score(
                    node_map[nid1], node_map[nid2]
                )
                if score >= 0.25:
                    _add_edge(nid1, nid2, score, "content")

        return {"nodes": nodes, "edges": edges}

    except Exception as exc:
        logger.error(
            "Proje ilişki grafiği hatası: %s | project=%s",
            exc, project_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Belge ilişki grafiği alınamadı."
        )


@router.get("/card-relations/{entity_type}/{entity_id}", status_code=200)
def get_card_relations(
    project_id: str,
    entity_type: str,
    entity_id: str,
    access=Depends(verify_project_access),
):
    """Return related cards for a single correspondence/rfi,
    grouped by relation strength:
      1. chain    — parent/child (strongest)
      2. sibling  — same parent
      3. content  — keyword + subject overlap (weakest, deterministic)

    Response: { chain: [...], sibling: [...], content: [...] }
    Each item: { id, ref, subject, status, entity_type, score }
    """
    if entity_type not in ("correspondence", "rfi"):
        raise HTTPException(status_code=400, detail="Geçersiz entity_type.")

    db = access["db"]
    try:
        corr_res = (
            db.table("correspondences")
            .select(
                "id, corr_number, subject, status, "
                "parent_id, correspondence_date, keywords"
            )
            .eq("project_id", project_id)
            .execute()
        )
        corrs: list[dict] = corr_res.data or []

        rfi_res = (
            db.table("rfis")
            .select(
                "id, rfi_number, subject, status, "
                "parent_id, rfi_type, submitted_date, keywords"
            )
            .eq("project_id", project_id)
            .execute()
        )
        rfis: list[dict] = rfi_res.data or []

        def _to_node(row: dict, etype: str) -> dict:
            ref = row.get("corr_number") or row.get("rfi_number")
            return {
                "id":          row["id"],
                "ref":         ref,
                "subject":     row["subject"],
                "status":      row["status"],
                "entity_type": etype,
                "parent_id":   row.get("parent_id"),
                "keywords":    row.get("keywords") or [],
            }

        all_nodes = (
            [_to_node(c, "correspondence") for c in corrs]
            + [_to_node(r, "rfi") for r in rfis]
        )
        node_map = {n["id"]: n for n in all_nodes}

        self_node = node_map.get(entity_id)
        if not self_node:
            return {"chain": [], "sibling": [], "content": []}

        # ── Layer 1: chain (parent + children) ──────────────
        chain_ids: set[str] = set()
        if self_node.get("parent_id"):
            chain_ids.add(self_node["parent_id"])
        for n in all_nodes:
            if n.get("parent_id") == entity_id:
                chain_ids.add(n["id"])

        # ── Layer 2: sibling (same parent, excl. self) ──────
        sibling_ids: set[str] = set()
        if self_node.get("parent_id"):
            for n in all_nodes:
                if (
                    n.get("parent_id") == self_node["parent_id"]
                    and n["id"] != entity_id
                    and n["id"] not in chain_ids
                ):
                    sibling_ids.add(n["id"])

        # ── Layer 3: content (keyword + subject overlap) ────
        def _jaccard(a: set, b: set) -> float:
            if not a or not b:
                return 0.0
            return len(a & b) / len(a | b)

        def _subject_overlap(s1: str, s2: str) -> float:
            t1 = {t for t in (s1 or "").lower()
                  .replace(",", " ").replace(".", " ")
                  .replace(":", " ").replace("-", " ").split()
                  if len(t) > 2}
            t2 = {t for t in (s2 or "").lower()
                  .replace(",", " ").replace(".", " ")
                  .replace(":", " ").replace("-", " ").split()
                  if len(t) > 2}
            if not t1 or not t2:
                return 0.0
            return len(t1 & t2) / len(t1 | t2)

        self_kw = set(self_node.get("keywords") or [])
        content_items: list[dict] = []
        for n in all_nodes:
            if n["id"] == entity_id:
                continue
            if n["id"] in chain_ids or n["id"] in sibling_ids:
                continue
            kw_score  = _jaccard(self_kw, set(n.get("keywords") or []))
            sub_score = _subject_overlap(self_node["subject"], n["subject"])
            score = round((kw_score + sub_score) / 2, 3)
            if score >= 0.25:
                content_items.append({**n, "score": score})

        content_items.sort(key=lambda x: x["score"], reverse=True)

        def _strip(n: dict, score: float) -> dict:
            return {
                "id":          n["id"],
                "ref":         n["ref"],
                "subject":     n["subject"],
                "status":      n["status"],
                "entity_type": n["entity_type"],
                "score":       score,
            }

        return {
            "chain":   [_strip(node_map[i], 1.0) for i in chain_ids if i in node_map],
            "sibling": [_strip(node_map[i], 0.9) for i in sibling_ids if i in node_map],
            "content": [_strip(item, item["score"]) for item in content_items],
        }

    except Exception as exc:
        logger.error(
            "Kart ilişki hatası: %s | entity=%s/%s",
            exc, entity_type, entity_id,
        )
        raise HTTPException(
            status_code=500, detail="İlişkili kayıtlar alınamadı."
        )


# ----------------------------------------------------------
# GET /projects/{project_id}/documents/{doc_id}
# ----------------------------------------------------------
@router.get("/{doc_id}", status_code=200)
def get_document(
    project_id: str,
    doc_id: str,
    access=Depends(verify_project_access),
):
    """
    Tek belge metadata'sını döndürür.
    parse_status alanı ile işlem durumu takip edilir.
    extracted_text dahil değil.
    """
    db = access["db"]
    try:
        result = (
            db.table("pdf_document")
            .select(
                "id, project_id, entity_type, entity_id, "
                "original_filename, storage_path, file_size_bytes, "
                "parse_method, parse_status, page_count, quality_score, "
                "parse_error, created_by, created_at, updated_at"
            )
            .eq("id", doc_id)
            .eq("project_id", project_id)
            .single()
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Belge bulunamadı.")
        return result.data
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Belge getirme hatası: %s | id=%s", exc, doc_id)
        raise HTTPException(status_code=500, detail="Belge alınamadı.")


# ----------------------------------------------------------
# GET /projects/{project_id}/documents/{doc_id}/text
# ----------------------------------------------------------
@router.get("/{doc_id}/text", status_code=200)
def get_document_text(
    project_id: str,
    doc_id: str,
    access=Depends(verify_project_access),
):
    """
    Parse edilmiş PDF'in temiz metnini döndürür.
    Yalnızca parse_status = completed olan belgeler için metin döner.
    claude_service'e göndermeden önce bu endpoint çağrılır.
    """
    db = access["db"]
    try:
        result = (
            db.table("pdf_document")
            .select("extracted_text, parse_status")
            .eq("id", doc_id)
            .eq("project_id", project_id)
            .single()
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Belge bulunamadı.")
        if result.data.get("parse_status") != "completed":
            raise HTTPException(
                status_code=202,
                detail=f"Belge henüz işlenmedi. Durum: {result.data.get('parse_status')}",
            )
        text = result.data.get("extracted_text")
        if not text:
            raise HTTPException(status_code=404, detail="Metin bulunamadı.")
        return {"doc_id": doc_id, "text": text}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Metin okuma hatası: %s | id=%s", exc, doc_id)
        raise HTTPException(status_code=500, detail="Metin alınamadı.")


# ----------------------------------------------------------
# GET /projects/{project_id}/documents/{doc_id}/signed-url
# ----------------------------------------------------------
@router.get("/{doc_id}/signed-url", status_code=200)
def get_document_signed_url(
    project_id: str,
    doc_id: str,
    expires_in: int = Query(3600, ge=300, le=86400),
    access=Depends(verify_project_access),
):
    """
    Belge için geçici imzalı indirme URL'i üretir.
    expires_in: 300 (5 dk) ile 86400 (24 saat) arasında saniye cinsinden.
    """
    db = access["db"]
    try:
        result = (
            db.table("pdf_document")
            .select("storage_path")
            .eq("id", doc_id)
            .eq("project_id", project_id)
            .single()
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Belge bulunamadı.")
        storage_path = result.data["storage_path"]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Storage path hatası: %s | id=%s", exc, doc_id)
        raise HTTPException(status_code=500, detail="Belge bilgisi alınamadı.")

    try:
        signed_url = get_signed_url(
            path=storage_path,
            expires_in=expires_in,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"doc_id": doc_id, "signed_url": signed_url, "expires_in": expires_in}


@router.patch("/{doc_id}/metadata/approve", status_code=200)
def approve_metadata(
    project_id: str,
    doc_id: str,
    body: DocumentMetadataApprove,
    access=Depends(verify_project_access),
):
    """HITL: CM approves or corrects Haiku-extracted metadata.
    Approved values replace the draft extraction.
    metadata_status remains 'done'; metadata_source set to 'mixed'
    if user corrections differ from Haiku output.
    """
    db = access["db"]
    user_id = str(access["user"]["id"])

    # Verify document belongs to project
    result = (
        get_admin_client()
        .table("pdf_document")
        .select("id, metadata_status, keywords, location, doc_date")
        .eq("id", doc_id)
        .eq("project_id", project_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Belge bulunamadı.")

    existing = result.data

    # Build update — only override fields provided by user
    update_data: dict = {
        "metadata_approved_by": user_id,
        "metadata_approved_at": datetime.now(timezone.utc).isoformat(),
        "metadata_status": "done",
        "metadata_source": "mixed",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.keywords is not None:
        update_data["keywords"] = body.keywords
    if body.location is not None:
        update_data["location"] = body.location
    if body.doc_date is not None:
        update_data["doc_date"] = body.doc_date.isoformat()

    try:
        get_admin_client() \
            .table("pdf_document") \
            .update(update_data) \
            .eq("id", doc_id) \
            .execute()
    except Exception as exc:
        logger.error("Metadata approve DB error: %s | doc_id=%s", exc, doc_id)
        raise HTTPException(status_code=500, detail="Metadata güncellenemedi.")

    audit = AuditService()
    audit.log(
        action="metadata_approved",
        entity_type="pdf_document",
        entity_id=doc_id,
        user_id=user_id,
        project_id=project_id,
        old_value={
            "keywords": existing.get("keywords"),
            "location": existing.get("location"),
            "doc_date": existing.get("doc_date"),
        },
        new_value={
            "keywords": update_data.get("keywords", existing.get("keywords")),
            "location": update_data.get("location", existing.get("location")),
            "doc_date": update_data.get("doc_date", existing.get("doc_date")),
        },
    )

    return {"doc_id": doc_id, "metadata_status": "done", "message": "Metadata onaylandı."}
