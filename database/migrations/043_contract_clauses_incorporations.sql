-- =============================================================================
-- 043_contract_clauses_incorporations.sql
-- =============================================================================
-- WHY THIS EXISTS
--   Phase-2 canonical clause registry + incorporation edges, and the re-point
--   of clause_overrides off free-text subject_key onto that registry.
--
--   Product problem it answers next: "for the SUBJECT of source clause A,
--   preferentially read target clause B as if it were in the body" (incorporation
--   by reference — NOT supersession). Overrides remain supersession ("this
--   amendment wins for clause X"). Subject identity must therefore be a stable
--   node, not a free-text string.
--
-- WHAT IT SUPERSEDES (on clause_overrides)
--   Migration 037's free-text `subject_key TEXT` model for scope='clause_of_contract'.
--   After this migration the clause subject is `subject_clause_id UUID` →
--   contract_clauses(id). The two-branch CHECK semantics are preserved; only
--   the subject carrier changes (IS NOT NULL / IS NULL on the new FK).
--
--   PRECONDITION: clause_overrides must be EMPTY. There is no data migration
--   from free-text keys to registry nodes (HITL find-or-create will mint nodes
--   going forward). The DO block below RAISES if count(*) <> 0.
--
-- WHAT IS NOW THE SOURCE OF TRUTH
--   - Canonical clause / section nodes → table `contract_clauses` (covers ALL
--     contract_documents AND amendments via the XOR instrument CHECK).
--     Born HITL-sparse (find-or-create on (instrument, clause_ref)); a future
--     clause↔text-span link for the RAG splitter hangs HERE — no span columns
--     yet (YAGNI).
--   - Incorporation edges → table `clause_incorporations` ("for the SUBJECT of
--     the source clause, preferentially read the target clause as if it were
--     in the body"). Distinct from override/supersede. Subject is inherent in
--     the source clause node; instrument-agnostic.
--   - Override subject → clause_overrides.subject_clause_id (re-point of 037).
--
-- ACCESS (K9 — mirror 038 verbatim)
--   Reads = any active member (is_project_member). Writes/updates = CM ONLY
--   (get_project_role = 'cm'). No DELETE policy (siblings: rejected = tombstone
--   for HITL rows; registry nodes are not soft-deleted here). clause_overrides
--   policies from 038 key on project_id / role only — the column swap does NOT
--   touch them.
--
-- CONVENTION
--   001-family idiom: uuid_generate_v4() + created_by/confirmed_by → profiles(id).
--
-- APPLY SEQUENCE (EK-15)
--   1) Ali runs: SELECT count(*) FROM clause_overrides;  -- MUST be 0
--   2) file -> database/migrations/043_contract_clauses_incorporations.sql
--      in Supabase SQL Editor
--   3) run VERIFICATION block at bottom → bring output to architect
--   4) update docs/migrations/INDEX.md (done in the same change as this file)
--   5) Ali commits (EK-5)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- PRECONDITION: empty clause_overrides (no subject_key → subject_clause_id
-- data migration). Fail loud if any row exists.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    n bigint;
BEGIN
    SELECT count(*) INTO n FROM clause_overrides;
    IF n <> 0 THEN
        RAISE EXCEPTION
            '043 refused: clause_overrides has % row(s); subject_key→subject_clause_id re-point requires an empty table (no data migration)',
            n;
    END IF;
    RAISE NOTICE '043 precondition OK: clause_overrides count(*) = 0';
END $$;


-- -----------------------------------------------------------------------------
-- TABLE 1: contract_clauses
--   Canonical madde/section nodes spanning every contract_document and every
--   amendment. Exactly one instrument FK is set (clause_instrument_ck).
--   Find-or-create key = partial UNIQUE on (instrument_id, clause_ref).
--   parent_clause_id = in-document nesting only (ON DELETE SET NULL).
--   Future: clause↔text-span for RAG splitter attaches here — no columns yet.
-- -----------------------------------------------------------------------------
CREATE TABLE contract_clauses (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Exactly ONE instrument is set (document XOR amendment).
    contract_document_id UUID REFERENCES contract_documents(id) ON DELETE CASCADE,
    amendment_id         UUID REFERENCES amendments(id) ON DELETE CASCADE,

    clause_ref           TEXT NOT NULL,   -- e.g. "3.b", "App C §5"
    parent_clause_id     UUID REFERENCES contract_clauses(id) ON DELETE SET NULL,
    title                TEXT,

    created_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT clause_instrument_ck CHECK (
        (contract_document_id IS NOT NULL AND amendment_id IS NULL)
        OR
        (contract_document_id IS NULL AND amendment_id IS NOT NULL)
    )
);

-- Find-or-create uniqueness (one clause_ref per instrument).
CREATE UNIQUE INDEX uq_contract_clauses_doc_ref
    ON contract_clauses (contract_document_id, clause_ref)
    WHERE contract_document_id IS NOT NULL;

CREATE UNIQUE INDEX uq_contract_clauses_amd_ref
    ON contract_clauses (amendment_id, clause_ref)
    WHERE amendment_id IS NOT NULL;

CREATE INDEX idx_contract_clauses_project_id           ON contract_clauses(project_id);
CREATE INDEX idx_contract_clauses_contract_document_id ON contract_clauses(contract_document_id);
CREATE INDEX idx_contract_clauses_amendment_id         ON contract_clauses(amendment_id);
CREATE INDEX idx_contract_clauses_parent_clause_id     ON contract_clauses(parent_clause_id);

-- RLS — 038 mirror (K9): member read, CM write/update, no DELETE.
ALTER TABLE contract_clauses ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_clauses_member_read ON contract_clauses
    FOR SELECT
    USING (is_project_member(project_id));

CREATE POLICY contract_clauses_cm_write ON contract_clauses
    FOR INSERT
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

CREATE POLICY contract_clauses_cm_update ON contract_clauses
    FOR UPDATE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    )
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );


-- -----------------------------------------------------------------------------
-- TABLE 2: clause_incorporations
--   "For the SUBJECT of the source clause, preferentially read the target
--   clause as if it were in the body." Distinct from clause_overrides
--   (supersede). Subject is inherent in source_clause_id; instrument-agnostic.
--   HITL columns mirror 037 clause_overrides. No is_deleted — rejected = tombstone.
-- -----------------------------------------------------------------------------
CREATE TABLE clause_incorporations (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    source_clause_id UUID NOT NULL REFERENCES contract_clauses(id) ON DELETE CASCADE,
    target_clause_id UUID NOT NULL REFERENCES contract_clauses(id) ON DELETE CASCADE,

    -- HITL provenance (037 mirror). Stage 1 manual = confirmed/user;
    -- Stage 2 Haiku = proposed/haiku (no schema change later).
    status           TEXT NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed', 'confirmed', 'rejected')),
    proposed_by      TEXT NOT NULL
                       CHECK (proposed_by IN ('haiku', 'user')),
    confirmed_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
    confirmed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT clause_incorporations_no_self_ck CHECK (source_clause_id <> target_clause_id)
);

CREATE INDEX idx_clause_incorporations_project_id       ON clause_incorporations(project_id);
CREATE INDEX idx_clause_incorporations_source_clause_id ON clause_incorporations(source_clause_id);
CREATE INDEX idx_clause_incorporations_target_clause_id ON clause_incorporations(target_clause_id);

ALTER TABLE clause_incorporations ENABLE ROW LEVEL SECURITY;

CREATE POLICY clause_incorporations_member_read ON clause_incorporations
    FOR SELECT
    USING (is_project_member(project_id));

CREATE POLICY clause_incorporations_cm_write ON clause_incorporations
    FOR INSERT
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

CREATE POLICY clause_incorporations_cm_update ON clause_incorporations
    FOR UPDATE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    )
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );


-- -----------------------------------------------------------------------------
-- clause_overrides RE-POINT: subject_key TEXT → subject_clause_id UUID
--   Empty-table path only (precondition DO above). Drop the 037 CHECK, swap
--   the column, rewrite CHECK with the same two branches (subject_clause_id
--   IS NOT NULL / IS NULL). 038 CM policies are untouched (project_id/role).
-- -----------------------------------------------------------------------------
ALTER TABLE clause_overrides
    DROP CONSTRAINT clause_overrides_target_scope_ck;

ALTER TABLE clause_overrides
    ADD COLUMN subject_clause_id UUID REFERENCES contract_clauses(id) ON DELETE CASCADE;

ALTER TABLE clause_overrides
    DROP COLUMN subject_key;

ALTER TABLE clause_overrides
    ADD CONSTRAINT clause_overrides_target_scope_ck CHECK (
        (overridden_contract = true  AND overridden_change_id IS NULL
                                     AND scope = 'clause_of_contract'
                                     AND subject_clause_id IS NOT NULL)
        OR
        (overridden_contract = false AND overridden_change_id IS NOT NULL
                                     AND scope = 'full_change_order'
                                     AND subject_clause_id IS NULL)
    );

CREATE INDEX idx_clause_overrides_subject_clause
    ON clause_overrides(subject_clause_id);


-- =============================================================================
-- VERIFICATION  (run AFTER the migration; bring output back to the architect)
-- =============================================================================
-- -- (a) empty overrides still empty; new column present; subject_key gone
-- SELECT count(*) AS clause_overrides_count FROM clause_overrides;
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'clause_overrides'
--    AND column_name IN ('subject_key', 'subject_clause_id')
--  ORDER BY column_name;
--
-- -- (b) CHECK rewritten
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid = 'clause_overrides'::regclass AND contype = 'c'
--  ORDER BY conname;
--
-- -- (c) new tables + RLS enabled
-- SELECT c.relname AS table, c.relrowsecurity AS rls_enabled
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public'
--    AND c.relname IN ('contract_clauses', 'clause_incorporations', 'clause_overrides')
--  ORDER BY 1;
--
-- -- (d) policies: member_read / cm_write / cm_update; 038 overrides unchanged
-- SELECT tablename, policyname, cmd,
--        CASE
--          WHEN coalesce(qual, '') ILIKE '%engineer%'
--            OR coalesce(with_check, '') ILIKE '%engineer%'
--               THEN 'NON-VIEWER (bad!)'
--          WHEN coalesce(qual, '') ILIKE '%= ''cm''%'
--            OR coalesce(with_check, '') ILIKE '%= ''cm''%'
--               THEN 'CM-ONLY'
--          WHEN cmd = 'SELECT' THEN 'member-read'
--          ELSE 'other'
--        END AS gate
--   FROM pg_policies
--  WHERE tablename IN (
--          'contract_clauses', 'clause_incorporations', 'clause_overrides'
--        )
--  ORDER BY tablename, cmd, policyname;
--
-- -- (e) partial uniques + subject_clause index
-- SELECT indexname FROM pg_indexes
--  WHERE tablename IN ('contract_clauses', 'clause_incorporations', 'clause_overrides')
--  ORDER BY tablename, indexname;
-- =============================================================================
