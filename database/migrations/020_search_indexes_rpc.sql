-- ============================================================
-- Migration 020: Full-text search indexes + search RPC
-- Enables morphological search across documents, RFIs,
-- and correspondences with English stemming.
-- RPC: SECURITY INVOKER — caller permissions, RLS enforced.
-- ============================================================

-- ------------------------------------------------------------
-- 1. GIN index — pdf_document full-text search
--    Covers: keywords array, location, filename, doc_type
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pdf_doc_fts
    ON pdf_document
    USING gin(
        to_tsvector('english',
            coalesce(array_to_string(keywords, ' '), '') || ' ' ||
            coalesce(location, '') || ' ' ||
            coalesce(original_filename, '') || ' ' ||
            coalesce(doc_type, '')
        )
    );

-- GIN index for keywords array containment search (@>)
CREATE INDEX IF NOT EXISTS idx_pdf_doc_keywords_gin
    ON pdf_document USING gin(keywords);

-- ------------------------------------------------------------
-- 2. GIN index — rfis subject full-text search
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rfis_subject_fts
    ON rfis
    USING gin(to_tsvector('english', subject));

-- ------------------------------------------------------------
-- 3. GIN index — correspondences subject full-text search
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_correspondences_subject_fts
    ON correspondences
    USING gin(to_tsvector('english', subject));

-- ------------------------------------------------------------
-- 4. search_project_documents RPC
--    SECURITY INVOKER: runs with caller permissions.
--    auth.uid() works — RLS enforced on all three tables.
--    (select auth.uid()) pattern caches uid per query.
--    STABLE: allows query optimizer caching.
--    Filter options: general | keywords | location | 
--                    subject | filename | doc_type
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_project_documents(
    p_project_id    UUID,
    p_query         TEXT,
    p_filter        TEXT    DEFAULT 'general',
    p_limit         INTEGER DEFAULT 20
)
RETURNS TABLE (
    id                  UUID,
    project_id          UUID,
    entity_type         TEXT,
    entity_id           UUID,
    original_filename   TEXT,
    file_size_bytes     INTEGER,
    parse_status        TEXT,
    page_count          INTEGER,
    keywords            TEXT[],
    location            TEXT,
    doc_date            DATE,
    doc_type            TEXT,
    metadata_status     TEXT,
    metadata_source     TEXT,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ,
    subject             TEXT
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
    SELECT
        pd.id,
        pd.project_id,
        pd.entity_type,
        pd.entity_id,
        pd.original_filename,
        pd.file_size_bytes,
        pd.parse_status,
        pd.page_count,
        pd.keywords,
        pd.location,
        pd.doc_date,
        pd.doc_type,
        pd.metadata_status,
        pd.metadata_source,
        pd.created_at,
        pd.updated_at,
        -- Subject from linked entity (null for non-RFI/correspondence)
        COALESCE(r.subject, c.subject) AS subject
    FROM pdf_document pd
    LEFT JOIN rfis r
        ON pd.entity_type = 'rfi'
        AND pd.entity_id = r.id
        AND r.is_deleted = false
    LEFT JOIN correspondences c
        ON pd.entity_type = 'correspondence'
        AND pd.entity_id = c.id
        AND c.is_deleted = false
    WHERE
        pd.project_id = p_project_id
        AND (
            CASE p_filter
                WHEN 'keywords' THEN
                    to_tsvector('english',
                        coalesce(array_to_string(pd.keywords, ' '), '')
                    ) @@ websearch_to_tsquery('english', p_query)
                WHEN 'location' THEN
                    to_tsvector('english',
                        coalesce(pd.location, '')
                    ) @@ websearch_to_tsquery('english', p_query)
                WHEN 'filename' THEN
                    to_tsvector('english',
                        coalesce(pd.original_filename, '')
                    ) @@ websearch_to_tsquery('english', p_query)
                WHEN 'doc_type' THEN
                    to_tsvector('english',
                        coalesce(pd.doc_type, '')
                    ) @@ websearch_to_tsquery('english', p_query)
                WHEN 'subject' THEN
                    to_tsvector('english',
                        coalesce(r.subject, c.subject, '')
                    ) @@ websearch_to_tsquery('english', p_query)
                ELSE
                    -- general: all fields including subject
                    (
                        to_tsvector('english',
                            coalesce(array_to_string(pd.keywords, ' '), '') || ' ' ||
                            coalesce(pd.location, '') || ' ' ||
                            coalesce(pd.original_filename, '') || ' ' ||
                            coalesce(pd.doc_type, '') || ' ' ||
                            coalesce(r.subject, c.subject, '')
                        ) @@ websearch_to_tsquery('english', p_query)
                    )
            END
        )
    ORDER BY pd.doc_date DESC NULLS LAST
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION search_project_documents IS
    'Full-text document search across pdf_document, rfis, '
    'and correspondences. SECURITY INVOKER — RLS enforced. '
    'English stemming via websearch_to_tsquery. '
    'Filters: general | keywords | location | subject | '
    'filename | doc_type';
