-- ============================================================
-- Migration 006: PDF Pipeline
-- pdf_document tablosu, RLS, audit/llm_calls enum genişletme
-- ============================================================

-- ------------------------------------------------------------
-- 1. pdf_document tablosu
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pdf_document (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entity_type         TEXT NOT NULL CHECK (entity_type IN ('correspondence', 'rfi', 'change', 'deliverable', 'chronology')),
    entity_id           UUID NOT NULL,
    original_filename   TEXT NOT NULL,
    storage_path        TEXT NOT NULL,
    file_size_bytes     INTEGER NOT NULL CHECK (file_size_bytes > 0),
    mime_type           TEXT NOT NULL DEFAULT 'application/pdf',
    parse_method        TEXT CHECK (parse_method IN ('llamaparse', 'pymupdf', 'tesseract')),
    parse_status        TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'processing', 'completed', 'failed')),
    page_count          INTEGER CHECK (page_count > 0),
    quality_score       NUMERIC(4,3) CHECK (quality_score >= 0 AND quality_score <= 1),
    extracted_text      TEXT,
    parse_error         TEXT,
    created_by          UUID NOT NULL REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2. Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pdf_document_project_id
    ON pdf_document (project_id);

CREATE INDEX IF NOT EXISTS idx_pdf_document_entity
    ON pdf_document (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_pdf_document_parse_status
    ON pdf_document (parse_status)
    WHERE parse_status IN ('pending', 'processing');

-- ------------------------------------------------------------
-- 3. RLS
-- ------------------------------------------------------------
ALTER TABLE pdf_document ENABLE ROW LEVEL SECURITY;

CREATE POLICY pdf_document_tenant_isolation ON pdf_document
    FOR ALL
    USING (
        project_id IN (
            SELECT project_id FROM project_members
            WHERE user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- 4. llm_calls.call_type — PDF pipeline yeni değerleri
-- ------------------------------------------------------------
ALTER TABLE llm_calls
    DROP CONSTRAINT IF EXISTS llm_calls_call_type_check;

ALTER TABLE llm_calls
    ADD CONSTRAINT llm_calls_call_type_check CHECK (call_type IN (
        'correspondence_draft',
        'clause_analysis',
        'what_if_scenario',
        'chronology_narrative',
        'rfi_summary',
        'notice_review',
        'entitlement_check',
        'delay_analysis',
        'change_assessment',
        'claim_narrative',
        'risk_flag',
        'schedule_impact',
        'boq_match',
        'ipc_draft',
        'site_instruction_review',
        'ncr_analysis',
        'pdf_extract_validate',
        'pdf_clause_locate',
        'pdf_party_extract'
    ));

-- ------------------------------------------------------------
-- 5. audit_log.action — PDF pipeline yeni değerleri
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
        'pdf_delete'
    ));
