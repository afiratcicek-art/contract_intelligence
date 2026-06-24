-- =============================================
-- ClauseIQ — Migration 013: Alert actions & documents
-- Applied: 2026-06-24
-- =============================================
-- Replaces internal_alerts.document_references UUID[] (012)
-- with alert_actions + alert_documents junction table.

-- =============================================
-- 1. Drop document_references from internal_alerts
-- =============================================
COMMENT ON COLUMN internal_alerts.document_references IS NULL;

ALTER TABLE internal_alerts
    DROP COLUMN IF EXISTS document_references;

-- =============================================
-- 2. alert_actions
-- =============================================
CREATE TABLE alert_actions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id            UUID NOT NULL REFERENCES internal_alerts(id) ON DELETE CASCADE,
    action_type         TEXT NOT NULL
                        CHECK (action_type IN ('note', 'assignment')),
    note                TEXT,
    assigned_to_user    UUID REFERENCES profiles(id),
    assigned_to_role    TEXT
                        CHECK (assigned_to_role IN (
                            'cm', 'engineer', 'dcc', 'viewer', 'any'
                        )),
    due_date            DATE,
    created_by          UUID NOT NULL REFERENCES profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT alert_actions_note_required CHECK (
        action_type != 'note' OR note IS NOT NULL
    ),
    CONSTRAINT alert_actions_assignment_required CHECK (
        action_type != 'assignment'
        OR assigned_to_user IS NOT NULL
        OR assigned_to_role IS NOT NULL
    )
);

CREATE INDEX idx_alert_actions_alert_id
    ON alert_actions(alert_id);

CREATE INDEX idx_alert_actions_alert_id_active
    ON alert_actions(alert_id)
    WHERE is_deleted = false;

-- =============================================
-- 3. alert_documents
-- =============================================
CREATE TABLE alert_documents (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id            UUID NOT NULL REFERENCES internal_alerts(id) ON DELETE CASCADE,
    document_id         UUID NOT NULL REFERENCES pdf_document(id) ON DELETE CASCADE,
    uploaded_by         UUID REFERENCES profiles(id),
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX idx_alert_documents_alert_document_unique
    ON alert_documents(alert_id, document_id)
    WHERE is_deleted = false;

CREATE INDEX idx_alert_documents_alert_id
    ON alert_documents(alert_id);

-- =============================================
-- 4. pdf_document.entity_type — add internal_alert
-- =============================================
ALTER TABLE pdf_document
    DROP CONSTRAINT IF EXISTS pdf_document_entity_type_check;

ALTER TABLE pdf_document
    ADD CONSTRAINT pdf_document_entity_type_check CHECK (
        entity_type IN (
            'correspondence',
            'rfi',
            'change',
            'deliverable',
            'chronology',
            'contract_document',
            'internal_alert'
        )
    );

-- =============================================
-- 5. RLS — alert_actions
-- =============================================
ALTER TABLE alert_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alert_actions_member_read" ON alert_actions
    FOR SELECT USING (
        is_deleted = false
        AND EXISTS (
            SELECT 1 FROM internal_alerts ia
            WHERE ia.id = alert_actions.alert_id
              AND is_project_member(ia.project_id)
              AND ia.is_deleted = false
              AND (
                  ia.assigned_to_role = get_project_role(ia.project_id)
                  OR ia.assigned_to_role = 'any'
                  OR ia.assigned_to_user = auth.uid()
                  OR ia.flagged_by = auth.uid()
              )
        )
    );

CREATE POLICY "alert_actions_member_insert" ON alert_actions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM internal_alerts ia
            WHERE ia.id = alert_actions.alert_id
              AND is_project_member(ia.project_id)
        )
    );

CREATE POLICY "alert_actions_creator_update" ON alert_actions
    FOR UPDATE USING (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM internal_alerts ia
            WHERE ia.id = alert_actions.alert_id
              AND is_project_member(ia.project_id)
        )
    );

-- =============================================
-- 6. RLS — alert_documents
-- =============================================
ALTER TABLE alert_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alert_documents_member_read" ON alert_documents
    FOR SELECT USING (
        is_deleted = false
        AND EXISTS (
            SELECT 1 FROM internal_alerts ia
            WHERE ia.id = alert_documents.alert_id
              AND is_project_member(ia.project_id)
              AND ia.is_deleted = false
              AND (
                  ia.assigned_to_role = get_project_role(ia.project_id)
                  OR ia.assigned_to_role = 'any'
                  OR ia.assigned_to_user = auth.uid()
                  OR ia.flagged_by = auth.uid()
              )
        )
    );

CREATE POLICY "alert_documents_member_insert" ON alert_documents
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM internal_alerts ia
            WHERE ia.id = alert_documents.alert_id
              AND is_project_member(ia.project_id)
        )
    );

-- =============================================
-- 7. audit_log action enum genişletme
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
        'alert_action_created', 'alert_document_linked'
    ));
