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
from backend.core.limiter import limiter
from backend.database import get_admin_client
from backend.services.permission_service import PermissionService
from backend.utils.file_handler import upload_document, delete_document, get_signed_url
from backend.utils.pdf_utils import validate_document_bytes
from fastapi import BackgroundTasks
from backend.models.document import (
    DocumentMetadataUpdate,
    DocumentMetadataApprove,
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


# ════════════════════════════════════════════════════
# Shared relation-computation helpers
# Used by /all-relations, /card-relations, /focused-graph.
# Single source of truth — avoids triplicated scoring logic.
# ════════════════════════════════════════════════════

def _build_relation_index(project_id: str, db):
    """Fetch all correspondences + rfis for a project once.
    Returns (all_nodes, node_map, parent_map, children_map).
    Single pair of queries — reused across all relation endpoints
    to avoid repeated DB round-trips (no N+1).
    """
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

    return all_nodes, node_map, parent_map, children_map


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


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
    """Average of keyword Jaccard + subject token overlap."""
    kw = _jaccard(set(n1.get("keywords") or []), set(n2.get("keywords") or []))
    sub = _subject_overlap(n1.get("subject") or "", n2.get("subject") or "")
    return round((kw + sub) / 2, 3)


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
    exclude_ids: set, threshold: float = 0.25,
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
                if score >= 0.25:
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
      indirect — content-similarity match of a directly-related
                 node, with no direct link to center (2-hop only).
                 Weakest — probabilistic signal on a probabilistic
                 signal. Score is halved to reflect this.

    Nodes are deduplicated globally — a node keeps its strongest
    tier if reachable multiple ways. Capped at MAX_FOCUS_NODES
    (sorted by tier then score) to keep the graph readable.
    """
    if entity_type not in ("correspondence", "rfi"):
        raise HTTPException(status_code=400, detail="Geçersiz entity_type.")

    MAX_FOCUS_NODES = 30

    db = access["db"]
    try:
        all_nodes, node_map, parent_map, children_map = _build_relation_index(project_id, db)
        center = node_map.get(entity_id)
        if not center:
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")

        tiers: dict = {}
        scores: dict = {}
        edges: list[dict] = []

        # ── Hop 1: center's own relations ───────────────────
        chain_ids = _full_chain_ids(entity_id, parent_map, children_map)
        content_scores = _content_neighbors(
            entity_id, center, all_nodes,
            exclude_ids=chain_ids | {entity_id},
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

        for cid, sc in content_scores.items():
            tiers[cid] = "content"
            scores[cid] = sc
            edges.append({"source": entity_id, "target": cid, "score": sc, "tier": "content"})

        # ── Chain edges WITHIN direct_ids ────────────────────
        # A node can reach the center via content/indirect
        # similarity while ALSO having a real parent_id chain
        # relationship to another directly-related node (e.g.
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
                    tiers[a] = "chain"
                    tiers[b] = "chain"
                    scores[a] = 1.0
                    scores[b] = 1.0
                    edges.append({"source": a, "target": b, "score": 1.0, "tier": "chain"})

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

            # 2b. that node's own content neighbors — weakest tier
            r_content = _content_neighbors(
                rid, r_node, all_nodes,
                exclude_ids=direct_ids | {entity_id, rid} | r_chain_ids,
            )
            for cid2, sc2 in r_content.items():
                if cid2 not in tiers:
                    weakened = round(sc2 * 0.5, 3)
                    tiers[cid2] = "indirect"
                    scores[cid2] = weakened
                    edges.append({"source": rid, "target": cid2, "score": weakened, "tier": "indirect"})

        # ── Dedupe edges ──────────────────────────────────────
        # Multiple direct_ids can rediscover the same chain
        # relationship from different iterations (e.g. center
        # content-linked to 3 chain siblings independently, each
        # re-walks the shared chain and re-adds the same edge).
        # Keep first occurrence per (unordered pair, tier).
        seen_edge_keys: set = set()
        deduped_edges: list[dict] = []
        for e in edges:
            key = (frozenset((e["source"], e["target"])), e["tier"])
            if key in seen_edge_keys:
                continue
            seen_edge_keys.add(key)
            deduped_edges.append(e)
        edges = deduped_edges

        # ── Cap + assemble ───────────────────────────────────
        tier_rank = {"chain": 0, "content": 1, "indirect": 2}
        kept_ordered = sorted(
            tiers.keys(),
            key=lambda i: (tier_rank[tiers[i]], -scores[i]),
        )[:MAX_FOCUS_NODES]
        kept_ids = set(kept_ordered)

        nodes = [
            {
                "id": node_map[i]["id"], "ref": node_map[i]["ref"],
                "subject": node_map[i]["subject"], "status": node_map[i]["status"],
                "entity_type": node_map[i]["entity_type"],
                "tier": tiers[i], "score": scores[i],
            }
            for i in kept_ordered if i in node_map
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
