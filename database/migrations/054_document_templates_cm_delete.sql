-- Migration 054: document_templates — CM DELETE policy
-- Author: ClauseIQ
--
-- 044 intentionally omitted DELETE (templates were deactivate-only).
-- Config letterhead UX needs hard delete; drafts.template_id is ON DELETE SET NULL.

BEGIN;
DROP POLICY IF EXISTS document_templates_cm_delete ON document_templates;
CREATE POLICY document_templates_cm_delete ON document_templates
    FOR DELETE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

COMMIT;

-- DOGRULAMA:
-- SELECT polname FROM pg_policies
--   WHERE tablename = 'document_templates' AND cmd = 'DELETE';
-- Beklenen: document_templates_cm_delete
