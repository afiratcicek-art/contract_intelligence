-- =====================================================================
-- ClauseIQ — Migration 001: Initial Schema
-- Supabase SQL Editor'da çalıştır
-- Tablo sırası FK bağımlılıklarına göre ayarlanmıştır
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- GRUP 1: KULLANICI VE PROJE
-- =====================================================================

CREATE TABLE profiles (
    id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name           TEXT NOT NULL,
    email               TEXT NOT NULL UNIQUE,
    system_role         TEXT NOT NULL DEFAULT 'user'
                        CHECK (system_role IN ('system_admin', 'user')),
    company             TEXT,
    tenant_id           UUID NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL,
    name                TEXT NOT NULL,
    contract_type       TEXT,
    contract_value      NUMERIC,
    currency            TEXT NOT NULL DEFAULT 'USD',
    employer_name       TEXT NOT NULL,
    contractor_name     TEXT NOT NULL,
    engineer_name       TEXT,
    start_date          DATE,
    end_date            DATE,
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'suspended')),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    created_by          UUID REFERENCES profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_members (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    project_role        TEXT NOT NULL
                        CHECK (project_role IN ('cm', 'engineer', 'dcc', 'viewer')),
    can_approve         BOOLEAN NOT NULL DEFAULT false,
    can_publish         BOOLEAN NOT NULL DEFAULT false,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    joined_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, user_id)
);

CREATE TABLE project_parties (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    party_name          TEXT NOT NULL,
    party_type          TEXT
                        CHECK (party_type IN (
                            'employer', 'contractor', 'engineer',
                            'subcontractor', 'designer', 'other'
                        )),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    added_by            UUID REFERENCES profiles(id),
    added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, party_name)
);

CREATE TABLE project_role_permissions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    project_role        TEXT NOT NULL
                        CHECK (project_role IN ('cm', 'engineer', 'dcc', 'viewer')),
    entity_type         TEXT NOT NULL
                        CHECK (entity_type IN (
                            'rfi', 'correspondence', 'change',
                            'chronology', 'deliverable'
                        )),
    permission          TEXT NOT NULL
                        CHECK (permission IN (
                            'create', 'edit', 'approve',
                            'close', 'publish', 'inactivate'
                        )),
    is_allowed          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE(project_id, project_role, entity_type, permission)
);

-- =====================================================================
-- GRUP 2: KONFİGÜRASYON
-- =====================================================================

CREATE TABLE project_config (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
    notice_day_type         TEXT NOT NULL DEFAULT 'calendar'
                            CHECK (notice_day_type IN ('calendar', 'business')),
    rfi_day_type            TEXT NOT NULL DEFAULT 'calendar'
                            CHECK (rfi_day_type IN ('calendar', 'business')),
    correspondence_day_type TEXT NOT NULL DEFAULT 'calendar'
                            CHECK (correspondence_day_type IN ('calendar', 'business')),
    notice_period_days      INTEGER NOT NULL DEFAULT 28,
    rfi_response_days       INTEGER NOT NULL DEFAULT 14,
    teamul_warning          BOOLEAN NOT NULL DEFAULT true,
    pm_approval_required    BOOLEAN NOT NULL DEFAULT true,
    pm_approval_types       TEXT[],
    cm_can_proxy_pm         BOOLEAN NOT NULL DEFAULT true,
    active_corr_types       TEXT[],
    employer_ref            TEXT NOT NULL DEFAULT 'Employer',
    engineer_ref            TEXT NOT NULL DEFAULT 'Engineer',
    contractor_ref          TEXT NOT NULL DEFAULT 'Contractor',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE calendar_config (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    country_code        TEXT NOT NULL,
    year                INTEGER NOT NULL,
    weekend_days        INTEGER[],
    public_holidays     DATE[],
    working_day_def     TEXT NOT NULL DEFAULT 'business'
                        CHECK (working_day_def IN ('business', 'calendar')),
    is_default          BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, country_code, year)
);

-- =====================================================================
-- GRUP 3: RFI
-- =====================================================================

CREATE TABLE rfis (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    rfi_number              TEXT NOT NULL,
    subject                 TEXT NOT NULL,
    description             TEXT,
    discipline              TEXT
                            CHECK (discipline IN (
                                'Structural', 'MEP', 'Architectural', 'Civil', 'Other'
                            )),
    submitted_by            TEXT,
    submitted_date          DATE NOT NULL,
    response_due_date       DATE,
    response_due_source     TEXT
                            CHECK (response_due_source IN (
                                'contract_clause', 'teamul_7', 'teamul_14',
                                'teamul_21', 'employer_set', 'manual'
                            )),
    response_due_day_type   TEXT CHECK (response_due_day_type IN ('calendar', 'business')),
    actual_response_date    DATE,
    status                  TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'responded', 'closed', 'overdue')),
    closed_by               UUID REFERENCES profiles(id),
    closed_at               TIMESTAMPTZ,
    close_note              TEXT,
    assigned_to             UUID REFERENCES profiles(id),
    external_ref            TEXT,
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    created_by              UUID REFERENCES profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, rfi_number)
);

-- =====================================================================
-- GRUP 4: CHANGE (Correspondence'dan önce — FK bağımlılığı)
-- =====================================================================

CREATE TABLE changes (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id                  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    change_number               TEXT NOT NULL,
    title                       TEXT NOT NULL,
    description                 TEXT,
    origin                      TEXT NOT NULL
                                CHECK (origin IN (
                                    'employer_instruction', 'contractor_discovery',
                                    'site_condition', 'regulatory', 'other'
                                )),
    status                      TEXT NOT NULL DEFAULT 'identified'
                                CHECK (status IN (
                                    'identified', 'notified', 'impact_submitted',
                                    'under_negotiation', 'agreed', 'disputed', 'closed'
                                )),
    cost_claimed_amount         NUMERIC,
    cost_claimed_date           DATE,
    cost_agreed_amount          NUMERIC,
    cost_agreed_date            DATE,
    cost_currency               TEXT NOT NULL DEFAULT 'USD',
    cost_impact_status          TEXT NOT NULL DEFAULT 'not_claimed'
                                CHECK (cost_impact_status IN (
                                    'not_claimed', 'submitted', 'agreed', 'disputed'
                                )),
    time_impact_days_claimed    INTEGER,
    time_impact_days_agreed     INTEGER,
    time_impact_claimed_date    DATE,
    time_impact_agreed_date     DATE,
    time_impact_status          TEXT NOT NULL DEFAULT 'not_claimed'
                                CHECK (time_impact_status IN (
                                    'not_claimed', 'reserved', 'submitted', 'agreed', 'disputed'
                                )),
    time_impact_note            TEXT,
    notice_sent                 BOOLEAN NOT NULL DEFAULT false,
    notice_sent_date            DATE,
    notice_due_date             DATE,
    notice_due_source           TEXT,
    notice_due_day_type         TEXT CHECK (notice_due_day_type IN ('calendar', 'business')),
    impact_due_date             DATE,
    impact_due_source           TEXT,
    impact_submitted_date       DATE,
    trigger_source              TEXT NOT NULL DEFAULT 'manual'
                                CHECK (trigger_source IN (
                                    'manual', 'm2_wir', 'm2_delay', 'm2_stop_work'
                                )),
    version                     INTEGER NOT NULL DEFAULT 1,
    is_deleted                  BOOLEAN NOT NULL DEFAULT false,
    created_by                  UUID REFERENCES profiles(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, change_number)
);

CREATE TABLE change_references (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    change_id           UUID NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
    ref_type            TEXT NOT NULL
                        CHECK (ref_type IN ('ifc', 'drawing', 'spec', 'other')),
    ref_number          TEXT NOT NULL,
    ref_date            DATE,
    revision            TEXT,
    description         TEXT,
    added_by            UUID REFERENCES profiles(id),
    added_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- GRUP 5: CORRESPONDENCE
-- =====================================================================

CREATE TABLE correspondences (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id                  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id                   UUID REFERENCES correspondences(id),
    corr_number                 TEXT NOT NULL,
    direction                   TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    type                        TEXT NOT NULL
                                CHECK (type IN (
                                    'notice', 'instruction', 'letter',
                                    'claim', 'vo', 'email_instruction',
                                    'response', 'other'
                                )),
    subject                     TEXT NOT NULL,
    from_party_id               UUID REFERENCES project_parties(id),
    to_party_id                 UUID REFERENCES project_parties(id),
    from_external               BOOLEAN NOT NULL DEFAULT false,
    external_actor_name         TEXT,
    correspondence_date         DATE NOT NULL,
    response_due_date           DATE,
    response_due_source         TEXT
                                CHECK (response_due_source IN (
                                    'contract_clause', 'teamul_7', 'teamul_14',
                                    'teamul_21', 'employer_set', 'manual'
                                )),
    response_due_clause         TEXT,
    response_due_day_type       TEXT CHECK (response_due_day_type IN ('calendar', 'business')),
    actual_response_date        DATE,
    has_response                BOOLEAN NOT NULL DEFAULT false,
    response_corr_id            UUID REFERENCES correspondences(id),
    contractual_status          TEXT NOT NULL DEFAULT 'active'
                                CHECK (contractual_status IN ('active', 'archived_only')),
    contractual_status_note     TEXT,
    contractual_status_set_by   UUID REFERENCES profiles(id),
    contractual_status_set_at   TIMESTAMPTZ,
    status                      TEXT NOT NULL DEFAULT 'draft'
                                CHECK (status IN (
                                    'draft', 'under_review', 'approved',
                                    'published', 'responded', 'closed', 'disputed'
                                )),
    assigned_to                 UUID REFERENCES profiles(id),
    pm_approval_status          TEXT NOT NULL DEFAULT 'not_required'
                                CHECK (pm_approval_status IN (
                                    'pending', 'approved', 'proxied', 'not_required'
                                )),
    pm_approved_by              UUID REFERENCES profiles(id),
    pm_approved_at              TIMESTAMPTZ,
    pm_proxy_by                 UUID REFERENCES profiles(id),
    pm_proxy_note               TEXT,
    pm_proxy_document_id        UUID,           -- FK sonradan eklenecek (circular)
    pm_notified_at              TIMESTAMPTZ,
    approved_by                 UUID REFERENCES profiles(id),
    approved_at                 TIMESTAMPTZ,
    published_at                TIMESTAMPTZ,
    published_by                UUID REFERENCES profiles(id),
    publication_channel         TEXT,
    publication_ref             TEXT,
    closed_by                   UUID REFERENCES profiles(id),
    closed_at                   TIMESTAMPTZ,
    close_note                  TEXT,
    final_content               TEXT,
    external_ref                TEXT,
    version                     INTEGER NOT NULL DEFAULT 1,
    is_deleted                  BOOLEAN NOT NULL DEFAULT false,
    created_by                  UUID REFERENCES profiles(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, corr_number)
);

CREATE TABLE correspondence_references (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    correspondence_id   UUID NOT NULL REFERENCES correspondences(id) ON DELETE CASCADE,
    ref_type            TEXT NOT NULL
                        CHECK (ref_type IN (
                            'rfi', 'correspondence', 'change',
                            'external_doc', 'drawing', 'spec', 'other'
                        )),
    rfi_id              UUID REFERENCES rfis(id),
    ref_corr_id         UUID REFERENCES correspondences(id),
    change_id           UUID REFERENCES changes(id),
    external_doc_number TEXT,
    external_doc_title  TEXT,
    external_doc_date   DATE,
    note                TEXT,
    added_by            UUID REFERENCES profiles(id),
    added_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE correspondence_drafts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    correspondence_id   UUID NOT NULL REFERENCES correspondences(id) ON DELETE CASCADE,
    content             TEXT NOT NULL,
    draft_type          TEXT NOT NULL DEFAULT 'manual'
                        CHECK (draft_type IN ('manual', 'ai_generated')),
    saved_by            UUID REFERENCES profiles(id),
    saved_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    note                TEXT
);

CREATE TABLE correspondence_documents (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    correspondence_id   UUID NOT NULL REFERENCES correspondences(id) ON DELETE CASCADE,
    version             INTEGER NOT NULL DEFAULT 1,
    file_name           TEXT NOT NULL,
    file_path           TEXT NOT NULL,
    file_type           TEXT CHECK (file_type IN ('pdf', 'docx', 'xlsx', 'other')),
    file_size           INTEGER,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    uploaded_by         UUID REFERENCES profiles(id),
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    note                TEXT
    -- is_deleted YOK — forensic arşiv
);

CREATE TABLE correspondence_change_links (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    correspondence_id   UUID NOT NULL REFERENCES correspondences(id) ON DELETE CASCADE,
    change_id           UUID NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
    linked_by           UUID REFERENCES profiles(id),
    linked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    note                TEXT,
    UNIQUE(correspondence_id, change_id)
);

-- =====================================================================
-- GRUP 6: CHRONOLOGY OF EVENTS (Forensic — silinmez)
-- =====================================================================

CREATE TABLE chronologies (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    entity_type         TEXT NOT NULL
                        CHECK (entity_type IN ('change', 'rfi', 'correspondence', 'general')),
    entity_id           UUID,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    inactivated_by      UUID REFERENCES profiles(id),
    inactivated_at      TIMESTAMPTZ,
    inactivation_reason TEXT,
    created_by          UUID REFERENCES profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chronology_events (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chronology_id           UUID NOT NULL REFERENCES chronologies(id) ON DELETE CASCADE,
    event_date              DATE NOT NULL,
    event_type              TEXT NOT NULL
                            CHECK (event_type IN (
                                'rfi', 'correspondence', 'notice',
                                'submission', 'response', 'meeting',
                                'status_change', 'dispute_step', 'note'
                            )),
    document_ref_id         UUID,
    document_ref_type       TEXT CHECK (document_ref_type IN ('correspondence', 'rfi')),
    is_key_event            BOOLEAN NOT NULL DEFAULT false,
    is_active               BOOLEAN NOT NULL DEFAULT true,
    inactivated_by          UUID REFERENCES profiles(id),
    inactivated_at          TIMESTAMPTZ,
    inactivation_reason     TEXT,
    auto_narrative          TEXT,
    approved_narrative      TEXT,
    narrative_approved_by   UUID REFERENCES profiles(id),
    narrative_approved_at   TIMESTAMPTZ,
    activity_id             TEXT,
    boq_ref                 TEXT,
    -- is_deleted YOK — forensic arşiv, hiçbir zaman silinmez
    created_by              UUID REFERENCES profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- GRUP 7: DELİVERABLES
-- =====================================================================

CREATE TABLE deliverables (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title                   TEXT NOT NULL,
    description             TEXT,
    category                TEXT NOT NULL
                            CHECK (category IN (
                                'technical', 'contractual', 'milestone', 'wir_comment'
                            )),
    subcategory             TEXT,
    source                  TEXT NOT NULL
                            CHECK (source IN ('ai_detected', 'wir_comment', 'manual')),
    source_clause           TEXT,
    ai_confidence           NUMERIC(3,2),
    approved_by_cm          BOOLEAN NOT NULL DEFAULT false,
    approved_by_cm_at       TIMESTAMPTZ,
    approved_by_cm_id       UUID REFERENCES profiles(id),
    wir_comment_ref         TEXT,
    due_date                DATE,
    due_date_source         TEXT
                            CHECK (due_date_source IN ('contract', 'milestone', 'manual')),
    due_date_clause         TEXT,
    due_date_day_type       TEXT CHECK (due_date_day_type IN ('calendar', 'business')),
    is_pre_completion       BOOLEAN NOT NULL DEFAULT true,
    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN (
                                'pending', 'in_progress', 'submitted',
                                'under_review', 'approved', 'rejected',
                                'revision_required', 'closed'
                            )),
    pm_approval_required    BOOLEAN NOT NULL DEFAULT true,
    pm_approval_status      TEXT NOT NULL DEFAULT 'pending'
                            CHECK (pm_approval_status IN (
                                'pending', 'approved', 'proxied', 'not_required'
                            )),
    pm_approved_by          UUID REFERENCES profiles(id),
    pm_approved_at          TIMESTAMPTZ,
    pm_proxy_by             UUID REFERENCES profiles(id),
    pm_proxy_note           TEXT,
    pm_proxy_document_id    UUID,           -- FK sonradan eklenecek
    pm_notified_at          TIMESTAMPTZ,
    revision_number         INTEGER NOT NULL DEFAULT 0,
    rejection_reason        TEXT,
    correspondence_id       UUID REFERENCES correspondences(id),
    change_id               UUID REFERENCES changes(id),
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    created_by              UUID REFERENCES profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE deliverable_documents (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deliverable_id              UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
    version                     INTEGER NOT NULL DEFAULT 1,
    file_name                   TEXT NOT NULL,
    file_path                   TEXT NOT NULL,
    file_type                   TEXT,
    is_active                   BOOLEAN NOT NULL DEFAULT true,
    submission_date             DATE,
    submitted_by                UUID REFERENCES profiles(id),
    counterparty_response       TEXT
                                CHECK (counterparty_response IN (
                                    'approved', 'rejected', 'revision_required'
                                )),
    counterparty_response_date  DATE,
    counterparty_response_note  TEXT,
    uploaded_by                 UUID REFERENCES profiles(id),
    uploaded_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
    -- is_deleted YOK — forensic arşiv
);

-- =====================================================================
-- GRUP 8: LOG VE AUDİT
-- =====================================================================

CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID REFERENCES projects(id),
    user_id         UUID REFERENCES profiles(id),
    action          TEXT NOT NULL
                    CHECK (action IN (
                        'create', 'update', 'delete_flag', 'approve', 'publish',
                        'close', 'status_change', 'override', 'inactivate',
                        'email_sent', 'proxy_approval', 'whatsapp_received'
                    )),
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    old_value       JSONB,
    new_value       JSONB,
    note            TEXT,
    ip_address      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    -- UPDATE ve DELETE için RLS policy YOK — INSERT ONLY
);

CREATE TABLE llm_calls (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID REFERENCES projects(id),
    user_id             UUID REFERENCES profiles(id),
    call_type           TEXT NOT NULL
                        CHECK (call_type IN (
                            'draft_correspondence', 'rfi_response_draft',
                            'clause_analysis', 'risk_analysis',
                            'change_narrative', 'deadline_check',
                            'deliverable_detection', 'contract_scan',
                            'dispute_summary', 'contract_comparison',
                            'party_extraction'
                        )),
    entity_type         TEXT,
    entity_id           UUID,
    model_used          TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    tokens_input        INTEGER,
    tokens_output       INTEGER,
    cost_usd            NUMERIC(10,6),
    confidence_score    NUMERIC(3,2),
    review_required     BOOLEAN NOT NULL DEFAULT false,
    call_duration_ms    INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    -- Prompt ve response metni saklanmaz — gizlilik
);

-- =====================================================================
-- GRUP 9: CIRCULAR FK DÜZELTMELERİ
-- Tüm tablolar oluştuktan sonra ekle
-- =====================================================================

ALTER TABLE correspondences
ADD CONSTRAINT fk_pm_proxy_document_corr
FOREIGN KEY (pm_proxy_document_id)
REFERENCES correspondence_documents(id);

ALTER TABLE deliverables
ADD CONSTRAINT fk_pm_proxy_document_deliv
FOREIGN KEY (pm_proxy_document_id)
REFERENCES correspondence_documents(id);

-- =====================================================================
-- GRUP 10: updated_at TETİKLEYİCİLERİ
-- =====================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_correspondences_updated_at
    BEFORE UPDATE ON correspondences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_changes_updated_at
    BEFORE UPDATE ON changes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_deliverables_updated_at
    BEFORE UPDATE ON deliverables
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_project_config_updated_at
    BEFORE UPDATE ON project_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_rfis_updated_at
    BEFORE UPDATE ON rfis
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
