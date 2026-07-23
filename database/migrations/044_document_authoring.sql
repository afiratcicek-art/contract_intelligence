-- =============================================================================
-- Migration 044: Document authoring (templates, drafts, versions, provenance)
-- Author: ClauseIQ
-- Applied: (pending — Ali applies in Supabase SQL Editor)
--
-- WHAT
--   Four new tables for the writing module (Faz A/B):
--     document_templates       — project-scoped letterhead/field config (A3)
--     document_drafts          — in-progress authored docs + optimistic version
--     document_draft_versions  — meaningful-moment snapshots (not keystroke log)
--     document_provenance      — EVENT + ATTRIBUTION only (never content)
--   Plus correspondences.entry_mode (NULL-tolerant mirror of RFI migration 029)
--   so letter materialization can mark platform-authored records.
--
-- WHY
--   Authoring surface needs its own draft/template aggregate; correspondence_drafts
--   is AI-draft storage and must not be overloaded. Provenance is ClauseIQ's
--   defensive record of WHO/WHAT authored each part — server-written only.
--
-- BINDING DECISIONS (Ali / architect, 2026-07)
--   * Project-scoped templates (one active per project+doc_type via partial UNIQUE).
--   * Clean-slate docx build (no ingest of user .docx) — builder is separate.
--   * Provenance = events/attribution, NEVER content (see table comment below).
--   * Correspondence entry_mode nullable for back-compat (existing flows unchanged);
--     RFI entry_mode (029) stays NOT NULL DEFAULT 'recorded'.
--   * RLS mirrors 038: member_read + cm_write + cm_update; NO DELETE; NO cmd=ALL.
--   * Child tables scope via parent document_drafts (no project_id column).
--
-- CONVENTION
--   001-family idiom: uuid_generate_v4() + created_by -> profiles(id) ON DELETE SET NULL.
--   updated_at requires explicit trigger binding to update_updated_at() (001).
--
-- OUT OF SCOPE
--   LLM roles (llm_role column reserved, unused in Faz A/B), Gotenberg, masking.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- TABLE 1: document_templates
-- -----------------------------------------------------------------------------
CREATE TABLE document_templates (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    doc_type             TEXT NOT NULL
                           CHECK (doc_type IN ('letter', 'rfi')),
    name                 TEXT NOT NULL,

    header_text          TEXT,
    footer_text          TEXT,
    header_image_path    TEXT,
    footer_image_path    TEXT,
    watermark_image_path TEXT,

    field_config         JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active            BOOLEAN NOT NULL DEFAULT true,

    created_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active template per project + doc_type
CREATE UNIQUE INDEX document_templates_one_active_per_type
    ON document_templates (project_id, doc_type)
    WHERE is_active;

CREATE INDEX idx_document_templates_project_id
    ON document_templates (project_id);

CREATE TRIGGER trg_document_templates_updated_at
    BEFORE UPDATE ON document_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_templates_member_read ON document_templates
    FOR SELECT
    USING (is_project_member(project_id));

CREATE POLICY document_templates_cm_write ON document_templates
    FOR INSERT
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

CREATE POLICY document_templates_cm_update ON document_templates
    FOR UPDATE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    )
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );
-- No DELETE policy.


-- -----------------------------------------------------------------------------
-- TABLE 2: document_drafts
-- -----------------------------------------------------------------------------
CREATE TABLE document_drafts (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id               UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    doc_type                 TEXT NOT NULL
                               CHECK (doc_type IN ('letter', 'rfi')),
    template_id              UUID REFERENCES document_templates(id) ON DELETE SET NULL,

    subject                  TEXT,
    body_html                TEXT NOT NULL DEFAULT '',
    field_values             JSONB NOT NULL DEFAULT '{}'::jsonb,

    status                   TEXT NOT NULL DEFAULT 'drafting'
                               CHECK (status IN ('drafting', 'approved', 'discarded')),

    materialized_entity_type TEXT
                               CHECK (materialized_entity_type IN ('rfi', 'correspondence')),
    materialized_entity_id   UUID,

    docx_path                TEXT,
    version                  INTEGER NOT NULL DEFAULT 1,

    created_by               UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by              UUID REFERENCES profiles(id) ON DELETE SET NULL,
    approved_at              TIMESTAMPTZ
);

CREATE INDEX idx_document_drafts_project_status
    ON document_drafts (project_id, status);

CREATE TRIGGER trg_document_drafts_updated_at
    BEFORE UPDATE ON document_drafts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE document_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_drafts_member_read ON document_drafts
    FOR SELECT
    USING (is_project_member(project_id));

CREATE POLICY document_drafts_cm_write ON document_drafts
    FOR INSERT
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

CREATE POLICY document_drafts_cm_update ON document_drafts
    FOR UPDATE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    )
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );
-- No DELETE policy.


-- -----------------------------------------------------------------------------
-- TABLE 3: document_draft_versions  (meaningful-moment snapshots only)
-- PROJECT-SCOPE: this table has no project_id; scope is enforced through the parent
-- document_drafts row. Do NOT copy sibling tables' direct project_id predicate here.
-- -----------------------------------------------------------------------------
CREATE TABLE document_draft_versions (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    draft_id         UUID NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,

    body_html        TEXT NOT NULL,
    field_values     JSONB NOT NULL,

    snapshot_reason  TEXT NOT NULL
                       CHECK (snapshot_reason IN (
                           'manual', 'pre_generation', 'post_generation', 'approval'
                       )),

    created_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_draft_versions_draft_created
    ON document_draft_versions (draft_id, created_at DESC);

ALTER TABLE document_draft_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_draft_versions_member_read ON document_draft_versions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM document_drafts d
            WHERE d.id = document_draft_versions.draft_id
              AND is_project_member(d.project_id)
        )
    );

CREATE POLICY document_draft_versions_cm_write ON document_draft_versions
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM document_drafts d
            WHERE d.id = draft_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );

CREATE POLICY document_draft_versions_cm_update ON document_draft_versions
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM document_drafts d
            WHERE d.id = draft_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM document_drafts d
            WHERE d.id = draft_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );
-- No DELETE policy.


-- -----------------------------------------------------------------------------
-- TABLE 4: document_provenance
-- PROVENANCE INVARIANT: this table records EVENTS AND ATTRIBUTION ONLY, NEVER CONTENT.
-- No draft text, no prompt payloads, no rejected-reference text, no model output.
-- metadata may hold non-sensitive descriptors (e.g. field name, count, duration_ms).
-- Purpose: ClauseIQ's own protection — prove WHO/WHAT authored each part
-- (e.g. a body with zero llm_generation rows was written entirely by the user).
-- Provenance rows MUST be written SERVER-SIDE from the backend's own knowledge,
-- NEVER from a client-supplied claim, or the record has no defensive value.
--
-- PROJECT-SCOPE: this table has no project_id; scope is enforced through the parent
-- document_drafts row. Do NOT copy sibling tables' direct project_id predicate here.
-- -----------------------------------------------------------------------------
CREATE TABLE document_provenance (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    draft_id       UUID NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,

    event_type     TEXT NOT NULL
                     CHECK (event_type IN (
                         'field_autofilled', 'field_edited', 'body_user_edit',
                         'llm_generation', 'gate_result', 'approval'
                     )),
    llm_role       TEXT
                     CHECK (llm_role IN ('mask', 'gatekeeper', 'qualified', 'embedding')),
    target         TEXT,
    actor_user_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_provenance_draft_created
    ON document_provenance (draft_id, created_at);

ALTER TABLE document_provenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_provenance_member_read ON document_provenance
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM document_drafts d
            WHERE d.id = document_provenance.draft_id
              AND is_project_member(d.project_id)
        )
    );

CREATE POLICY document_provenance_cm_write ON document_provenance
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM document_drafts d
            WHERE d.id = draft_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );

CREATE POLICY document_provenance_cm_update ON document_provenance
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM document_drafts d
            WHERE d.id = draft_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM document_drafts d
            WHERE d.id = draft_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );
-- No DELETE policy.


-- -----------------------------------------------------------------------------
-- correspondences.entry_mode — NULL-tolerant mirror of RFI migration 029
-- authored | recorded; NULL = legacy / pre-authoring rows (existing flows OK).
-- -----------------------------------------------------------------------------
ALTER TABLE correspondences
    ADD COLUMN IF NOT EXISTS entry_mode TEXT NULL;

ALTER TABLE correspondences DROP CONSTRAINT IF EXISTS correspondences_entry_mode_check;
ALTER TABLE correspondences ADD CONSTRAINT correspondences_entry_mode_check
    CHECK (entry_mode IS NULL OR entry_mode IN ('authored', 'recorded'));

COMMIT;

-- =============================================================================
-- VERIFICATION (run AFTER apply; bring output back)
-- =============================================================================
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name IN (
--      'document_templates', 'document_drafts',
--      'document_draft_versions', 'document_provenance'
--    )
--  ORDER BY 1;
--
-- SELECT tablename, policyname, cmd
--   FROM pg_policies
--  WHERE tablename IN (
--      'document_templates', 'document_drafts',
--      'document_draft_versions', 'document_provenance'
--    )
--  ORDER BY tablename, cmd, policyname;
--
-- SELECT column_name, is_nullable, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'correspondences' AND column_name = 'entry_mode';
-- =============================================================================
