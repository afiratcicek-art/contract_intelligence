-- ============================================================
-- 033_reference_document_link.sql
-- e-Bundle Layer 2: link a reference to an uploaded document.
-- ADR-eBundle-002 (AK-1 = Option A): a reference row MAY point to a
-- pdf_document via a dedicated FK. Bundle membership is ALWAYS read from
-- the reference table; pdf_document.entity_type/entity_id is NEVER scanned
-- to determine membership (it answers a different question: provenance/RLS).
-- Symmetric across rfi_references + correspondence_references (EBUNDLE-ILKE-3).
-- change_references is OUT OF SCOPE: different, non-polymorphic schema
-- (change_id/ref_type/ref_number/revision); symmetry is RFI<->Corr only.
-- Additive only. No changes to existing columns/policies/data. No backfill.
-- DURUM: NOT YET APPLIED (draft). After applying in Supabase SQL Editor,
--        append the receipt line here (see 032 for the pattern).
-- ============================================================
-- DURUM: URETIMDE UYGULANDI (Ali, Supabase SQL Editor, 2026-07-11)
--        Bu dosya bir makbuzdur. Yeniden calistirilmasi gerekmez.
-- ---------- 1) rfi_references.document_id ----------
ALTER TABLE rfi_references
    ADD COLUMN IF NOT EXISTS document_id UUID
        REFERENCES pdf_document(id) ON DELETE RESTRICT;

COMMENT ON COLUMN rfi_references.document_id IS
  'Optional link to an uploaded document (pdf_document.id) attached as part of '
  'this RFI''s e-Bundle. NULL when the reference is instead a system entity '
  '(rfi_id/ref_corr_id/change_id) or a manual document handle (external_doc_*). '
  'Bundle membership is read from THIS table only; the pdf_document.entity_type/'
  'entity_id binding answers a DIFFERENT question (who uploaded it / RLS scope) '
  'and must NOT be scanned to build a bundle (ADR-eBundle-002). ON DELETE '
  'RESTRICT: a document referenced by any bundle cannot be deleted until it is '
  'un-referenced first (arbitration-grade record integrity). NOTE: until TB-115 '
  'is fixed, a RESTRICT violation reaches the client as HTTP 500 (SQLSTATE 23503 '
  'not yet mapped to 409/422).';

-- Prevent attaching the same document to the same RFI twice (no duplicate entry
-- in the combined PDF). Partial: enforced only when document_id IS NOT NULL, so
-- system/manual references (document_id NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rfi_refs_owner_document
    ON rfi_references(owner_rfi_id, document_id)
    WHERE document_id IS NOT NULL;

-- ---------- 2) correspondence_references.document_id (SYMMETRIC) ----------
ALTER TABLE correspondence_references
    ADD COLUMN IF NOT EXISTS document_id UUID
        REFERENCES pdf_document(id) ON DELETE RESTRICT;

COMMENT ON COLUMN correspondence_references.document_id IS
  'Symmetric to rfi_references.document_id (ADR-eBundle-002). Same semantics: '
  'optional e-Bundle document link; membership read from this table only; '
  'ON DELETE RESTRICT; TB-115 note applies.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_corr_refs_owner_document
    ON correspondence_references(correspondence_id, document_id)
    WHERE document_id IS NOT NULL;

COMMIT;

-- ============================================================
-- VERIFICATION (run separately after COMMIT)
-- Expected: query 1 -> 2 rows, query 2 -> 2 rows, query 3 -> 2 rows.
-- ============================================================
-- 1) columns exist
SELECT table_name, column_name FROM information_schema.columns
WHERE column_name = 'document_id'
  AND table_name IN ('rfi_references','correspondence_references');
-- 2) FKs point to pdf_document
SELECT tc.table_name, ccu.table_name AS foreign_table
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.column_name = 'id' AND ccu.table_name = 'pdf_document'
  AND tc.table_name IN ('rfi_references','correspondence_references');
-- 3) unique indexes exist
SELECT indexname FROM pg_indexes
WHERE indexname IN ('uq_rfi_refs_owner_document','uq_corr_refs_owner_document');
