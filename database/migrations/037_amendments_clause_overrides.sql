-- =============================================================================
-- 037_amendments_clause_overrides.sql
-- =============================================================================
-- WHY THIS EXISTS
--   Contract & Amendments (Dinamik Sözleşme Profili) — Stage 1 schema.
--   Implements ADR-013 §4 (docs/adr/ADR-013-contract-amendments-surface.md,
--   lines 104-199, the approved data model).
--
--   Product problem it answers: "for a given clause (e.g. Professional
--   Indemnity Insurance), which instrument is currently in force?" The
--   contract is the base instrument; employer-issued amendments override it
--   CLAUSE-BY-CLAUSE (not document-by-document); an amendment may also
--   override one of our change orders IN FULL.
--
-- WHAT IT SUPERSEDES
--   The TB-25 decorative zero: `other_amendments_count` hard-coded to 0 at
--   backend/routers/documents.py:879 ("# TB-25: no entity yet"). After this
--   migration, `amendments` is the real entity and that hard-coded 0 becomes
--   a real COUNT (backend change, separate PR — NOT in this migration).
--
-- WHAT IS NOW THE SOURCE OF TRUTH
--   - The amendment instrument  -> table `amendments` (below). It is NO LONGER
--     a `pdf_document.entity_type` value; it is a first-class table, modeled on
--     `correspondences` (an external instrument we REGISTER, not one we author).
--   - The override relationship -> table `clause_overrides` (below).
--
-- STAGING (ADR-013 §5)
--   Stage 1 (this migration + its backend/frontend, manual-only): a user
--   registers an amendment and MANUALLY marks overrides. A manual override is
--   written directly as status='confirmed', proposed_by='user' (a user action
--   IS the confirmation). The Haiku auto-proposer (proposed_by='haiku',
--   status='proposed') is Stage 2 and drops in when ANTHROPIC_API_KEY / TB-5
--   lands — with NO schema change. That is why `status`/`proposed_by` already
--   carry the full proposed|confirmed|rejected + haiku|user vocabularies here:
--   the table is Stage-2-ready on day one.
--
-- CONVENTION NOTES FOR THE NEXT ENGINEER (era-split in this codebase)
--   This schema has TWO id/created_by idioms depending on when a table was born:
--     * 001 family (projects, changes, correspondences, rfis, profiles):
--         uuid_generate_v4() + created_by -> profiles(id)
--     * 006/018 family (pdf_document, document_embeddings):
--         gen_random_uuid() + created_by -> auth.users(id)
--   These two tables sit alongside and FK into the 001 family (changes,
--   correspondences, projects, profiles), so they DELIBERATELY follow the 001
--   idiom: uuid_generate_v4() + profiles(id). This is a choice, not an accident.
--
-- OUT OF SCOPE (deliberately NOT in this migration — keeps it single-purpose)
--   - Status-vocabulary reconciliation (StatsPanel "Approved/Under Review" vs
--     DB changes.status "agreed/under_negotiation" vs Workspace's third set).
--     That is a FRONTEND display fix + an "operative = ?" decision, tracked
--     separately (ADR-013 §6). Bundling it here would break single-responsibility.
--   - The resolution query / clause search endpoints (backend, next step).
--   - A partial index on clause_overrides(project_id, subject_key)
--     WHERE status='confirmed' — deferred on purpose until the resolution
--     query shape is finalized, so we index the actual predicate, not a guess.
--   - Haiku auto-proposal code (Stage 2, behind the TB-5 key guard).
--
-- APPLY SEQUENCE (per project protocol)
--   file -> database/migrations/037_amendments_clause_overrides.sql
--   -> run in Supabase SQL Editor -> run the VERIFICATION block at the bottom
--   -> bring its output back to the architect -> Ali commits (EK-5).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TABLE 1: amendments
--   Our record of an EMPLOYER-ISSUED amending instrument (analogous to how
--   `correspondences` is our record of an external letter). We register it
--   after the fact; we do not author it.
-- -----------------------------------------------------------------------------
CREATE TABLE amendments (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    amendment_number   TEXT NOT NULL,
    title              TEXT NOT NULL,
    amendment_date     DATE,

    -- how the employer's instrument reached us (ADR-013 §4.1)
    arrival_path       TEXT NOT NULL
                         CHECK (arrival_path IN ('letter', 'change_order', 'standalone')),

    -- Provenance. ON DELETE SET NULL (not CASCADE): an amendment is a logged
    -- instrument that must survive even if its source document/change is later
    -- removed; only the provenance pointer goes null. Both are nullable, so
    -- SET NULL is legal here (contrast clause_overrides.overridden_change_id).
    source_pdf_id      UUID REFERENCES pdf_document(id) ON DELETE SET NULL,  -- the employer's filed PDF
    source_change_id   UUID REFERENCES changes(id)      ON DELETE SET NULL,  -- if it accompanied a change order

    description        TEXT,
    version            INTEGER    NOT NULL DEFAULT 1,
    is_deleted         BOOLEAN    NOT NULL DEFAULT false,   -- soft-delete, matches sibling tables

    -- the user who REGISTERED it, not an author. SET NULL so audit survives a
    -- profile deletion. profiles(id) to match the changes/correspondences family.
    created_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, amendment_number)
);

-- FK columns are NOT auto-indexed by Postgres. project_id is filtered on every
-- list; the source_* indexes support reverse lookups ("amendments for this PDF")
-- and keep the ON DELETE SET NULL scan cheap.
CREATE INDEX idx_amendments_project_id       ON amendments(project_id);
CREATE INDEX idx_amendments_source_pdf_id    ON amendments(source_pdf_id);
CREATE INDEX idx_amendments_source_change_id ON amendments(source_change_id);

-- updated_at is per-table opt-in in this schema: the shared function
-- update_updated_at() (001:563-569) does nothing without an explicit trigger
-- binding. Without this, amendments.updated_at would never advance.
CREATE TRIGGER trg_amendments_updated_at
    BEFORE UPDATE ON amendments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS — mirrors migration 036 (pdf_document) exactly, per binding decision K9
-- (write role restrictions are non-negotiable; the schema must STATE the access
-- model). Reads = any active member; writes = non-viewer roles only. No DELETE
-- policy: no table in this schema grants one (removal is soft-delete via
-- is_deleted). is_project_member()/get_project_role() are 002:38-59, both
-- STABLE and both filter user_id = auth.uid() AND is_active = true.
ALTER TABLE amendments ENABLE ROW LEVEL SECURITY;

CREATE POLICY amendments_member_read ON amendments
    FOR SELECT
    USING (is_project_member(project_id));

CREATE POLICY amendments_non_viewer_write ON amendments
    FOR INSERT
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = ANY (ARRAY['cm', 'engineer', 'dcc'])
    );

CREATE POLICY amendments_non_viewer_update ON amendments
    FOR UPDATE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = ANY (ARRAY['cm', 'engineer', 'dcc'])
    )
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = ANY (ARRAY['cm', 'engineer', 'dcc'])
    );


-- -----------------------------------------------------------------------------
-- TABLE 2: clause_overrides  (the heart)
--   One row = one assertion that an amendment overrides another instrument,
--   optionally scoped to a single clause. `status` is the HITL gate — only
--   status='confirmed' rows are ever counted by the resolution walk;
--   'proposed' rows surface as WARNINGS in the UI, never folded in.
--
--   No updated_at column BY DESIGN (ADR-013 §4.2): an override is created, then
--   moved through status; confirmed_at records that transition. Hence no
--   update_updated_at() trigger here.
-- -----------------------------------------------------------------------------
CREATE TABLE clause_overrides (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- the amendment doing the overriding. CASCADE: if the amendment is deleted,
    -- its override assertions are meaningless and go with it.
    overriding_amendment_id UUID NOT NULL REFERENCES amendments(id) ON DELETE CASCADE,

    -- Exactly ONE target is set, enforced by clause_overrides_target_scope_ck below.
    overridden_contract     BOOLEAN NOT NULL DEFAULT false,   -- true  = overrides the project contract
    -- WARNING (non-obvious, do not "fix" to SET NULL): the CHECK requires this
    -- column to be NOT NULL whenever scope='full_change_order'. ON DELETE SET
    -- NULL would therefore VIOLATE the CHECK for exactly those rows, so it MUST
    -- be CASCADE — deleting a change order deletes the override rows targeting
    -- it. The CHECK constraint dictates this choice; it is not a free decision.
    overridden_change_id    UUID REFERENCES changes(id) ON DELETE CASCADE,  -- set = overrides this change order

    scope                   TEXT NOT NULL
                              CHECK (scope IN ('clause_of_contract', 'full_change_order')),
    subject_key             TEXT,   -- the free-text clause (i); NULL for full_change_order

    -- HITL provenance, mirrors 017_document_metadata.sql. Stage 1 manual writes
    -- go in as status='confirmed', proposed_by='user'. Stage 2 Haiku writes go
    -- in as status='proposed', proposed_by='haiku'.
    status                  TEXT NOT NULL DEFAULT 'proposed'
                              CHECK (status IN ('proposed', 'confirmed', 'rejected')),
    proposed_by             TEXT NOT NULL
                              CHECK (proposed_by IN ('haiku', 'user')),
    confirmed_by            UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- audit survives profile deletion
    confirmed_at            TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Encodes the override semantics at the DB level so a malformed override is
    -- refused rather than trusted from the application (ADR-013 §4.2):
    --   * clause-of-contract: targets the contract, NAMES a clause, never a change order
    --   * full-change-order : targets one change order, NAMES no clause, never the contract
    CONSTRAINT clause_overrides_target_scope_ck CHECK (
        (overridden_contract = true  AND overridden_change_id IS NULL
                                     AND scope = 'clause_of_contract'
                                     AND subject_key IS NOT NULL)
        OR
        (overridden_contract = false AND overridden_change_id IS NOT NULL
                                     AND scope = 'full_change_order'
                                     AND subject_key IS NULL)
    )
);

-- FK/lookup indexes. project_id + overriding_amendment_id support the resolution
-- walk and the amendment->overrides join; overridden_change_id supports "is this
-- change order superseded?" and keeps the ON DELETE CASCADE scan cheap.
-- (A partial index on (project_id, subject_key) WHERE status='confirmed' is
--  deliberately deferred to the resolution-query step — see header.)
CREATE INDEX idx_clause_overrides_project_id   ON clause_overrides(project_id);
CREATE INDEX idx_clause_overrides_amendment_id ON clause_overrides(overriding_amendment_id);
CREATE INDEX idx_clause_overrides_change_id    ON clause_overrides(overridden_change_id);

-- RLS — same mirror of 036 as amendments above (K9). Reads = any active member;
-- writes/updates = non-viewer roles. Approving a Stage-2 Haiku proposal is an
-- UPDATE (proposed -> confirmed), so it is correctly gated by the update policy.
ALTER TABLE clause_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY clause_overrides_member_read ON clause_overrides
    FOR SELECT
    USING (is_project_member(project_id));

CREATE POLICY clause_overrides_non_viewer_write ON clause_overrides
    FOR INSERT
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = ANY (ARRAY['cm', 'engineer', 'dcc'])
    );

CREATE POLICY clause_overrides_non_viewer_update ON clause_overrides
    FOR UPDATE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = ANY (ARRAY['cm', 'engineer', 'dcc'])
    )
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = ANY (ARRAY['cm', 'engineer', 'dcc'])
    );


-- =============================================================================
-- VERIFICATION  (run AFTER the migration; bring the output back to the architect)
-- Not part of the migration effect — copy/run separately, or leave as a record.
-- Expected: 2 tables, 2 CHECK-carrying constraints on clause_overrides
-- (target_scope + the inline column checks), 6 policies (3 per table),
-- 6 indexes, 1 trigger on amendments.
-- =============================================================================
-- SELECT tablename, policyname, cmd
--   FROM pg_policies
--  WHERE tablename IN ('amendments', 'clause_overrides')
--  ORDER BY tablename, cmd;
--
-- SELECT c.relname AS table, c.relrowsecurity AS rls_enabled
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public' AND c.relname IN ('amendments', 'clause_overrides');
--
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid = 'clause_overrides'::regclass AND contype = 'c';
--
-- SELECT indexname FROM pg_indexes
--  WHERE tablename IN ('amendments', 'clause_overrides') ORDER BY tablename, indexname;
-- =============================================================================
