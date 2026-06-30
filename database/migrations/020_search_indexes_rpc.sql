-- ============================================================
-- Migration 020: Full-text search — generated columns + RPC
-- 
-- PostgreSQL note: to_tsvector(regconfig, text) and 
-- array_to_string(text[], text) are STABLE, not IMMUTABLE.
-- Generated columns require IMMUTABLE expressions, so we wrap
-- both in IMMUTABLE functions with an explicit regconfig cast.
-- ============================================================

-- ------------------------------------------------------------
-- 1. IMMUTABLE wrapper functions
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION immutable_tsvector_english(text)
RETURNS tsvector
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT to_tsvector('english'::regconfig, $1)
$$;

CREATE OR REPLACE FUNCTION immutable_array_to_string(text[], text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT array_to_string($1, $2)
$$;

-- ------------------------------------------------------------
-- 2. Generated tsvector columns
-- ------------------------------------------------------------
ALTER TABLE pdf_document
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        immutable_tsvector_english(
            coalesce(immutable_array_to_string(keywords, ' '), '') || ' ' ||
            coalesce(location, '') || ' ' ||
            coalesce(original_filename, '') || ' ' ||
            coalesce(doc_type, '')
        )
    ) STORED;

ALTER TABLE rfis
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        immutable_tsvector_english(coalesce(subject, ''))
    ) STORED;

ALTER TABLE correspondences
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        immutable_tsvector_english(coalesce(subject, ''))
    ) STORED;

-- ------------------------------------------------------------
-- 3. GIN indexes on generated columns
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pdf_doc_search_vector
    ON pdf_document USING gin(search_vector);

CREATE INDEX IF NOT EXISTS idx_pdf_doc_keywords_gin
    ON pdf_document USING gin(keywords);

CREATE INDEX IF NOT EXISTS idx_rfis_search_vector
    ON rfis USING gin(search_vector);

CREATE INDEX IF NOT EXISTS idx_correspondences_search_vector
    ON correspondences USING gin(search_vector);

-- ------------------------------------------------------------
-- 4. search_project_documents RPC
--    SECURITY INVOKER: caller permissions, RLS enforced.
--    Uses GIN-indexed search_vector columns — no sequential scan.
--    Filters: general | keywords | location | subject |
--             filename | doc_type
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
                    pd.search_vector @@ websearch_to_tsquery('english', p_query)
                    AND pd.keywords IS NOT NULL
                WHEN 'location' THEN
                    immutable_tsvector_english(coalesce(pd.location, ''))
                        @@ websearch_to_tsquery('english', p_query)
                WHEN 'filename' THEN
                    immutable_tsvector_english(coalesce(pd.original_filename, ''))
                        @@ websearch_to_tsquery('english', p_query)
                WHEN 'doc_type' THEN
                    immutable_tsvector_english(coalesce(pd.doc_type, ''))
                        @@ websearch_to_tsquery('english', p_query)
                WHEN 'subject' THEN
                    COALESCE(r.search_vector, c.search_vector)
                        @@ websearch_to_tsquery('english', p_query)
                ELSE
                    pd.search_vector @@ websearch_to_tsquery('english', p_query)
                    OR COALESCE(r.search_vector, c.search_vector)
                        @@ websearch_to_tsquery('english', p_query)
            END
        )
    ORDER BY pd.doc_date DESC NULLS LAST
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION search_project_documents IS
    'Full-text document search across pdf_document, rfis, '
    'and correspondences. SECURITY INVOKER — RLS enforced. '
    'Uses GIN-indexed generated tsvector columns. '
    'English stemming via websearch_to_tsquery. '
    'Filters: general | keywords | location | subject | '
    'filename | doc_type';
