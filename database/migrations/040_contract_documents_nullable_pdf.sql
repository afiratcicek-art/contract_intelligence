-- =============================================================================
-- 040_contract_documents_nullable_pdf.sql
-- =============================================================================
-- WHY THIS EXISTS  (a CORRECTION of migration 039, same spirit as 038→037)
--   039 made contract_documents.pdf_document_id NOT NULL + ON DELETE CASCADE.
--   That models "a constituent document IS its file". Wrong for annexes (ekler):
--   the contract LISTS its annexes (EK-1 Özel Şartname, EK-2 BOQ, ...) as
--   registration-time FACTS — the row (label, future precedence_rank) exists
--   whether or not its PDF has been uploaded yet, and must SURVIVE if the file
--   is later removed. This is exactly the amendments.source_pdf_id model
--   (037: "a logged instrument must survive its source document; only the
--   provenance pointer goes null").
--
-- WHAT CHANGES
--   1. pdf_document_id: NOT NULL -> nullable ("registered, file pending").
--   2. FK action: ON DELETE CASCADE -> ON DELETE SET NULL (row survives,
--      pointer nulls) — legal now that the column is nullable (contrast the
--      clause_overrides.overridden_change_id warning in 037, where a CHECK
--      forced CASCADE; no such CHECK exists here).
--
-- NON-OBVIOUS SIDE EFFECT (intended)
--   UNIQUE(contract_id, pdf_document_id) does NOT constrain NULL rows
--   (Postgres treats NULLs as distinct), so a contract may hold MANY file-less
--   annex rows at once. That is the desired behaviour, not a loophole.
--
-- APPLY SEQUENCE (per project protocol)
--   file -> database/migrations/040_contract_documents_nullable_pdf.sql
--   -> run in Supabase SQL Editor -> run the VERIFICATION query at the bottom
--   -> bring output back to the architect -> Ali commits (EK-5).
-- =============================================================================

ALTER TABLE contract_documents
    ALTER COLUMN pdf_document_id DROP NOT NULL;

-- Default constraint name from 039's inline REFERENCES.
ALTER TABLE contract_documents
    DROP CONSTRAINT contract_documents_pdf_document_id_fkey;

ALTER TABLE contract_documents
    ADD CONSTRAINT contract_documents_pdf_document_id_fkey
    FOREIGN KEY (pdf_document_id) REFERENCES pdf_document(id) ON DELETE SET NULL;


-- =============================================================================
-- VERIFICATION  (runnable as-is — run after the migration, bring output back)
-- Expected 1 row: is_nullable = 'YES', delete_action = 'SET NULL'.
-- =============================================================================
SELECT c.is_nullable,
       CASE rc.delete_rule WHEN 'SET NULL' THEN 'SET NULL' ELSE rc.delete_rule END AS delete_action
FROM information_schema.columns c
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = 'contract_documents_pdf_document_id_fkey'
WHERE c.table_name = 'contract_documents'
  AND c.column_name = 'pdf_document_id';
