-- =============================================================================
-- 051_parse_method_unsupported.sql
-- WHY
--   pdf_worker writes parse_method='unsupported' for non-PDF files (deliberate
--   "stored only, not parsed" guard, pdf_worker.py ~82), but the 006 CHECK only
--   allows llamaparse|pymupdf|tesseract → that UPDATE fails the constraint,
--   silently breaking the non-PDF completion path. Schema must accept the value
--   the worker legitimately writes. Guard BEHAVIOR unchanged (TB-190 respected).
-- WHAT
--   * pdf_document.parse_method CHECK += 'unsupported'
-- NOTES
--   Postgres auto-names an inline column CHECK as {table}_{column}_check
--   → pdf_document_parse_method_check (same pattern as entity_type in 007/048).
-- =============================================================================
BEGIN;

ALTER TABLE pdf_document
    DROP CONSTRAINT IF EXISTS pdf_document_parse_method_check;

ALTER TABLE pdf_document
    ADD CONSTRAINT pdf_document_parse_method_check CHECK (
        parse_method IN ('llamaparse', 'pymupdf', 'tesseract', 'unsupported')
    );

COMMIT;
