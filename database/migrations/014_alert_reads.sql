-- =============================================
-- ClauseIQ — Migration 014: Alert read tracking
-- Applied: 2026-06-26
-- =============================================
-- Per-user read tracking for internal_alerts.
-- Junction table: one row per (alert, user) pair.
-- UPSERT on conflict to mark as read.
-- =============================================

-- =============================================
-- 1. alert_reads
-- =============================================
CREATE TABLE alert_reads (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id            UUID NOT NULL REFERENCES internal_alerts(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    read_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT alert_reads_unique_user UNIQUE (alert_id, user_id)
);

CREATE INDEX idx_alert_reads_alert_id
    ON alert_reads(alert_id);

CREATE INDEX idx_alert_reads_user_id
    ON alert_reads(user_id);

-- =============================================
-- 2. RLS — alert_reads
-- =============================================
ALTER TABLE alert_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alert_reads_own_read" ON alert_reads
    FOR SELECT USING (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM internal_alerts ia
            WHERE ia.id = alert_reads.alert_id
              AND is_project_member(ia.project_id)
              AND ia.is_deleted = false
        )
    );

CREATE POLICY "alert_reads_own_insert" ON alert_reads
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM internal_alerts ia
            WHERE ia.id = alert_reads.alert_id
              AND is_project_member(ia.project_id)
        )
    );

-- =============================================
-- 3. audit_log action enum genişletme
-- =============================================
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
        'close', 'delete_flag', 'status_change', 'override',
        'alert_created', 'alert_actioned',
        'alert_snoozed', 'alert_dismissed',
        'alert_action_created', 'alert_document_linked',
        'alert_read'
    ));
