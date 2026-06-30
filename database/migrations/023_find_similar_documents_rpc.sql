-- ============================================================
-- Migration 023: find_similar_documents — pgvector RPC
-- Computes average cosine similarity between all chunks of
-- source doc and all chunks of candidate docs in the project.
-- Called by RelationService (admin client) after embedding.
-- Note: Cross-join approach — does not use IVFFlat index.
-- Acceptable for background tasks; revisit at scale (TB-15).
-- ============================================================

CREATE OR REPLACE FUNCTION find_similar_documents(
    p_doc_id     UUID,
    p_project_id UUID,
    p_limit      INT DEFAULT 20
)
RETURNS TABLE (
    target_doc_id  UUID,
    semantic_score NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        t.doc_id                                                         AS target_doc_id,
        ROUND(
            AVG(1.0 - (s.embedding <=> t.embedding))::NUMERIC,
            3
        )                                                                AS semantic_score
    FROM  document_embeddings s
    JOIN  document_embeddings t
          ON  t.project_id = p_project_id
          AND t.doc_id    != p_doc_id
          AND t.embedding  IS NOT NULL
    WHERE s.doc_id    = p_doc_id
      AND s.embedding IS NOT NULL
    GROUP BY t.doc_id
    HAVING AVG(1.0 - (s.embedding <=> t.embedding)) >= 0.25
    ORDER BY 2 DESC
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION find_similar_documents(UUID, UUID, INT) IS
    'Returns target docs ordered by average cosine similarity '
    'against all chunks of the source doc. '
    'SECURITY DEFINER — called by admin/service-role client only. '
    'threshold=0.25, limit=20 by default.';
