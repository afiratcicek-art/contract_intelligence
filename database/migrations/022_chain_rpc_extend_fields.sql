-- ============================================================
-- Migration 022: Extend chain search RPCs with fields needed
-- by frontend RFIItem/CorrItem types (response_due_date for
-- both; type and direction for correspondence).
-- Required to let RFI/Correspondence tab search use these
-- RPCs directly instead of separate list+filter logic.
-- ============================================================

CREATE OR REPLACE FUNCTION search_rfi_chains(
    p_project_id    UUID,
    p_query         TEXT,
    p_limit         INTEGER DEFAULT 200
)
RETURNS TABLE (
    id                  UUID,
    rfi_number          TEXT,
    subject             TEXT,
    status              TEXT,
    submitted_date      DATE,
    response_due_date   DATE,
    discipline          TEXT,
    parent_id           UUID,
    rfi_type            TEXT
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
    WITH matched_ids AS (
        SELECT r.id
        FROM rfis r
        WHERE r.project_id = p_project_id
          AND r.is_deleted = false
          AND r.search_vector @@ websearch_to_tsquery('english', p_query)

        UNION

        SELECT r.id
        FROM rfis r
        WHERE r.project_id = p_project_id
          AND r.is_deleted = false
          AND EXISTS (
              SELECT 1 FROM pdf_document pd
              WHERE pd.entity_type = 'rfi'
                AND pd.entity_id = r.id
                AND pd.search_vector @@ websearch_to_tsquery('english', p_query)
          )
    ),
    roots AS (
        SELECT DISTINCT
            COALESCE(
                (SELECT r2.id FROM rfis r2
                 WHERE r2.id = (
                     WITH RECURSIVE up_chain AS (
                         SELECT id, parent_id, 0 AS depth
                         FROM rfis WHERE id = m.id
                         UNION ALL
                         SELECT r3.id, r3.parent_id, up_chain.depth + 1
                         FROM rfis r3
                         JOIN up_chain ON r3.id = up_chain.parent_id
                         WHERE up_chain.depth < 20
                     )
                     SELECT id FROM up_chain
                     WHERE parent_id IS NULL
                     LIMIT 1
                 )),
                m.id
            ) AS root_id
        FROM matched_ids m
    ),
    chain_members AS (
        WITH RECURSIVE down_chain AS (
            SELECT r.id, r.parent_id, 0 AS depth
            FROM rfis r
            JOIN roots ON r.id = roots.root_id
            UNION ALL
            SELECT r4.id, r4.parent_id, down_chain.depth + 1
            FROM rfis r4
            JOIN down_chain ON r4.parent_id = down_chain.id
            WHERE down_chain.depth < 20
        )
        SELECT DISTINCT id FROM down_chain
    )
    SELECT
        r.id,
        r.rfi_number,
        r.subject,
        r.status,
        r.submitted_date,
        r.response_due_date,
        r.discipline,
        r.parent_id,
        r.rfi_type
    FROM rfis r
    JOIN chain_members cm ON r.id = cm.id
    WHERE r.project_id = p_project_id
      AND r.is_deleted = false
    ORDER BY r.submitted_date DESC NULLS LAST
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION search_rfi_chains IS
    'Chain-aware RFI search. Matches on subject (FTS) or '
    'attached document keywords/location. Returns full chains '
    '(root + all responses/revisions), not just matching rows. '
    'Includes response_due_date for frontend RFIItem compatibility. '
    'SECURITY INVOKER — RLS enforced.';

CREATE OR REPLACE FUNCTION search_correspondence_chains(
    p_project_id    UUID,
    p_query         TEXT,
    p_limit         INTEGER DEFAULT 200
)
RETURNS TABLE (
    id                      UUID,
    corr_number             TEXT,
    subject                 TEXT,
    type                    TEXT,
    status                  TEXT,
    correspondence_date     DATE,
    response_due_date       DATE,
    direction               TEXT,
    parent_id               UUID,
    has_response            BOOLEAN
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
    WITH matched_ids AS (
        SELECT c.id
        FROM correspondences c
        WHERE c.project_id = p_project_id
          AND c.is_deleted = false
          AND c.search_vector @@ websearch_to_tsquery('english', p_query)

        UNION

        SELECT c.id
        FROM correspondences c
        WHERE c.project_id = p_project_id
          AND c.is_deleted = false
          AND EXISTS (
              SELECT 1 FROM pdf_document pd
              WHERE pd.entity_type = 'correspondence'
                AND pd.entity_id = c.id
                AND pd.search_vector @@ websearch_to_tsquery('english', p_query)
          )
    ),
    roots AS (
        SELECT DISTINCT
            COALESCE(
                (SELECT c2.id FROM correspondences c2
                 WHERE c2.id = (
                     WITH RECURSIVE up_chain AS (
                         SELECT id, parent_id, 0 AS depth
                         FROM correspondences WHERE id = m.id
                         UNION ALL
                         SELECT c3.id, c3.parent_id, up_chain.depth + 1
                         FROM correspondences c3
                         JOIN up_chain ON c3.id = up_chain.parent_id
                         WHERE up_chain.depth < 20
                     )
                     SELECT id FROM up_chain
                     WHERE parent_id IS NULL
                     LIMIT 1
                 )),
                m.id
            ) AS root_id
        FROM matched_ids m
    ),
    chain_members AS (
        WITH RECURSIVE down_chain AS (
            SELECT c.id, c.parent_id, 0 AS depth
            FROM correspondences c
            JOIN roots ON c.id = roots.root_id
            UNION ALL
            SELECT c4.id, c4.parent_id, down_chain.depth + 1
            FROM correspondences c4
            JOIN down_chain ON c4.parent_id = down_chain.id
            WHERE down_chain.depth < 20
        )
        SELECT DISTINCT id FROM down_chain
    )
    SELECT
        c.id,
        c.corr_number,
        c.subject,
        c.type,
        c.status,
        c.correspondence_date,
        c.response_due_date,
        c.direction,
        c.parent_id,
        c.has_response
    FROM correspondences c
    JOIN chain_members cm ON c.id = cm.id
    WHERE c.project_id = p_project_id
      AND c.is_deleted = false
    ORDER BY c.correspondence_date DESC NULLS LAST
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION search_correspondence_chains IS
    'Chain-aware correspondence search. Matches on subject (FTS) '
    'or attached document keywords/location. Returns full chains, '
    'not just matching rows. Includes type, direction, '
    'response_due_date for frontend CorrItem compatibility. '
    'SECURITY INVOKER — RLS enforced.';
