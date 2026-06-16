-- ============================================================
-- Migration 008: Audit enum genişletme + pdf_document trigger/RLS + version kolonları
-- ============================================================

-- ------------------------------------------------------------
-- 1. audit_log.action CHECK — close, delete_flag, status_change, override ekleme
-- ------------------------------------------------------------
ALTER TABLE audit_log
    DROP CONSTRAINT IF EXISTS audit_log_action_check;

ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_action_check CHECK (action IN (
        'create',
        'update',
        'delete',
        'view',
        'approve',
        'reject',
        'submit',
        'assign',
        'publish',
        'export',
        'import',
        'login',
        'logout',
        'permission_change',
        'llm_call',
        'pdf_upload',
        'pdf_parse_start',
        'pdf_parse_complete',
        'pdf_parse_failed',
        'pdf_delete',
        'close',
        'delete_flag',
        'status_change',
        'override'
    ));

-- ------------------------------------------------------------
-- 2. pdf_document updated_at trigger
-- ------------------------------------------------------------
CREATE TRIGGER trg_pdf_document_updated_at
    BEFORE UPDATE ON pdf_document
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 3. pdf_document RLS — INSERT için WITH CHECK ekleme
-- ------------------------------------------------------------
DROP POLICY IF EXISTS pdf_document_tenant_isolation ON pdf_document;

CREATE POLICY pdf_document_tenant_isolation ON pdf_document
    FOR ALL
    USING (
        project_id IN (
            SELECT project_id FROM project_members
            WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        project_id IN (
            SELECT project_id FROM project_members
            WHERE user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- 4. rfis.version kolonu — optimistic locking için
-- ------------------------------------------------------------
ALTER TABLE rfis
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- ------------------------------------------------------------
-- 5. deliverables.version kolonu — optimistic locking için
-- ------------------------------------------------------------
ALTER TABLE deliverables
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
