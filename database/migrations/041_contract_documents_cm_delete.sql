-- =============================================================================
-- 041_contract_documents_cm_delete.sql
-- =============================================================================
-- WHY THIS EXISTS
--   contract_documents is a COMPOSITION-MEMBERSHIP link (contract ↔ PDF), not
--   a forensic instrument record. Wrong attachments (e.g. a leftover test.pdf
--   auto-linked at contract registration from a prior Documents upload) must
--   be removable by the CM. Every other table in this schema refuses DELETE
--   (soft-delete / forensic archive). That rule still holds for the PDF itself
--   (pdf_document) and for the contract root — this policy only lets a CM
--   DROP THE LINK ROW. The filed PDF remains in storage and in pdf_document.
--
-- APPLY SEQUENCE
--   file -> database/migrations/041_contract_documents_cm_delete.sql
--   -> run in Supabase SQL Editor -> run the VERIFICATION query at the bottom
--   -> bring output back -> Ali commits (EK-5).
-- =============================================================================

CREATE POLICY contract_documents_cm_delete ON contract_documents
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_documents.contract_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) = 'cm'
        )
    );


-- =============================================================================
-- VERIFICATION  (runnable as-is)
-- Expected 1 row: policyname = contract_documents_cm_delete, cmd = DELETE.
-- =============================================================================
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'contract_documents'
  AND policyname = 'contract_documents_cm_delete';
