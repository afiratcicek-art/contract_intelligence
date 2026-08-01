-- =============================================================================
-- 048_authoring_reference_bundle.sql
-- =============================================================================
-- WHY
--   Authoring drafts need (1) draft-scoped pdf_document rows for mandatory
--   manual-reference file uploads before materialize, and (2) a durable path
--   for the generated reference e-bundle PDF (covers + primary docs).
--
-- WHAT
--   * pdf_document.entity_type CHECK += 'draft'
--   * document_drafts.bundle_pdf_path TEXT (nullable)
-- =============================================================================

BEGIN;

ALTER TABLE pdf_document
    DROP CONSTRAINT IF EXISTS pdf_document_entity_type_check;

ALTER TABLE pdf_document
    ADD CONSTRAINT pdf_document_entity_type_check CHECK (
        entity_type IN (
            'correspondence',
            'rfi',
            'change',
            'deliverable',
            'chronology',
            'contract_document',
            'internal_alert',
            'draft'
        )
    );

ALTER TABLE document_drafts
    ADD COLUMN IF NOT EXISTS bundle_pdf_path TEXT;

COMMIT;
