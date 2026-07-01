"""Document relation detection service.

Two-layer relation detection:

Layer 1 — Deterministic chain relations (API-key free):
  Walks entity chain (correspondence parent/child, rfi parent/child).
  Chain members get score=1.0 — highest confidence.

Layer 2 — Probabilistic scoring:
  composite = 0.6 × keyword_jaccard + 0.4 × semantic_cosine
  Non-chain pairs scoring >= 0.25 are stored.

Runs synchronously inside pdf_worker (ADIM 6) — no user latency.
TB-12: move to async queue at scale.
"""
import logging

from backend.database import get_admin_client
from backend.services.audit_service import AuditService

logger = logging.getLogger(__name__)

# ── Score weights ──────────────────────────────────────────────────────────────
_KEYWORD_WEIGHT  = 0.6
_SEMANTIC_WEIGHT = 0.4
_MIN_SCORE       = 0.25
_CHAIN_SCORE     = 1.0   # direct chain member — highest confidence


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
        # 1. Source doc: keywords + entity info
        src_res = (
            self._db.table("pdf_document")
            .select("keywords, entity_type, entity_id")
            .eq("id", doc_id)
            .single()
            .execute()
        )
        src_data = src_res.data or {}
        src_keywords: set[str] = set(src_data.get("keywords") or [])
        entity_type: str = src_data.get("entity_type") or ""
        entity_id:   str = src_data.get("entity_id")   or ""

        # 2. Candidate docs in same project (single query — no N+1)
        cand_res = (
            self._db.table("pdf_document")
            .select("id, keywords, entity_id")
            .eq("project_id", project_id)
            .neq("id", doc_id)
            .execute()
        )
        candidates: list[dict] = cand_res.data or []

        if not candidates:
            logger.debug(
                "No candidates in project — skipping | doc_id=%s", doc_id
            )
            return

        # 3. Chain entity IDs — deterministic, API-key free
        chain_entity_ids: set[str] = self._chain_entity_ids(
            entity_type, entity_id
        )

        # 4. Semantic similarity via pgvector RPC (migration 023)
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

        # 5. Score per candidate
        relations: list[dict] = []
        for cand in candidates:
            cand_id        = cand["id"]
            cand_entity_id = cand.get("entity_id") or ""
            cand_keywords  = set(cand.get("keywords") or [])

            # Layer 1 — Chain member: score = 1.0, skip probabilistic scoring
            if cand_entity_id and cand_entity_id in chain_entity_ids:
                relations.append(
                    {
                        "project_id":      project_id,
                        "source_doc_id":   doc_id,
                        "target_doc_id":   cand_id,
                        "score":           _CHAIN_SCORE,
                        "score_breakdown": {
                            "chain":    1.0,
                            "keyword":  0.0,
                            "semantic": 0.0,
                        },
                        "relation_type": "detected",
                    }
                )
                continue

            # Layer 2 — Probabilistic: keyword Jaccard + semantic cosine
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
                        "chain":    0.0,
                        "keyword":  round(keyword_score,  3),
                        "semantic": round(semantic_score, 3),
                    },
                    "relation_type": "detected",
                }
            )

        if not relations:
            logger.debug("No relations above threshold | doc_id=%s", doc_id)
            return

        # 6. Bulk upsert — UNIQUE(source_doc_id, target_doc_id)
        (
            self._db.table("document_relations")
            .upsert(
                relations,
                on_conflict="source_doc_id,target_doc_id",
            )
            .execute()
        )

        # 7. Audit trail
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

    # ── Chain detection (API-key free) ─────────────────────────────────────────

    def _chain_entity_ids(
        self,
        entity_type: str,
        entity_id:   str,
    ) -> set[str]:
        """Return entity_ids of all chain members for the given entity.

        Correspondence: walks parent_id up to root, collects all children.
        RFI: same pattern via rfis.parent_id.
        Returns empty set for unsupported types or missing entity_id.
        """
        if not entity_type or not entity_id:
            return set()
        if entity_type == "correspondence":
            return self._corr_chain_ids(entity_id)
        if entity_type == "rfi":
            return self._rfi_chain_ids(entity_id)
        return set()

    def _corr_chain_ids(self, corr_id: str) -> set[str]:
        """All correspondence entity_ids in the same chain (excl. self).

        Step A: walk up to root (max 10 hops).
        Step B: collect all descendants of root (single query per level,
                max 10 hops — chains are short in practice).
        """
        # Walk up to root
        root_id     = corr_id
        current_id  = corr_id
        for _ in range(10):
            res = (
                self._db.table("correspondences")
                .select("parent_id")
                .eq("id", current_id)
                .single()
                .execute()
            )
            parent_id = (res.data or {}).get("parent_id")
            if not parent_id:
                root_id = current_id
                break
            root_id    = parent_id
            current_id = parent_id

        # Walk down from root — BFS
        all_ids: set[str] = set()
        queue:   list[str] = [root_id]
        visited: set[str]  = set()
        depth = 0
        while queue and depth < 10:
            curr = queue.pop(0)
            if curr in visited:
                continue
            visited.add(curr)
            all_ids.add(curr)
            children_res = (
                self._db.table("correspondences")
                .select("id")
                .eq("parent_id", curr)
                .execute()
            )
            for child in (children_res.data or []):
                queue.append(child["id"])
            depth += 1

        all_ids.discard(corr_id)   # exclude self
        return all_ids

    def _rfi_chain_ids(self, rfi_id: str) -> set[str]:
        """All RFI entity_ids in the same chain (excl. self).

        Same BFS pattern as _corr_chain_ids but on rfis table.
        """
        # Walk up to root
        root_id     = rfi_id
        current_id  = rfi_id
        for _ in range(10):
            res = (
                self._db.table("rfis")
                .select("parent_id")
                .eq("id", current_id)
                .single()
                .execute()
            )
            parent_id = (res.data or {}).get("parent_id")
            if not parent_id:
                root_id = current_id
                break
            root_id    = parent_id
            current_id = parent_id

        # Walk down from root — BFS
        all_ids: set[str] = set()
        queue:   list[str] = [root_id]
        visited: set[str]  = set()
        depth = 0
        while queue and depth < 10:
            curr = queue.pop(0)
            if curr in visited:
                continue
            visited.add(curr)
            all_ids.add(curr)
            children_res = (
                self._db.table("rfis")
                .select("id")
                .eq("parent_id", curr)
                .execute()
            )
            for child in (children_res.data or []):
                queue.append(child["id"])
            depth += 1

        all_ids.discard(rfi_id)    # exclude self
        return all_ids


def get_relation_service() -> RelationService:
    """Factory — consistent with get_embedding_service() pattern."""
    return RelationService()
