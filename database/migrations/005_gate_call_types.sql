-- 005_gate_call_types.sql
-- Two-layer LLM architecture: gate call types, lookup cache,
-- correspondence draft AI metadata columns.

-- ── llm_calls.call_type CHECK ─────────────────────────────────────────────

ALTER TABLE llm_calls
    DROP CONSTRAINT IF EXISTS llm_calls_call_type_check;

ALTER TABLE llm_calls
    ADD CONSTRAINT llm_calls_call_type_check
    CHECK (call_type IN (
        -- legacy (001_initial_schema.sql)
        'draft_correspondence',
        'rfi_response_draft',
        'clause_analysis',
        'risk_analysis',
        'change_narrative',
        'deadline_check',
        'deliverable_detection',
        'contract_scan',
        'dispute_summary',
        'contract_comparison',
        'party_extraction',
        -- gate / analysis (two-layer LLM)
        'gate_preprocess',
        'gate_blocked',
        'gate_timeout',
        'gate_simple_lookup',
        'what_if_scenario',
        'post_processor_correction'
    ));

-- ── audit_log.action CHECK ────────────────────────────────────────────────

ALTER TABLE audit_log
    DROP CONSTRAINT IF EXISTS audit_log_action_check;

ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_action_check
    CHECK (action IN (
        -- legacy (001_initial_schema.sql)
        'create',
        'update',
        'delete_flag',
        'approve',
        'publish',
        'close',
        'status_change',
        'override',
        'inactivate',
        'email_sent',
        'proxy_approval',
        'whatsapp_received',
        -- gate / post-processor
        'gate_blocked',
        'gate_timeout',
        'post_processor_correction'
    ));

-- ── correspondence_drafts AI metadata ─────────────────────────────────────

ALTER TABLE correspondence_drafts
    ADD COLUMN IF NOT EXISTS confidence_score  numeric,
    ADD COLUMN IF NOT EXISTS review_required   boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS warnings          jsonb,
    ADD COLUMN IF NOT EXISTS objectivity_flag  boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS resolved_by_gate  boolean DEFAULT false;

-- ── simple_lookup_cache ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS simple_lookup_cache (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    cache_key   text NOT NULL UNIQUE,
    project_id  uuid REFERENCES projects(id),
    answer      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS simple_lookup_cache_key_expires_idx
    ON simple_lookup_cache (cache_key, expires_at);

ALTER TABLE simple_lookup_cache
    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "simple_lookup_cache_read"
    ON simple_lookup_cache
    FOR SELECT
    USING (
        project_id IS NULL
        OR is_project_member(project_id)
    );
