-- ============================================================
-- Migration 017: Document metadata extraction fields
-- Supports keyword/location user input + Haiku extraction.
-- HITL: metadata_status tracks extraction lifecycle.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Add metadata columns to pdf_document
-- ------------------------------------------------------------
ALTER TABLE pdf_document
    ADD COLUMN IF NOT EXISTS keywords          TEXT[]      DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS location          TEXT,
    ADD COLUMN IF NOT EXISTS doc_date          DATE,
    ADD COLUMN IF NOT EXISTS metadata_status   TEXT        NOT NULL DEFAULT 'pending'
        CHECK (metadata_status IN ('pending', 'processing', 'done', 'failed')),
    ADD COLUMN IF NOT EXISTS metadata_source   TEXT
        CHECK (metadata_source IN ('user', 'haiku', 'mixed')),
    ADD COLUMN IF NOT EXISTS metadata_approved_by   UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS metadata_approved_at   TIMESTAMPTZ;

COMMENT ON COLUMN pdf_document.keywords IS
    'User-entered or Haiku-extracted keywords. '
    'User input takes precedence over Haiku extraction.';
COMMENT ON COLUMN pdf_document.location IS
    'Document location/zone reference (e.g. Grid Zone 4A). '
    'User input takes precedence.';
COMMENT ON COLUMN pdf_document.doc_date IS
    'Document date — extracted from content or user-supplied.';
COMMENT ON COLUMN pdf_document.metadata_status IS
    'Extraction lifecycle: pending → processing → done | failed.';
COMMENT ON COLUMN pdf_document.metadata_source IS
    'Who provided the metadata: user | haiku | mixed.';

-- ------------------------------------------------------------
-- 2. Index for metadata_status filtering
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pdf_document_metadata_status
    ON pdf_document (metadata_status)
    WHERE metadata_status IN ('pending', 'processing', 'failed');

-- ------------------------------------------------------------
-- 3. Extend audit_log.action CHECK
-- ------------------------------------------------------------
ALTER TABLE audit_log
    DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_action_check CHECK (action IN (
        'create', 'update', 'delete', 'view',
        'approve', 'reject', 'submit', 'assign',
        'publish', 'export', 'import',
        'login', 'logout', 'permission_change',
        'llm_call',
        'pdf_upload', 'pdf_parse_start',
        'pdf_parse_complete', 'pdf_parse_failed', 'pdf_delete',
        'metadata_extraction_start',
        'metadata_extraction_complete',
        'metadata_extraction_failed',
        'metadata_approved',
        'modify',
        'inactivate'
    ));

-- ------------------------------------------------------------
-- 4. Extend llm_calls.call_type CHECK
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
        'pdf_party_extract',
        'haiku_metadata_extraction'
    ));
