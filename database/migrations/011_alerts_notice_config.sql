-- =============================================
-- ClauseIQ — Migration 011: Alerts & Notice Config
-- Applied: 2026-06-23
-- =============================================
-- internal_alerts  — iç aksiyon takibi (asla dışa açılmaz)
-- project_notice_config — proje bazlı notice period tanımları

-- =============================================
-- 1. project_notice_config
-- =============================================
CREATE TABLE project_notice_config (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_type          TEXT NOT NULL,
    -- Örnek: 'employer_instruction' | 'unforeseeable_condition'
    -- | 'extension_of_time' | 'variation' | 'custom'
    label               TEXT NOT NULL,
    -- CM'in göreceği açıklama: "Employer Instruction Notice"
    clause_reference    TEXT,
    -- Örnek: "FIDIC 20.1" | "Clause 8.4"
    notice_period_days  INTEGER NOT NULL DEFAULT 28,
    day_type            TEXT NOT NULL DEFAULT 'calendar'
                        CHECK (day_type IN ('calendar', 'business')),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, event_type)
);

CREATE TRIGGER trg_project_notice_config_updated_at
    BEFORE UPDATE ON project_notice_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- 2. internal_alerts
-- =============================================
CREATE TABLE internal_alerts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Alert tipi
    alert_type          TEXT NOT NULL
                        CHECK (alert_type IN (
                            'potential_impact',
                            'wp_message',
                            'ew_deadline'
                        )),

    -- Durum
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                            'pending',
                            'actioned',
                            'snoozed',
                            'dismissed'
                        )),
    priority            TEXT NOT NULL DEFAULT 'normal'
                        CHECK (priority IN (
                            'critical',
                            'high',
                            'normal'
                        )),

    -- Aksiyon sahibi
    action_party        TEXT NOT NULL DEFAULT 'us'
                        CHECK (action_party IN ('us', 'employer', 'shared')),
    assigned_to_role    TEXT
                        CHECK (assigned_to_role IN (
                            'cm', 'engineer', 'dcc', 'viewer', 'any'
                        )),
    assigned_to_user    UUID REFERENCES profiles(id),

    -- Kaynak — hangi entity bu alert'i tetikledi
    source_entity_type  TEXT
                        CHECK (source_entity_type IN (
                            'rfi', 'correspondence', 'change',
                            'wp_message', 'system'
                        )),
    source_entity_id    UUID,
    -- NOT: source_entity_id intentionally has no FK —
    -- farklı tablolara referans verebilir (rfi, correspondence, vs)

    -- İçerik
    flagged_by          UUID REFERENCES profiles(id),
    flagged_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    narrative           TEXT,
    -- Mühendis/mimarın açıklaması — asla dışa açılmaz

    -- Contractual deadline
    notice_config_id    UUID REFERENCES project_notice_config(id),
    notice_start_date   DATE,
    notice_deadline     DATE,
    -- Hesaplanan deadline = notice_start_date + notice_period_days

    -- CM kararı
    cm_decision         TEXT
                        CHECK (cm_decision IN (
                            'notice_written',
                            'moved_to_changes',
                            'snoozed',
                            'dismissed',
                            'no_action_required'
                        )),
    cm_decision_by      UUID REFERENCES profiles(id),
    cm_decision_at      TIMESTAMPTZ,
    cm_decision_note    TEXT,
    -- CM'in iç notu — asla dışa açılmaz

    -- Snooze
    snoozed_until       DATE,

    -- Optimistic locking
    version             INTEGER NOT NULL DEFAULT 1,

    -- Soft delete
    is_deleted          BOOLEAN NOT NULL DEFAULT false,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_internal_alerts_updated_at
    BEFORE UPDATE ON internal_alerts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- 3. Indexes
-- =============================================

-- Proje bazlı sorgular (en sık kullanım)
CREATE INDEX idx_internal_alerts_project_status
    ON internal_alerts(project_id, status)
    WHERE is_deleted = false;

-- Rol bazlı filtreleme (Alerts & Actions sorgusu)
CREATE INDEX idx_internal_alerts_role
    ON internal_alerts(project_id, assigned_to_role, status)
    WHERE is_deleted = false AND action_party = 'us';

-- Deadline takibi
CREATE INDEX idx_internal_alerts_deadline
    ON internal_alerts(notice_deadline)
    WHERE status = 'pending' AND is_deleted = false;

-- Kaynak entity sorguları
CREATE INDEX idx_internal_alerts_source
    ON internal_alerts(source_entity_type, source_entity_id)
    WHERE is_deleted = false;

CREATE INDEX idx_project_notice_config_project
    ON project_notice_config(project_id)
    WHERE is_active = true;

-- =============================================
-- 4. RLS
-- =============================================

ALTER TABLE project_notice_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notice_config_member_read" ON project_notice_config
    FOR SELECT USING (is_project_member(project_id));

CREATE POLICY "notice_config_cm_write" ON project_notice_config
    FOR ALL USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

ALTER TABLE internal_alerts ENABLE ROW LEVEL SECURITY;

-- Okuma: proje üyesi + kendi rolüne atanmış alertlar
CREATE POLICY "alerts_member_read" ON internal_alerts
    FOR SELECT USING (
        is_project_member(project_id)
        AND is_deleted = false
        AND (
            assigned_to_role = get_project_role(project_id)
            OR assigned_to_role = 'any'
            OR assigned_to_user = auth.uid()
            OR flagged_by = auth.uid()
        )
    );

-- Yazma: proje üyesi (flag koyan mühendis dahil)
CREATE POLICY "alerts_member_insert" ON internal_alerts
    FOR INSERT WITH CHECK (
        is_project_member(project_id)
    );

-- Güncelleme: CM kararı + snooze (sadece CM)
-- veya kendi oluşturduğu alert'i güncelleyebilir
CREATE POLICY "alerts_update" ON internal_alerts
    FOR UPDATE USING (
        is_project_member(project_id)
        AND (
            get_project_role(project_id) = 'cm'
            OR flagged_by = auth.uid()
        )
    );

-- =============================================
-- 5. audit_log action enum genişletme
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
        'alert_snoozed', 'alert_dismissed'
    ));
