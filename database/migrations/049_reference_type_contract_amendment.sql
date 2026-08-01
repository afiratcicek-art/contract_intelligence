-- =============================================================================
-- 049_reference_type_contract_amendment.sql
-- =============================================================================
-- WHY
--   Authoring references must be able to target contract documents (specs,
--   drawings, agreement — user-labelled contract_documents rows) and
--   amendments (zeyilname). Their PDFs already live in pdf_document
--   (contract_documents.pdf_document_id / amendments.source_pdf_id), so the
--   reference is stored via the existing document_id column; ref_type gains
--   two labels for display/filtering only. No new FK, no guard change.
--
-- WHAT
--   * rfi_references.ref_type CHECK += 'contract_document', 'amendment'
--   * correspondence_references.ref_type CHECK += 'contract_document', 'amendment'
--     (mirror both — symmetric with existing ref_type on both tables)
--
-- BASELINE
--   Values below preserve 034_reference_document_type.sql byte-for-byte, then
--   append the two new registered-entity labels.
-- =============================================================================

BEGIN;

-- ---------- 1) rfi_references.ref_type ----------
ALTER TABLE rfi_references
  DROP CONSTRAINT IF EXISTS rfi_references_ref_type_check;

ALTER TABLE rfi_references
  ADD CONSTRAINT rfi_references_ref_type_check
  CHECK (ref_type IN (
    -- kayitli varliklar (FK ile baglanir; ayrintiyi hedeften oku)
    'rfi', 'correspondence', 'change', 'document',
    -- manuel belge tipleri (FK yok; tip external_doc_* ile girilir)
    'drawing', 'spec', 'specialist', 'submission', 'response',
    'meeting', 'inspection', 'work_permit', 'other',
    -- registered instruments via document_id → pdf_document (049)
    'contract_document', 'amendment'
  ));

-- ---------- 2) correspondence_references.ref_type (SIMETRIK) ----------
ALTER TABLE correspondence_references
  DROP CONSTRAINT IF EXISTS correspondence_references_ref_type_check;

ALTER TABLE correspondence_references
  ADD CONSTRAINT correspondence_references_ref_type_check
  CHECK (ref_type IN (
    'rfi', 'correspondence', 'change', 'document',
    'drawing', 'spec', 'specialist', 'submission', 'response',
    'meeting', 'inspection', 'work_permit', 'other',
    'contract_document', 'amendment'
  ));

COMMIT;

-- ============================================================
-- DOGRULAMA (COMMIT sonrasi AYRI calistir)
-- Beklenen: her iki constraint 15 izinli deger; ihlal 0 satir.
-- ============================================================
--
-- SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname IN ('rfi_references_ref_type_check',
--                   'correspondence_references_ref_type_check');
--
-- SELECT 'rfi_references' tbl, ref_type FROM rfi_references
--   WHERE ref_type NOT IN (
--     'rfi','correspondence','change','document',
--     'drawing','spec','specialist','submission','response',
--     'meeting','inspection','work_permit','other',
--     'contract_document','amendment'
--   );
-- SELECT 'correspondence_references', ref_type FROM correspondence_references
--   WHERE ref_type NOT IN (
--     'rfi','correspondence','change','document',
--     'drawing','spec','specialist','submission','response',
--     'meeting','inspection','work_permit','other',
--     'contract_document','amendment'
--   );
