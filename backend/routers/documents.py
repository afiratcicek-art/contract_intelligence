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
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import JSONResponse

from backend.core.dependencies import verify_project_access
from backend.core.guards import assert_target_in_project
from backend.core.limiter import limiter
from backend.database import get_admin_client
from backend.services.permission_service import PermissionService
from backend.utils.file_handler import upload_document, delete_document, get_signed_url
from backend.utils.pdf_utils import validate_document_bytes, scan_for_virus
from fastapi import BackgroundTasks
from backend.models.document import (
    DocumentMetadataUpdate,
    DocumentMetadataApprove,
)
from backend.services.extraction_service import get_extraction_service
from backend.services.audit_service import AuditService
from backend.repositories.correspondence_repository import CorrespondenceRepository
from backend.repositories.rfi_repository import RFIRepository

logger = logging.getLogger(__name__)

# Content-relation floor. Provisional (see TB-26): deterministic-only
# mode; recalibrate on TB-5 Haiku activation. Low floor is intentional —
# relations are advisory (HITL); user prunes weak links.
CONTENT_RELATION_THRESHOLD = 0.10


def _upsert_keyword_stats(admin_db, project_id: str, keywords: list[str]) -> None:
    """Keyword sayaçlarını project_keyword_stats tablosuna yazar.

    TB-24: Yeni belge kaynakları eklendiğinde bu helper çağrılmalı.
    """
    if not keywords:
        return
    for kw in keywords:
        kw = kw.strip().lower()
        if not kw:
            continue
        try:
            existing = (
                admin_db.table("project_keyword_stats")
                .select("count")
                .eq("project_id", project_id)
                .eq("keyword", kw)
                .execute()
            )
            if existing.data:
                admin_db.table("project_keyword_stats") \
                    .update({"count": existing.data[0]["count"] + 1}) \
                    .eq("project_id", project_id) \
                    .eq("keyword", kw) \
                    .execute()
            else:
                admin_db.table("project_keyword_stats") \
                    .insert({"project_id": project_id, "keyword": kw, "count": 1}) \
                    .execute()
        except Exception as exc:
            logger.warning("keyword_stats upsert failed for '%s': %s", kw, exc)


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

# e-Bundle: yuklenen belge, sahibinin referans listesine 'attachment' olarak yazilir.
# Uyelik referans tablosundan okunur, pdf_document.entity taranmaz (ADR-eBundle-002).
# Yalniz bu iki tipin referans tablosu vardir; diger entity tipleri atlanir.
REFERENCE_TABLE_BY_ENTITY = {
    "correspondence": ("correspondence_references", "correspondence_id"),
    "rfi": ("rfi_references", "owner_rfi_id"),
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

    # entity_id proje dogrulama (IDOR) — yalniz rfi/correspondence; ClamAV/storage'dan once.
    if entity_type in ("rfi", "correspondence"):
        assert_target_in_project(
            get_admin_client(),
            "rfis" if entity_type == "rfi" else "correspondences",
            entity_id,
            project_id,
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

    # ClamAV virüs taraması (TD-003)
    try:
        scan_for_virus(file_bytes, filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

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

    # Ek referansi yaz: belge = ek (ADR-eBundle-002). Yazilamazsa belge hayalet
    # kalmasin diye pdf_document satiri ve storage dosyasi geri alinir.
    ref_target = REFERENCE_TABLE_BY_ENTITY.get(entity_type)
    if ref_target:
        ref_table, owner_col = ref_target
        try:
            get_admin_client().table(ref_table).insert({
                owner_col: entity_id,
                "ref_type": "document",
                "document_id": doc_id,
                "ref_role": "attachment",
                "added_by": user_id,
            }).execute()
        except Exception as exc:
            get_admin_client().table("pdf_document").delete().eq("id", doc_id).execute()
            delete_document(storage_path)
            logger.error("Ek referansi yazilamadi, upload geri alindi: %s | doc_id=%s", exc, doc_id)
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
    limit: int = Query(50, le=200),
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
        # limit yalniz proje-geneli (picker) yolda; entity-scoped cagiranlar
        # (RFIDetail/CorrespondenceDetail, entity_id ile) eski sinirsiz davranisi korur.
        if not entity_id:
            query = query.limit(limit)

        result = query.execute()
        return result.data or []
    except Exception as exc:
        logger.error("Belge listesi hatası: %s | project=%s", exc, project_id)
        raise HTTPException(status_code=500, detail="Belgeler alınamadı.")


# ════════════════════════════════════════════════════
# Shared relation-computation helpers
# Used by /all-relations, /card-relations, /focused-graph.
# Single source of truth — avoids triplicated scoring logic.
# ════════════════════════════════════════════════════

def _build_relation_index(project_id: str, db, preserve_entity_id: str | None = None):
    """Fetch all correspondences + rfis for a project once.
    Returns (all_nodes, node_map, parent_map, children_map).
    Single pair of queries — reused across all relation endpoints
    to avoid repeated DB round-trips (no N+1).
    """
    if preserve_entity_id:
        uuid.UUID(str(preserve_entity_id))
    corr_query = (
        db.table("correspondences")
        .select(
            "id, corr_number, subject, status, "
            "parent_id, correspondence_date, keywords"
        )
        .eq("project_id", project_id)
    )
    if preserve_entity_id:
        corr_query = corr_query.or_(f"id.eq.{preserve_entity_id},status.neq.draft")
    else:
        corr_query = corr_query.neq("status", "draft")
    corr_res = corr_query.execute()
    corrs: list[dict] = corr_res.data or []

    rfi_query = (
        db.table("rfis")
        .select(
            "id, rfi_number, subject, status, "
            "parent_id, rfi_type, submitted_date, keywords"
        )
        .eq("project_id", project_id)
    )
    if preserve_entity_id:
        rfi_query = rfi_query.or_(f"id.eq.{preserve_entity_id},status.neq.draft")
    else:
        rfi_query = rfi_query.neq("status", "draft")
    rfi_res = rfi_query.execute()
    rfis: list[dict] = rfi_res.data or []

    all_nodes: list[dict] = []
    for c in corrs:
        all_nodes.append({
            "id":          c["id"],
            "ref":         c["corr_number"],
            "subject":     c["subject"],
            "status":      c["status"],
            "entity_type": "correspondence",
            "parent_id":   c.get("parent_id"),
            "date":        c.get("correspondence_date"),
            "keywords":    c.get("keywords") or [],
        })
    for r in rfis:
        all_nodes.append({
            "id":          r["id"],
            "ref":         r["rfi_number"],
            "subject":     r["subject"],
            "status":      r["status"],
            "entity_type": "rfi",
            "parent_id":   r.get("parent_id"),
            "rfi_type":    r.get("rfi_type"),
            "date":        r.get("submitted_date"),
            "keywords":    r.get("keywords") or [],
        })

    node_map = {n["id"]: n for n in all_nodes}
    parent_map = {n["id"]: n.get("parent_id") for n in all_nodes}
    children_map: dict = defaultdict(list)
    for n in all_nodes:
        if n.get("parent_id"):
            children_map[n["parent_id"]].append(n["id"])

    # ── Root keyword inheritance ─────────────────────────────────
    # Zincir yanıt belgeleri (Re:, RES) genelde kendi keyword'lerini
    # girmez. İçerik benzerliği için zincir KÖKÜNÜN keyword'lerini
    # devralırlar. Kartın kendi keyword'ü varsa union yapılır —
    # kullanıcının eklediği ekstra keyword'ler korunur.
    def _root_id(nid: str) -> str:
        seen: set = set()
        while parent_map.get(nid) and nid not in seen:
            seen.add(nid)
            nid = parent_map[nid]
        return nid

    for n in all_nodes:
        root = _root_id(n["id"])
        if root == n["id"]:
            continue  # kök kartın kendisi — miras yok
        root_kw = node_map[root].get("keywords") or []
        own_kw = n.get("keywords") or []
        # union — kendi keyword'ü öncelikli, root'unkiyle birleştir
        merged = list({*(k.lower() for k in own_kw),
                       *(k.lower() for k in root_kw)})
        n["keywords"] = merged

    return all_nodes, node_map, parent_map, children_map


def _kw_tokens(keyword: str) -> set:
    """Bir keyword'ü anlamlı token'lara böler (>2 karakter)."""
    return {
        t for t in (keyword or "").lower()
        .replace(",", " ").replace(".", " ")
        .replace(":", " ").replace("-", " ").split()
        if len(t) > 2
    }


def _jaccard(a: set, b: set) -> float:
    """Token-overlap keyword matching (Varyant 2).
    İki keyword en az bir anlamlı token paylaşıyorsa (ör. "fiber" ↔
    "fiber hattı") eşleşmiş sayılır. Skor = eşleşen benzersiz keyword /
    toplam benzersiz keyword. Tam string eşitliği GEREKMEZ — deterministik
    kısmi eşleşme. (Gerçek semantic eşleşme V1.5'te embedding ile gelecek.)
    """
    if not a or not b:
        return 0.0
    a_list = [k for k in a if k and k.strip()]
    b_list = [k for k in b if k and k.strip()]
    if not a_list or not b_list:
        return 0.0

    a_tokens = {k: _kw_tokens(k) for k in a_list}
    b_tokens = {k: _kw_tokens(k) for k in b_list}

    def _matches(kw_tokens: set, other: dict) -> bool:
        # Bu keyword, karşı taraftaki herhangi bir keyword ile
        # en az bir token paylaşıyor mu?
        for toks in other.values():
            if kw_tokens & toks:
                return True
        return False

    matched_a = sum(1 for k, t in a_tokens.items() if t and _matches(t, b_tokens))
    matched_b = sum(1 for k, t in b_tokens.items() if t and _matches(t, a_tokens))

    total_unique = len(a_list) + len(b_list)
    if total_unique == 0:
        return 0.0
    # Simetrik oran: her iki taraftan eşleşenlerin toplamı / toplam keyword
    return round((matched_a + matched_b) / total_unique, 3)


def _subject_overlap(s1: str, s2: str) -> float:
    """Token overlap between two subjects (tokens > 2 chars)."""
    def _tokens(s: str) -> set:
        return {
            t for t in (s or "").lower()
            .replace(",", " ").replace(".", " ")
            .replace(":", " ").replace("-", " ").split()
            if len(t) > 2
        }
    t1, t2 = _tokens(s1), _tokens(s2)
    if not t1 or not t2:
        return 0.0
    return len(t1 & t2) / len(t1 | t2)


def _content_score(n1: dict, n2: dict) -> float:
    """Content similarity: subject↔subject, kw↔kw, and cross subj↔kw signals.
    max (not average) — güçlü tek sinyal threshold'u geçmeli.
    """
    kw1 = n1.get("keywords") or []
    kw2 = n2.get("keywords") or []
    subj1 = n1.get("subject") or ""
    subj2 = n2.get("subject") or ""
    kw1_str = " ".join(kw1)
    kw2_str = " ".join(kw2)

    # Ağırlık hiyerarşisi:
    #   subject ↔ subject → EN GÜÇLÜ (tam ağırlık ×1.0)
    #   keyword ↔ keyword, çapraz (subj↔kw) → eşit, ×0.85 indirimli
    # Böylece iki tam-subject eşleşmesi her zaman keyword/çapraz eşleşmeyi geçer.
    CROSS_WEIGHT = 0.85

    subj_subj = _subject_overlap(subj1, subj2)                       # ×1.0
    kw_kw = _jaccard(set(kw1), set(kw2)) * CROSS_WEIGHT
    subj1_kw2 = _subject_overlap(subj1, kw2_str) * CROSS_WEIGHT
    kw1_subj2 = _subject_overlap(kw1_str, subj2) * CROSS_WEIGHT

    return round(max(subj_subj, kw_kw, subj1_kw2, kw1_subj2), 3)


def _full_chain_ids(entity_id: str, parent_map: dict, children_map: dict) -> set:
    """Root-to-leaves BFS. Returns all transitive chain member ids
    (ancestors + descendants + siblings), excluding entity_id itself.
    """
    root_id = entity_id
    seen_up: set = set()
    while parent_map.get(root_id) and root_id not in seen_up:
        seen_up.add(root_id)
        root_id = parent_map[root_id]

    chain_ids: set = set()
    queue = [root_id]
    visited: set = set()
    while queue:
        curr = queue.pop(0)
        if curr in visited:
            continue
        visited.add(curr)
        chain_ids.add(curr)
        queue.extend(children_map.get(curr, []))
    chain_ids.discard(entity_id)
    return chain_ids


def _content_neighbors(
    entity_id: str, self_node: dict, all_nodes: list,
    exclude_ids: set, threshold: float = CONTENT_RELATION_THRESHOLD,
) -> dict:
    """Direct content-similarity neighbors, excluding exclude_ids/self."""
    result: dict = {}
    for n in all_nodes:
        if n["id"] == entity_id or n["id"] in exclude_ids:
            continue
        score = _content_score(self_node, n)
        if score >= threshold:
            result[n["id"]] = score
    return result


_TIER_STRENGTH = {"chain": 3, "reference": 2, "content": 1, "cross": 0}


def _resolve_reference_target_id(
    ref: dict,
    node_map: dict,
    synthetic_nodes: dict,
    changes_map: dict,
) -> Optional[str]:
    """Resolve a reference row to a graph node id (real or synthetic). None = skip."""
    ref_id = ref.get("id")
    if ref.get("rfi_id"):
        nid = ref["rfi_id"]
        # IDOR guard: node_map is single-project (RLS-scoped in _build_relation_index); cross-project targets are absent → skipped.
        return nid if nid in node_map else None
    if ref.get("ref_corr_id"):
        nid = ref["ref_corr_id"]
        # IDOR guard: node_map is single-project (RLS-scoped in _build_relation_index); cross-project targets are absent → skipped.
        return nid if nid in node_map else None
    if ref.get("change_id"):
        ch = changes_map.get(ref["change_id"])
        if not ch:
            return None
        synth_id = f"changeref-{ref_id}"
        if synth_id not in synthetic_nodes:
            synthetic_nodes[synth_id] = {
                "id": synth_id,
                "ref": ch["change_number"],
                "subject": ch["title"],
                "status": ch.get("status", "reference"),
                "entity_type": "change",
            }
        return synth_id
    ext_num = ref.get("external_doc_number")
    ext_title = ref.get("external_doc_title")
    if ext_num or ext_title or ref.get("ref_type") in (
        "external_doc", "drawing", "spec", "other",
    ):
        if not ext_num and not ext_title:
            return None
        synth_id = f"extref-{ref_id}"
        if synth_id not in synthetic_nodes:
            label = ext_num or ext_title or "EXT"
            synthetic_nodes[synth_id] = {
                "id": synth_id,
                "ref": label,
                "subject": ext_title or ext_num or "External document",
                "status": "reference",
                "entity_type": "external_doc",
            }
        return synth_id
    return None


def _gather_center_reference_edges(
    entity_id: str,
    entity_type: str,
    project_id: str,
    db,
    node_map: dict,
    synthetic_nodes: dict,
) -> tuple[list[dict], set[str]]:
    """Collect 1-hop reference edges to/from center (outgoing + incoming)."""
    rfi_repo = RFIRepository(db)
    corr_repo = CorrespondenceRepository(db)
    ref_edges: list[dict] = []
    reference_terminal_ids: set[str] = set()

    if entity_type == "rfi":
        outgoing = rfi_repo.get_references(entity_id)
    else:
        outgoing = corr_repo.get_references(entity_id)

    change_ids = list({ref["change_id"] for ref in outgoing if ref.get("change_id")})
    changes_map: dict = {}
    if change_ids:
        ch_res = (
            db.table("changes")
            .select("id, change_number, title, status, project_id")
            .in_("id", change_ids)
            .eq("is_deleted", False)
            .execute()
        )
        for row in ch_res.data or []:
            if row.get("project_id") == project_id:
                changes_map[row["id"]] = row

    for ref in outgoing:
        tid = _resolve_reference_target_id(
            ref, node_map, synthetic_nodes, changes_map,
        )
        if not tid or tid == entity_id:
            continue
        ref_edges.append({
            "source": entity_id, "target": tid,
            "score": 1.0, "tier": "reference",
        })
        reference_terminal_ids.add(tid)

    if entity_type == "rfi":
        for row in rfi_repo.get_linked_correspondences(entity_id):
            sid = row.get("correspondence_id")
            if not sid or sid not in node_map:
                continue
            ref_edges.append({
                "source": sid, "target": entity_id,
                "score": 1.0, "tier": "reference",
            })
            reference_terminal_ids.add(sid)
        incoming_rfi = (
            db.table("rfi_references")
            .select("*")
            .eq("rfi_id", entity_id)
            .execute()
        ).data or []
        for ref in incoming_rfi:
            if ref.get("owner_rfi_id") == entity_id:
                continue
            sid = ref.get("owner_rfi_id")
            if sid and sid in node_map:
                ref_edges.append({
                    "source": sid, "target": entity_id,
                    "score": 1.0, "tier": "reference",
                })
                reference_terminal_ids.add(sid)
    else:
        incoming_corr = (
            db.table("correspondence_references")
            .select("*")
            .eq("ref_corr_id", entity_id)
            .execute()
        ).data or []
        for ref in incoming_corr:
            sid = ref.get("correspondence_id")
            if sid and sid in node_map:
                ref_edges.append({
                    "source": sid, "target": entity_id,
                    "score": 1.0, "tier": "reference",
                })
                reference_terminal_ids.add(sid)
        incoming_rfi = (
            db.table("rfi_references")
            .select("*")
            .eq("ref_corr_id", entity_id)
            .execute()
        ).data or []
        for ref in incoming_rfi:
            sid = ref.get("owner_rfi_id")
            if sid and sid in node_map:
                ref_edges.append({
                    "source": sid, "target": entity_id,
                    "score": 1.0, "tier": "reference",
                })
                reference_terminal_ids.add(sid)

    reference_terminal_ids.discard(entity_id)
    return ref_edges, reference_terminal_ids


# ════════════════════════════════════════════════════
# GET /stats — project document statistics (cached)
# ════════════════════════════════════════════════════

@router.get("/stats", status_code=200)
def get_document_stats(
    project_id: str,
    access=Depends(verify_project_access),
):
    """Proje doküman istatistiklerini döner.

    Önce project_document_stats cache'ini kontrol eder (TTL: 30 saniye).
    Cache yoksa veya eskiyse aggregate hesaplar, cache'e yazar ve döner.
    Kaynak: correspondences, rfis, pdf_document, chronology_events.
    Write: admin client (service_role — RLS bypass by design).
    Read:  JWT client (RLS enforced — project member only).
    """
    admin_db = get_admin_client()
    jwt_db = access["db"]
    p_id = str(project_id)
    TTL_SECS = 30   # 30 saniye

    # ── 1. Cache kontrolü ──────────────────────────────────────────────────
    cache_res = (
        jwt_db.table("project_document_stats")
        .select("stats_json, updated_at")
        .eq("project_id", p_id)
        .limit(1)
        .execute()
    )

    if cache_res.data:
        row = cache_res.data[0]
        updated_at = datetime.fromisoformat(
            row["updated_at"].replace("Z", "+00:00")
        )
        age = (datetime.now(timezone.utc) - updated_at).total_seconds()
        if age < TTL_SECS:
            return row["stats_json"]

    # ── 2. Aggregate hesapla ───────────────────────────────────────────────
    # Correspondence count + by type
    corr_res = (
        admin_db.table("correspondences")
        .select("type")
        .eq("project_id", p_id)
        .eq("is_deleted", False)
        .execute()
    )
    corr_rows = corr_res.data or []
    corr_count = len(corr_rows)
    by_corr_type: dict = {}
    for row in corr_rows:
        t = row.get("type") or "other"
        by_corr_type[t] = by_corr_type.get(t, 0) + 1

    # RFI count + by discipline
    rfi_res = (
        admin_db.table("rfis")
        .select("discipline")
        .eq("project_id", p_id)
        .eq("is_deleted", False)
        .execute()
    )
    rfi_rows = rfi_res.data or []
    rfi_count = len(rfi_rows)
    by_rfi_discipline: dict = {}
    for row in rfi_rows:
        d = row.get("discipline") or "Other"
        by_rfi_discipline[d] = by_rfi_discipline.get(d, 0) + 1

    # PDF count + by doc_type
    pdf_res = (
        admin_db.table("pdf_document")
        .select("doc_type")
        .eq("project_id", p_id)
        .execute()
    )
    pdf_rows = pdf_res.data or []
    pdf_count = len(pdf_rows)
    by_doc_type: dict = {}
    for row in pdf_rows:
        dt = row.get("doc_type") or "other"
        by_doc_type[dt] = by_doc_type.get(dt, 0) + 1

    # Manual chronology events count
    manual_res = (
        admin_db.table("chronology_events")
        .select("id, event_type, chronologies!inner(project_id)")
        .eq("chronologies.project_id", p_id)
        .eq("is_active", True)
        .is_("document_ref_id", "null")
        .execute()
    )
    manual_count = len(manual_res.data or [])

    # By chronology event type (manual only — rfi/correspondence excluded)
    EXCLUDED_TYPES = {"rfi", "correspondence"}
    by_chronology_type: dict = {}
    for row in (manual_res.data or []):
        et = row.get("event_type") or "other"
        if et not in EXCLUDED_TYPES:
            by_chronology_type[et] = by_chronology_type.get(et, 0) + 1

    # Contract documents (pdf_document entity_type = 'contract_document')
    contract_res = (
        admin_db.table("pdf_document")
        .select("id", count="exact")
        .eq("project_id", p_id)
        .eq("entity_type", "contract_document")
        .execute()
    )
    contract_doc_count = contract_res.count or 0

    # Changes — agreed / disputed / under_review
    changes_res = (
        admin_db.table("changes")
        .select("status")
        .eq("project_id", p_id)
        .eq("is_deleted", False)
        .in_("status", ["agreed", "disputed",
                        "impact_submitted", "under_negotiation"])
        .execute()
    )
    changes_rows = changes_res.data or []
    changes_approved = sum(1 for r in changes_rows if r["status"] == "agreed")
    changes_under_review = sum(
        1 for r in changes_rows
        if r["status"] in ("impact_submitted", "under_negotiation")
    )
    changes_disputed = sum(1 for r in changes_rows if r["status"] == "disputed")

    # Top 5 keywords (project_keyword_stats tablosundan)
    kw_res = (
        jwt_db.table("project_keyword_stats")
        .select("keyword, count")
        .eq("project_id", p_id)
        .order("count", desc=True)
        .limit(5)
        .execute()
    )
    top_keywords = [r["keyword"] for r in (kw_res.data or [])]

    # Top 5 locations (project_location_stats tablosundan)
    loc_res = (
        jwt_db.table("project_location_stats")
        .select("location, count")
        .eq("project_id", p_id)
        .order("count", desc=True)
        .limit(5)
        .execute()
    )
    top_locations = [r["location"] for r in (loc_res.data or [])]

    # ── 3. Sonuç ──────────────────────────────────────────────────────────
    stats = {
        "total_count": corr_count + rfi_count + pdf_count + manual_count,
        "corr_count": corr_count,
        "rfi_count": rfi_count,
        "pdf_count": pdf_count,
        "manual_count": manual_count,
        "by_corr_type": by_corr_type,
        "by_rfi_discipline": by_rfi_discipline,
        "by_doc_type": by_doc_type,
        "top_keywords": top_keywords,
        "top_locations": top_locations,
        "by_chronology_type": by_chronology_type,
        "contract_doc_count": contract_doc_count,
        "changes_approved": changes_approved,
        "changes_under_review": changes_under_review,
        "changes_disputed": changes_disputed,
        "other_amendments_count": 0,  # TB-25: no entity yet
    }

    # ── 4. Cache'e yaz (admin client — RLS bypass) ─────────────────────────
    admin_db.table("project_document_stats").upsert({
        "project_id": p_id,
        "stats_json": stats,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    return stats


# ════════════════════════════════════════════════════
# GET /all-relations — full project graph (existing UI)
# ════════════════════════════════════════════════════

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
    """
    db = access["db"]
    try:
        all_nodes, node_map, parent_map, children_map = _build_relation_index(project_id, db)
        if not all_nodes:
            return {"nodes": [], "edges": []}

        nodes = [
            {
                "id": n["id"], "ref": n["ref"], "subject": n["subject"],
                "status": n["status"], "entity_type": n["entity_type"],
                "date": n.get("date"), "keywords": n.get("keywords") or [],
                **({"rfi_type": n["rfi_type"]} if n["entity_type"] == "rfi" else {}),
            }
            for n in all_nodes
        ]

        edges: list[dict] = []
        seen_edges: set = set()

        def _add_edge(src: str, tgt: str, score: float, layer: str) -> None:
            key = (min(src, tgt), max(src, tgt))
            if key in seen_edges:
                return
            seen_edges.add(key)
            edges.append({"source": src, "target": tgt, "score": score, "layer": layer})

        for n in all_nodes:
            if n.get("parent_id"):
                _add_edge(n["parent_id"], n["id"], 1.0, "chain")

        sibling_groups: dict = defaultdict(list)
        for n in all_nodes:
            if n.get("parent_id"):
                sibling_groups[n["parent_id"]].append(n["id"])
        for sibs in sibling_groups.values():
            for i in range(len(sibs)):
                for j in range(i + 1, len(sibs)):
                    _add_edge(sibs[i], sibs[j], 0.9, "sibling")

        node_ids = list(node_map.keys())
        for i in range(len(node_ids)):
            for j in range(i + 1, len(node_ids)):
                nid1, nid2 = node_ids[i], node_ids[j]
                key = (min(nid1, nid2), max(nid1, nid2))
                if key in seen_edges:
                    continue
                score = _content_score(node_map[nid1], node_map[nid2])
                if score >= CONTENT_RELATION_THRESHOLD:
                    _add_edge(nid1, nid2, score, "content")

        return {"nodes": nodes, "edges": edges}

    except Exception as exc:
        logger.error("Proje ilişki grafiği hatası: %s | project=%s", exc, project_id)
        raise HTTPException(status_code=500, detail="Belge ilişki grafiği alınamadı.")


# ════════════════════════════════════════════════════
# GET /card-relations/{entity_type}/{entity_id}
# Single-card popup — chain (transitive) + content.
# ════════════════════════════════════════════════════

@router.get("/card-relations/{entity_type}/{entity_id}", status_code=200)
def get_card_relations(
    project_id: str,
    entity_type: str,
    entity_id: str,
    access=Depends(verify_project_access),
):
    """Related cards for a single correspondence/rfi, grouped by
    relation strength:
      1. chain   — full transitive parent/child tree (strongest)
      2. content — keyword + subject overlap (weaker, deterministic)
    Response: { chain: [...], content: [...] }
    Each item: { id, ref, subject, status, entity_type, score, parent_id }
    """
    if entity_type not in ("correspondence", "rfi"):
        raise HTTPException(status_code=400, detail="Geçersiz entity_type.")

    db = access["db"]
    try:
        all_nodes, node_map, parent_map, children_map = _build_relation_index(project_id, db)
        self_node = node_map.get(entity_id)
        if not self_node:
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")

        chain_ids = _full_chain_ids(entity_id, parent_map, children_map)
        content_scores = _content_neighbors(
            entity_id, self_node, all_nodes,
            exclude_ids=chain_ids | {entity_id},
        )

        def _strip(n: dict, score: float) -> dict:
            return {
                "id": n["id"], "ref": n["ref"], "subject": n["subject"],
                "status": n["status"], "entity_type": n["entity_type"],
                "score": score, "parent_id": n.get("parent_id"),
            }

        content_items = sorted(
            [_strip(node_map[i], s) for i, s in content_scores.items() if i in node_map],
            key=lambda x: x["score"], reverse=True,
        )

        return {
            "chain": [_strip(node_map[i], 1.0) for i in chain_ids if i in node_map],
            "content": content_items,
        }

    except Exception as exc:
        logger.error("Kart ilişki hatası: %s | entity=%s/%s", exc, entity_type, entity_id)
        raise HTTPException(status_code=500, detail="İlişkili kayıtlar alınamadı.")


# ════════════════════════════════════════════════════
# GET /focused-graph/{entity_type}/{entity_id}
# 2-hop relation graph centered on one card, for the
# Documents-tab node graph triggered from RelationPopup.
# ════════════════════════════════════════════════════

@router.get("/focused-graph/{entity_type}/{entity_id}", status_code=200)
def get_focused_graph(
    project_id: str,
    entity_type: str,
    entity_id: str,
    access=Depends(verify_project_access),
):
    """2-hop relation graph centered on one card.

    Tiers (strongest to weakest):
      chain    — in center's full transitive chain tree, OR in a
                 directly-related node's own chain tree. Structural
                 and deterministic — always promoted to this tier
                 regardless of hop distance from center.
      content  — direct content-similarity match to center (1-hop).
      reference — explicit card reference (1-hop, terminal, non-transitive).
      A matched neighbor's full chain is pulled in; chain members that
      don't themselves match the center appear linked to their matched
      sibling as 'cross' (peripheral), never to the center.

    Nodes are deduplicated globally — a node keeps its strongest
    tier if reachable multiple ways. Capped at MAX_FOCUS_NODES
    (sorted by tier then score) to keep the graph readable.
    """
    if entity_type not in ("correspondence", "rfi"):
        raise HTTPException(status_code=400, detail="Geçersiz entity_type.")

    MAX_FOCUS_NODES = 30

    db = access["db"]
    try:
        all_nodes, node_map, parent_map, children_map = _build_relation_index(
            project_id, db, preserve_entity_id=entity_id,
        )
        center = node_map.get(entity_id)
        if not center:
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")

        tiers: dict = {}
        scores: dict = {}
        edges: list[dict] = []
        synthetic_nodes: dict = {}

        # ── Hop 1: center's own relations ───────────────────
        chain_ids = _full_chain_ids(entity_id, parent_map, children_map)
        # Center'ın yapısal zincir bileşeni — chain tier yalnızca buna verilir.
        center_chain_component = chain_ids | {entity_id}

        ref_edges, reference_terminal_ids = _gather_center_reference_edges(
            entity_id, entity_type, project_id, db, node_map, synthetic_nodes,
        )
        content_scores = _content_neighbors(
            entity_id, center, all_nodes,
            exclude_ids=chain_ids | {entity_id} | reference_terminal_ids,
        )
        direct_ids = chain_ids | set(content_scores.keys())

        for cid in chain_ids:
            tiers[cid] = "chain"
            scores[cid] = 1.0
            parent = parent_map.get(cid)
            if parent and (parent == entity_id or parent in chain_ids):
                edges.append({"source": parent, "target": cid, "score": 1.0, "tier": "chain"})

        # BUG FIX: the loop above only connects a chain member
        # to ITS OWN parent when that parent is the center or
        # another chain member. It never adds the edge from the
        # center's own direct parent TO the center, because the
        # center itself is excluded from chain_ids. Without this
        # edge, an ancestor of the center (e.g. entity's parent)
        # has no path to center in the edges array, so the
        # frontend's BFS layout treats it as unreachable and
        # never renders it — even though it's present in `nodes`.
        entity_parent = parent_map.get(entity_id)
        if entity_parent and entity_parent in chain_ids:
            edges.append({"source": entity_parent, "target": entity_id, "score": 1.0, "tier": "chain"})

        center_ref_pairs: set = set()
        chain_pairs = {frozenset((e["source"], e["target"])) for e in edges if e["tier"] == "chain"}
        for re in ref_edges:
            pair = frozenset((re["source"], re["target"]))
            other = re["target"] if re["source"] == entity_id else re["source"]
            if other in chain_ids or pair in chain_pairs:
                continue
            edges.append(re)
            center_ref_pairs.add(pair)
            if tiers.get(other) != "chain":
                tiers[other] = "reference"
                scores[other] = 1.0

        for cid, sc in content_scores.items():
            if frozenset((entity_id, cid)) in center_ref_pairs:
                continue
            if tiers.get(cid) == "reference":
                continue
            tiers[cid] = "content"
            scores[cid] = sc
            edges.append({"source": entity_id, "target": cid, "score": sc, "tier": "content"})

        # ── Chain edges WITHIN direct_ids ────────────────────
        # A node can reach the center via content similarity while ALSO
        # having a real parent_id chain relationship to another directly-related node (e.g.
        # RFI-011 is content-linked separately to CORR-009,
        # CORR-010, AND CORR-011, but those three also form a
        # real chain among themselves). The hop-1/hop-2 logic
        # above only chain-walks from each node's OWN position
        # and skips anything already in direct_ids — so these
        # mutual chain relationships were never drawn. Fix:
        # explicitly check every pair within direct_ids for a
        # direct parent-child relationship and add the edge.
        direct_list = list(direct_ids)
        for i in range(len(direct_list)):
            for j in range(len(direct_list)):
                if i == j:
                    continue
                a, b = direct_list[i], direct_list[j]
                if parent_map.get(b) == a:
                    # Chain tier yalnızca center'ın kendi zincir bileşenindeyse.
                    if a in center_chain_component and b in center_chain_component:
                        tiers[a] = "chain"
                        tiers[b] = "chain"
                        scores[a] = 1.0
                        scores[b] = 1.0
                        edges.append({"source": a, "target": b, "score": 1.0, "tier": "chain"})
                    else:
                        # Peripheral parent-child — cross bağlantı, content tier'ı ezme.
                        edges.append({"source": a, "target": b, "score": 0.5, "tier": "cross"})

        # ── Hop 2: relations of each directly-related node ──
        for rid in direct_ids:
            r_node = node_map.get(rid)
            if not r_node:
                continue

            # 2a. that node's own chain tree — promoted to "chain"
            r_chain_ids = _full_chain_ids(rid, parent_map, children_map)
            for cid2 in r_chain_ids:
                if cid2 == entity_id or cid2 in direct_ids:
                    continue
                if tiers.get(cid2) != "chain":
                    tiers[cid2] = "chain"
                    scores[cid2] = 1.0
                parent2 = parent_map.get(cid2)
                if parent2 and (parent2 == rid or parent2 in r_chain_ids):
                    edges.append({"source": parent2, "target": cid2, "score": 1.0, "tier": "chain"})

        # ── Cross edges (lowest priority) ─────────────────────
        # Content similarity BETWEEN non-center nodes that are
        # already in the graph. These are real keyword links but
        # secondary to the focus's own relations — e.g. with
        # CORR-011 as center, CORR-009<->RFI-011 share keywords
        # but that's peripheral to CORR-011's story. Draw them
        # so the relationship is discoverable, but at the
        # faintest tier ("cross") so they never compete visually
        # with the center's direct edges. Only added when the
        # pair has NO stronger edge already (chain/content); those win.
        placed_ids = set(tiers.keys())
        existing_pairs = {
            frozenset((e["source"], e["target"])) for e in edges
        }
        placed_list = list(placed_ids)
        for i in range(len(placed_list)):
            for j in range(i + 1, len(placed_list)):
                a, b = placed_list[i], placed_list[j]
                if a == entity_id or b == entity_id:
                    continue
                if a in reference_terminal_ids or b in reference_terminal_ids:
                    continue
                if frozenset((a, b)) in existing_pairs:
                    continue
                na, nb = node_map.get(a), node_map.get(b)
                if not na or not nb:
                    continue
                cs = _content_score(na, nb)
                if cs >= CONTENT_RELATION_THRESHOLD:
                    edges.append({
                        "source": a, "target": b,
                        "score": cs, "tier": "cross",
                    })

        # ── Downgrade peripheral chain edges ──────────────────
        # A chain edge is only "chain"-worthy if the center is
        # structurally part of that chain. The center's own
        # chain component is entity_id + its full transitive
        # chain (_full_chain_ids). If BOTH endpoints of a chain
        # edge fall OUTSIDE this component, the center is not a
        # member of that chain — its internal parent/child links
        # are peripheral (possibly coincidental relative to the
        # center's keyword links), so they must not visually
        # outweigh the center's own relations. Downgrade such
        # edges to "cross" (faintest tier). Applied generically
        # for any center / graph shape.
        # center_chain_component Hop 1'de tanımlandı — yeniden hesaplama yok.
        for e in edges:
            if e["tier"] != "chain":
                continue
            if (
                e["source"] not in center_chain_component
                and e["target"] not in center_chain_component
            ):
                e["tier"] = "cross"
                e["score"] = round(e["score"] * 0.5, 3)
                # Node tier'larını da düzelt — yanıltıcı "Zincir" etiketini kaldır.
                for nid in (e["source"], e["target"]):
                    if nid != entity_id and tiers.get(nid) == "chain":
                        tiers[nid] = "content"

        # ── Dedupe edges ──────────────────────────────────────
        # One edge per unordered pair — strongest tier wins
        # (chain > reference > content > cross).
        best_by_pair: dict = {}
        for e in edges:
            pair = frozenset((e["source"], e["target"]))
            cur = best_by_pair.get(pair)
            if cur is None or _TIER_STRENGTH[e["tier"]] > _TIER_STRENGTH[cur["tier"]]:
                best_by_pair[pair] = e
        edges = list(best_by_pair.values())

        # ── Cap + assemble ───────────────────────────────────
        tier_rank = {"chain": 0, "reference": 1, "content": 2}
        kept_ordered = sorted(
            tiers.keys(),
            key=lambda i: (tier_rank[tiers[i]], -scores[i]),
        )[:MAX_FOCUS_NODES]
        kept_ids = set(kept_ordered)

        nodes = [
            {
                "id": nid,
                "ref": (node_map.get(nid) or synthetic_nodes[nid])["ref"],
                "subject": (node_map.get(nid) or synthetic_nodes[nid])["subject"],
                "status": (node_map.get(nid) or synthetic_nodes[nid])["status"],
                "entity_type": (node_map.get(nid) or synthetic_nodes[nid])["entity_type"],
                "tier": tiers[nid], "score": scores[nid],
            }
            for nid in kept_ordered
            if nid in node_map or nid in synthetic_nodes
        ]
        valid_ids = kept_ids | {entity_id}
        final_edges = [e for e in edges if e["source"] in valid_ids and e["target"] in valid_ids]

        center_out = {
            "id": center["id"], "ref": center["ref"], "subject": center["subject"],
            "status": center["status"], "entity_type": center["entity_type"],
            "tier": "center", "score": 1.0,
        }

        total_found = len(tiers)
        truncated = total_found > len(kept_ordered)

        return {
            "center": center_out,
            "nodes": nodes,
            "edges": final_edges,
            "total_found": total_found,
            "truncated": truncated,
            "hidden_count": total_found - len(kept_ordered) if truncated else 0,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Odaklı graph hatası: %s | entity=%s/%s", exc, entity_type, entity_id)
        raise HTTPException(status_code=500, detail="İlişki haritası alınamadı.")



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
