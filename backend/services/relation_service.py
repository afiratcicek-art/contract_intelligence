"""Document relation detection service.

Triggered after embedding pipeline completes (pdf_pipeline_service.py).
Computes composite relevance score for every doc-pair in the project:

    composite = 0.6 × keyword_jaccard + 0.4 × semantic_cosine

Pairs scoring >= 0.25 are upserted to document_relations (migration 018).
score_breakdown stored as JSONB for graph edge labelling.

Runs synchronously inside the background pdf_worker — no user latency.
TB-12: move to async queue at scale.
"""

import logging
from typing import Optional

from backend.database import get_admin_client
from backend.services.audit_service import AuditService

logger = logging.getLogger(__name__)

# ── Score weights ──────────────────────────────────────────────────────────────
_KEYWORD_WEIGHT  = 0.6   # keyword Jaccard dominates — fast, deterministic
_SEMANTIC_WEIGHT = 0.4   # pgvector cosine supports semantic overlap
_MIN_SCORE       = 0.25  # pairs below this are not stored


def _jaccard(a: set[str], b: set[str]) -> float:
    """Jaccard similarity: |a ∩ b| / |a ∪ b|. Returns 0.0 for empty sets."""
    if not a or not b:
        return 0.0
    union = len(a | b)
    return len(a & b) / union if union else 0.0


class RelationService:
    """Detect and persist document relationships.

    Uses get_admin_client() (service-role) for all DB writes —
    consistent with EmbeddingService and AuditService.
    """

    def __init__(self) -> None:
        self._db    = get_admin_client()
        self._audit = AuditService()

    # ── Public API ─────────────────────────────────────────────────────────────

    def detect_relations(
        self,
        doc_id:     str,
        project_id: str,
        user_id:    str,
    ) -> None:
        """Entry point. Errors are logged and swallowed — must not block pipeline."""
        try:
            self._run(doc_id, project_id, user_id)
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Relation detection failed (non-critical): %s | doc_id=%s",
                exc,
                doc_id,
            )

    # ── Internal ───────────────────────────────────────────────────────────────

    def _run(
        self,
        doc_id:     str,
        project_id: str,
        user_id:    str,
    ) -> None:
        # 1. Source doc keywords
        src_res = (
            self._db.table("pdf_document")
            .select("keywords")
            .eq("id", doc_id)
            .single()
            .execute()
        )
        src_keywords: set[str] = set(
            (src_res.data or {}).get("keywords") or []
        )

        # 2. Candidate docs in same project (keywords only — no N+1)
        cand_res = (
            self._db.table("pdf_document")
            .select("id, keywords")
            .eq("project_id", project_id)
            .neq("id", doc_id)
            .execute()
        )
        candidates: list[dict] = cand_res.data or []

        if not candidates:
            logger.debug(
                "No candidates in project — skipping relation detection | doc_id=%s",
                doc_id,
            )
            return

        # 3. Semantic similarity via pgvector RPC (migration 023)
        sem_res = (
            self._db.rpc(
                "find_similar_documents",
                {"p_doc_id": doc_id, "p_project_id": project_id},
            ).execute()
        )
        semantic_map: dict[str, float] = {
            row["target_doc_id"]: float(row["semantic_score"])
            for row in (sem_res.data or [])
        }

        # 4. Composite score per candidate
        relations: list[dict] = []
        for cand in candidates:
            cand_id       = cand["id"]
            cand_keywords = set(cand.get("keywords") or [])

            keyword_score  = _jaccard(src_keywords, cand_keywords)
            semantic_score = semantic_map.get(cand_id, 0.0)
            composite      = round(
                _KEYWORD_WEIGHT * keyword_score
                + _SEMANTIC_WEIGHT * semantic_score,
                3,
            )

            if composite < _MIN_SCORE:
                continue

            relations.append(
                {
                    "project_id":      project_id,
                    "source_doc_id":   doc_id,
                    "target_doc_id":   cand_id,
                    "score":           composite,
                    "score_breakdown": {
                        "keyword":  round(keyword_score,  3),
                        "semantic": round(semantic_score, 3),
                    },
                    "relation_type": "detected",
                }
            )

        if not relations:
            logger.debug(
                "No relations above threshold | doc_id=%s", doc_id
            )
            return

        # 5. Bulk upsert — UNIQUE(source_doc_id, target_doc_id)
        (
            self._db.table("document_relations")
            .upsert(
                relations,
                on_conflict="source_doc_id,target_doc_id",
            )
            .execute()
        )

        # 6. Audit trail
        self._audit.log(
            action="relation_detected",
            entity_type="pdf_document",
            entity_id=doc_id,
            user_id=user_id,
            project_id=project_id,
            new_value={"relations_count": len(relations)},
        )

        logger.info(
            "Relation detection complete: %d relations stored | doc_id=%s",
            len(relations),
            doc_id,
        )


def get_relation_service() -> RelationService:
    """Factory — consistent with get_embedding_service() pattern."""
    return RelationService()
