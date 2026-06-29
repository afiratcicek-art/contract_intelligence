-- ============================================================
-- Migration 019: Add doc_type to pdf_document
-- doc_type is populated by Haiku metadata extraction (TB-5).
-- Enables document type filtering in search.
-- ============================================================

ALTER TABLE pdf_document
    ADD COLUMN IF NOT EXISTS doc_type TEXT
        CHECK (doc_type IN (
            'correspondence', 'rfi', 'notice', 'variation',
            'instruction', 'claim', 'programme', 'minutes',
            'daily_report', 'permit', 'other'
        ));

COMMENT ON COLUMN pdf_document.doc_type IS
    'Document type — extracted by Haiku or user-supplied. '
    'Null until metadata extraction completes (TB-5).';
