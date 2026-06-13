-- =====================================================================
-- ClauseIQ — Migration 003: Indexes
-- 001 ve 002 çalıştırıldıktan sonra uygula
-- =====================================================================

-- ── PROJECTS ─────────────────────────────────────────────────────────────
CREATE INDEX idx_projects_tenant ON projects(tenant_id) WHERE is_deleted = false;
CREATE INDEX idx_projects_status ON projects(status) WHERE is_deleted = false;

-- ── PROJECT_MEMBERS ───────────────────────────────────────────────────────
CREATE INDEX idx_project_members_user ON project_members(user_id, is_active);
CREATE INDEX idx_project_members_project ON project_members(project_id, is_active);

-- ── RFIS ──────────────────────────────────────────────────────────────────
CREATE INDEX idx_rfis_project ON rfis(project_id) WHERE is_deleted = false;
CREATE INDEX idx_rfis_status ON rfis(project_id, status) WHERE is_deleted = false;
CREATE INDEX idx_rfis_deadline ON rfis(project_id, response_due_date)
    WHERE is_deleted = false AND status IN ('open', 'overdue');
CREATE INDEX idx_rfis_discipline ON rfis(project_id, discipline) WHERE is_deleted = false;

-- ── CHANGES ───────────────────────────────────────────────────────────────
CREATE INDEX idx_changes_project ON changes(project_id) WHERE is_deleted = false;
CREATE INDEX idx_changes_status ON changes(project_id, status) WHERE is_deleted = false;
CREATE INDEX idx_changes_origin ON changes(project_id, origin) WHERE is_deleted = false;
CREATE INDEX idx_changes_notice_due ON changes(project_id, notice_due_date)
    WHERE is_deleted = false AND notice_sent = false;

-- ── CORRESPONDENCES ───────────────────────────────────────────────────────
CREATE INDEX idx_corr_project ON correspondences(project_id) WHERE is_deleted = false;
CREATE INDEX idx_corr_status ON correspondences(project_id, status) WHERE is_deleted = false;
CREATE INDEX idx_corr_direction ON correspondences(project_id, direction) WHERE is_deleted = false;
CREATE INDEX idx_corr_type ON correspondences(project_id, type) WHERE is_deleted = false;
CREATE INDEX idx_corr_deadline ON correspondences(project_id, response_due_date)
    WHERE is_deleted = false AND actual_response_date IS NULL;
CREATE INDEX idx_corr_parent ON correspondences(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_corr_response ON correspondences(response_corr_id) WHERE response_corr_id IS NOT NULL;

-- ── CORRESPONDENCE_REFERENCES ─────────────────────────────────────────────
CREATE INDEX idx_corr_refs_corr ON correspondence_references(correspondence_id);
CREATE INDEX idx_corr_refs_rfi ON correspondence_references(rfi_id) WHERE rfi_id IS NOT NULL;
CREATE INDEX idx_corr_refs_change ON correspondence_references(change_id) WHERE change_id IS NOT NULL;

-- ── CORRESPONDENCE_CHANGE_LINKS ───────────────────────────────────────────
CREATE INDEX idx_links_correspondence ON correspondence_change_links(correspondence_id);
CREATE INDEX idx_links_change ON correspondence_change_links(change_id);

-- ── CHRONOLOGIES ─────────────────────────────────────────────────────────
CREATE INDEX idx_chronologies_project ON chronologies(project_id, entity_type);
CREATE INDEX idx_chronologies_entity ON chronologies(entity_type, entity_id);

-- ── CHRONOLOGY_EVENTS ─────────────────────────────────────────────────────
CREATE INDEX idx_events_chronology ON chronology_events(chronology_id, event_date)
    WHERE is_active = true;
CREATE INDEX idx_events_doc_ref ON chronology_events(document_ref_id)
    WHERE document_ref_id IS NOT NULL;

-- ── DELIVERABLES ──────────────────────────────────────────────────────────
CREATE INDEX idx_deliverables_project ON deliverables(project_id) WHERE is_deleted = false;
CREATE INDEX idx_deliverables_status ON deliverables(project_id, status) WHERE is_deleted = false;
CREATE INDEX idx_deliverables_pre_completion ON deliverables(project_id, is_pre_completion)
    WHERE is_deleted = false AND status NOT IN ('closed', 'approved');

-- ── AUDIT_LOG ────────────────────────────────────────────────────────────
CREATE INDEX idx_audit_project ON audit_log(project_id, created_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- ── LLM_CALLS ────────────────────────────────────────────────────────────
CREATE INDEX idx_llm_project ON llm_calls(project_id, created_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX idx_llm_user ON llm_calls(user_id, created_at DESC) WHERE user_id IS NOT NULL;
