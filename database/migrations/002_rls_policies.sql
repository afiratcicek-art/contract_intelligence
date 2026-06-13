-- =====================================================================
-- ClauseIQ — Migration 002: Row Level Security Policies
-- Supabase SQL Editor'da 001 çalıştırıldıktan sonra uygula
-- =====================================================================

-- ── RLS ETKINLEŞTIR ───────────────────────────────────────────────────────
ALTER TABLE profiles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_parties             ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_role_permissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_config              ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfis                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE changes                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_references           ENABLE ROW LEVEL SECURITY;
ALTER TABLE correspondences             ENABLE ROW LEVEL SECURITY;
ALTER TABLE correspondence_references   ENABLE ROW LEVEL SECURITY;
ALTER TABLE correspondence_drafts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE correspondence_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE correspondence_change_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE chronologies                ENABLE ROW LEVEL SECURITY;
ALTER TABLE chronology_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverables                ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverable_documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_calls                   ENABLE ROW LEVEL SECURITY;

-- ── YARDIMCI FONKSİYONLAR ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
    SELECT tenant_id FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_project_member(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM project_members
        WHERE project_id = p_project_id
          AND user_id = auth.uid()
          AND is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION get_project_role(p_project_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
    SELECT project_role FROM project_members
    WHERE project_id = p_project_id
      AND user_id = auth.uid()
      AND is_active = true
    LIMIT 1;
$$;

-- ── PROFILES ─────────────────────────────────────────────────────────────

CREATE POLICY "profiles_own_read" ON profiles
    FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles_tenant_read" ON profiles
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "profiles_own_update" ON profiles
    FOR UPDATE USING (id = auth.uid());

-- ── PROJECTS ─────────────────────────────────────────────────────────────

CREATE POLICY "projects_tenant_read" ON projects
    FOR SELECT USING (tenant_id = get_user_tenant_id() AND is_deleted = false);

CREATE POLICY "projects_tenant_create" ON projects
    FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "projects_member_update" ON projects
    FOR UPDATE USING (tenant_id = get_user_tenant_id() AND is_project_member(id));

-- Silme: soft delete — DELETE policy yok

-- ── PROJECT_MEMBERS ───────────────────────────────────────────────────────

CREATE POLICY "members_project_read" ON project_members
    FOR SELECT USING (is_project_member(project_id));

CREATE POLICY "members_cm_write" ON project_members
    FOR INSERT WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

CREATE POLICY "members_cm_update" ON project_members
    FOR UPDATE USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

-- ── PROJECT_PARTIES ───────────────────────────────────────────────────────

CREATE POLICY "parties_member_read" ON project_parties
    FOR SELECT USING (is_project_member(project_id));

CREATE POLICY "parties_cm_write" ON project_parties
    FOR INSERT WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

-- ── PROJECT_ROLE_PERMISSIONS ──────────────────────────────────────────────

CREATE POLICY "permissions_member_read" ON project_role_permissions
    FOR SELECT USING (is_project_member(project_id));

CREATE POLICY "permissions_cm_write" ON project_role_permissions
    FOR ALL USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

-- ── PROJECT_CONFIG ────────────────────────────────────────────────────────

CREATE POLICY "config_member_read" ON project_config
    FOR SELECT USING (is_project_member(project_id));

CREATE POLICY "config_cm_write" ON project_config
    FOR ALL USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

-- ── CALENDAR_CONFIG ───────────────────────────────────────────────────────

CREATE POLICY "calendar_member_read" ON calendar_config
    FOR SELECT USING (is_project_member(project_id));

CREATE POLICY "calendar_cm_write" ON calendar_config
    FOR ALL USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

-- ── RFIS ─────────────────────────────────────────────────────────────────

CREATE POLICY "rfis_member_read" ON rfis
    FOR SELECT USING (is_project_member(project_id) AND is_deleted = false);

CREATE POLICY "rfis_non_viewer_write" ON rfis
    FOR INSERT WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) IN ('cm', 'engineer', 'dcc')
    );

CREATE POLICY "rfis_non_viewer_update" ON rfis
    FOR UPDATE USING (
        is_project_member(project_id)
        AND get_project_role(project_id) IN ('cm', 'engineer', 'dcc')
    );

-- ── CHANGES ───────────────────────────────────────────────────────────────

CREATE POLICY "changes_member_read" ON changes
    FOR SELECT USING (is_project_member(project_id) AND is_deleted = false);

CREATE POLICY "changes_non_viewer_write" ON changes
    FOR INSERT WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) IN ('cm', 'engineer', 'dcc')
    );

CREATE POLICY "changes_non_viewer_update" ON changes
    FOR UPDATE USING (
        is_project_member(project_id)
        AND get_project_role(project_id) IN ('cm', 'engineer', 'dcc')
    );

-- ── CHANGE_REFERENCES ────────────────────────────────────────────────────

CREATE POLICY "change_refs_member_read" ON change_references
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM changes c
            WHERE c.id = change_references.change_id
              AND is_project_member(c.project_id)
        )
    );

CREATE POLICY "change_refs_non_viewer_write" ON change_references
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM changes c
            WHERE c.id = change_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) IN ('cm', 'engineer', 'dcc')
        )
    );

-- ── CORRESPONDENCES ───────────────────────────────────────────────────────

CREATE POLICY "corr_member_read" ON correspondences
    FOR SELECT USING (is_project_member(project_id) AND is_deleted = false);

CREATE POLICY "corr_non_viewer_write" ON correspondences
    FOR INSERT WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) IN ('cm', 'engineer', 'dcc')
    );

CREATE POLICY "corr_non_viewer_update" ON correspondences
    FOR UPDATE USING (
        is_project_member(project_id)
        AND get_project_role(project_id) IN ('cm', 'engineer', 'dcc')
    );

-- ── CORRESPONDENCE_REFERENCES ─────────────────────────────────────────────

CREATE POLICY "corr_refs_member_read" ON correspondence_references
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM correspondences c
            WHERE c.id = correspondence_references.correspondence_id
              AND is_project_member(c.project_id)
        )
    );

CREATE POLICY "corr_refs_non_viewer_write" ON correspondence_references
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM correspondences c
            WHERE c.id = correspondence_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) IN ('cm', 'engineer', 'dcc')
        )
    );

-- ── CORRESPONDENCE_DRAFTS ─────────────────────────────────────────────────

CREATE POLICY "drafts_member_read" ON correspondence_drafts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM correspondences c
            WHERE c.id = correspondence_drafts.correspondence_id
              AND is_project_member(c.project_id)
        )
    );

CREATE POLICY "drafts_non_viewer_write" ON correspondence_drafts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM correspondences c
            WHERE c.id = correspondence_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) IN ('cm', 'engineer', 'dcc')
        )
    );

-- ── CORRESPONDENCE_DOCUMENTS ──────────────────────────────────────────────

CREATE POLICY "corr_docs_member_read" ON correspondence_documents
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM correspondences c
            WHERE c.id = correspondence_documents.correspondence_id
              AND is_project_member(c.project_id)
        )
    );

CREATE POLICY "corr_docs_non_viewer_write" ON correspondence_documents
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM correspondences c
            WHERE c.id = correspondence_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) IN ('cm', 'engineer', 'dcc')
        )
    );
-- UPDATE yok — forensic arşiv

-- ── CORRESPONDENCE_CHANGE_LINKS ───────────────────────────────────────────

CREATE POLICY "links_member_read" ON correspondence_change_links
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM correspondences c
            WHERE c.id = correspondence_change_links.correspondence_id
              AND is_project_member(c.project_id)
        )
    );

CREATE POLICY "links_non_viewer_write" ON correspondence_change_links
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM correspondences c
            WHERE c.id = correspondence_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) IN ('cm', 'engineer', 'dcc')
        )
    );

-- ── CHRONOLOGIES ─────────────────────────────────────────────────────────

CREATE POLICY "chrono_member_read" ON chronologies
    FOR SELECT USING (is_project_member(project_id));

CREATE POLICY "chrono_cm_write" ON chronologies
    FOR INSERT WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

-- ── CHRONOLOGY_EVENTS ─────────────────────────────────────────────────────

CREATE POLICY "events_member_read" ON chronology_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM chronologies ch
            WHERE ch.id = chronology_events.chronology_id
              AND is_project_member(ch.project_id)
        )
    );

CREATE POLICY "events_cm_write" ON chronology_events
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM chronologies ch
            WHERE ch.id = chronology_id
              AND is_project_member(ch.project_id)
              AND get_project_role(ch.project_id) = 'cm'
        )
    );

CREATE POLICY "events_cm_update" ON chronology_events
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM chronologies ch
            WHERE ch.id = chronology_id
              AND is_project_member(ch.project_id)
              AND get_project_role(ch.project_id) = 'cm'
        )
    );
-- DELETE yok — forensic arşiv

-- ── DELIVERABLES ──────────────────────────────────────────────────────────

CREATE POLICY "deliverables_member_read" ON deliverables
    FOR SELECT USING (is_project_member(project_id) AND is_deleted = false);

CREATE POLICY "deliverables_non_viewer_write" ON deliverables
    FOR INSERT WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) IN ('cm', 'engineer', 'dcc')
    );

CREATE POLICY "deliverables_non_viewer_update" ON deliverables
    FOR UPDATE USING (
        is_project_member(project_id)
        AND get_project_role(project_id) IN ('cm', 'engineer', 'dcc')
    );

-- ── DELIVERABLE_DOCUMENTS ─────────────────────────────────────────────────

CREATE POLICY "deliv_docs_member_read" ON deliverable_documents
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM deliverables d
            WHERE d.id = deliverable_documents.deliverable_id
              AND is_project_member(d.project_id)
        )
    );

CREATE POLICY "deliv_docs_non_viewer_write" ON deliverable_documents
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM deliverables d
            WHERE d.id = deliverable_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) IN ('cm', 'engineer', 'dcc')
        )
    );
-- UPDATE yok — forensic arşiv

-- ── AUDIT_LOG ────────────────────────────────────────────────────────────

CREATE POLICY "audit_cm_read" ON audit_log
    FOR SELECT USING (
        project_id IS NULL
        OR is_project_member(project_id)
    );

-- INSERT sadece service_role (API) yapabilir — kullanıcılar yazamaz
-- Hiçbir kullanıcı RLS audit_log UPDATE/DELETE yapamaz

-- ── LLM_CALLS ────────────────────────────────────────────────────────────

CREATE POLICY "llm_calls_member_read" ON llm_calls
    FOR SELECT USING (
        project_id IS NULL
        OR is_project_member(project_id)
    );
