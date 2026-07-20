-- =============================================================================
-- 039_contracts.sql
-- =============================================================================
-- WHY THIS EXISTS
--   Contract & Amendments (Dinamik Sözleşme Profili) — the base contract as a
--   FIRST-CLASS RECORD and the root of the project's document hierarchy.
--   Implements ADR-014 (docs/adr/ADR-014-contract-hierarchy-root.md).
--
--   Until now the "contract" existed only as filed PDFs
--   (pdf_document.entity_type = 'contract_document', entity_id = project_id,
--   migration 007) with NO structured record: no parties, no commencement, no
--   duration, no DLP, no precedence order among its constituent documents.
--   The resolution surface (B3) therefore returned clauses + change_orders but
--   could not return the base contract as the hierarchy ROOT. This migration
--   gives the contract a table so that:
--     1. the In-Force view can show a DOCUMENT-CENTRIC hierarchy
--        (contract root -> amendments -> change orders), per Ali's ruling
--        2026-07-20 ("madde madde değil, belge belge");
--     2. the contract becomes the project-wide anchor the future RAG layer
--        will always ground on ("LLM hep buna dayanacak").
--
-- DOMAIN DECISIONS ENCODED HERE (Ali, 2026-07-20 — binding)
--   * CARDINALITY — "model for N, default to 1": contracts carries project_id
--     with NO UNIQUE(project_id), so the SCHEMA already supports several
--     contracts per project (phased/packaged works). The PILOT UX is strictly
--     1 contract : 1 project, enforced at the API layer (409 on second create).
--     Multi-contract UX is a deferred decision -> TECHNICAL_DEBT.md TB-27.
--     When that day comes: NO migration needed, only UX.
--   * PARTIES — STRUCTURED, not free text: name + role
--     (employer / contractor / engineer / other), in contract_parties.
--     Foundation for future intelligence ("who is the Employer, who must this
--     notice be served on").
--   * TERM — three fields, DLP DYNAMIC: commencement_date + duration_days +
--     dlp_days. dlp_days stores the DLP's LENGTH ONLY. Its start/end are NEVER
--     stored: they derive from ACTUAL completion (commencement + duration +
--     delays -> completion -> DLP starts). Late completion => DLP starts late.
--     Storing a fixed DLP end date would silently go wrong on every delayed
--     project — this is deliberate, do not "denormalize" it.
--   * BESPOKE PRECEDENCE — a contract is COMPOSED of documents (Agreement,
--     LOA, Particular Conditions, General Conditions, ...) with an order of
--     precedence that is bespoke per contract. contract_documents links the
--     contract to its pdf_document rows with precedence_rank (1 = highest).
--
-- CONVENTION NOTES (era-split, same as 037 header)
--   These tables FK into the 001 family (projects, profiles), so they follow
--   the 001 idiom: uuid_generate_v4() + created_by -> profiles(id).
--
-- OUT OF SCOPE (deliberately NOT here)
--   - Clause-level content of the contract (the clause engine stays
--     subject_key-based, ADR-013; drill-down/RAG comes later).
--   - Multi-contract UX (TB-27) and any programme/portfolio layer above
--     projects — the table model leaves both open, decision deferred.
--   - Derived completion/DLP-window computation (needs actual-completion
--     tracking, which does not exist yet).
--
-- APPLY SEQUENCE (per project protocol)
--   file -> database/migrations/039_contracts.sql
--   -> run in Supabase SQL Editor -> run the VERIFICATION block at the bottom
--   -> bring its output back to the architect -> Ali commits (EK-5).
--   NOTE: the backend shipped alongside this migration queries these tables;
--   apply this BEFORE exercising the In-Force tab, or GET .../contract/resolution
--   will 500 with "relation contracts does not exist".
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TABLE 1: contracts
--   The structured record of the base contract — the project's anchor
--   instrument. One row per contract; pilot keeps one per project (API guard),
--   schema allows N (see header).
-- -----------------------------------------------------------------------------
CREATE TABLE contracts (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    contract_number    TEXT,
    title              TEXT NOT NULL,
    description        TEXT,

    -- TERM (see header): DLP is a LENGTH, never a stored date.
    commencement_date  DATE,
    duration_days      INTEGER CHECK (duration_days > 0),
    dlp_days           INTEGER CHECK (dlp_days > 0),

    version            INTEGER     NOT NULL DEFAULT 1,
    is_deleted         BOOLEAN     NOT NULL DEFAULT false,   -- soft-delete, matches sibling tables

    -- the user who REGISTERED it (HITL project setup). SET NULL so the record
    -- survives a profile deletion. profiles(id) per the 001-family idiom.
    created_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()

    -- NO UNIQUE(project_id) — deliberate ("model for N, default to 1", header).
);

CREATE INDEX idx_contracts_project_id ON contracts(project_id);

-- updated_at is per-table opt-in in this schema (001:563-569 function needs an
-- explicit trigger binding, same note as 037).
CREATE TRIGGER trg_contracts_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS — reads = any active member; writes = CM ONLY, per the 038 ruling:
-- registering the base contract is a legal-effect decision (Contract Manager
-- authority), the same access model as amendments/clause_overrides after 038.
-- No DELETE policy: no table in this schema grants one (soft-delete only).
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contracts_member_read ON contracts
    FOR SELECT
    USING (is_project_member(project_id));

CREATE POLICY contracts_cm_write ON contracts
    FOR INSERT
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

CREATE POLICY contracts_cm_update ON contracts
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
-- TABLE 2: contract_parties
--   Structured parties (Ali's ruling: name + role, NOT free text). Multiple
--   'other' parties are legal, so no UNIQUE(contract_id, role).
-- -----------------------------------------------------------------------------
CREATE TABLE contract_parties (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- CASCADE: parties have no meaning without their contract.
    contract_id  UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,

    role         TEXT NOT NULL
                   CHECK (role IN ('employer', 'contractor', 'engineer', 'other')),
    name         TEXT NOT NULL,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contract_parties_contract_id ON contract_parties(contract_id);

-- RLS via the parent contract (child-table pattern, mirrors chronology_events
-- 002:316-343). Reads = member; writes/updates = CM only (same gate as parent).
ALTER TABLE contract_parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_parties_member_read ON contract_parties
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_parties.contract_id
              AND is_project_member(c.project_id)
        )
    );

CREATE POLICY contract_parties_cm_write ON contract_parties
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) = 'cm'
        )
    );

CREATE POLICY contract_parties_cm_update ON contract_parties
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) = 'cm'
        )
    );


-- -----------------------------------------------------------------------------
-- TABLE 3: contract_documents
--   The contract's constituent documents with BESPOKE PRECEDENCE. Links the
--   contract root to filed PDFs (pdf_document) — this is what makes the root
--   card clickable through to the actual contract PDF ("Sözleşmeler: 1").
-- -----------------------------------------------------------------------------
CREATE TABLE contract_documents (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- CASCADE: a link row has no meaning without its contract.
    contract_id      UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    -- CASCADE: if the PDF itself is removed, the link (not the contract) goes.
    pdf_document_id  UUID NOT NULL REFERENCES pdf_document(id) ON DELETE CASCADE,

    label            TEXT,      -- e.g. 'Contract Agreement', 'Particular Conditions'
    precedence_rank  INTEGER    CHECK (precedence_rank > 0),  -- 1 = highest precedence; NULL = unranked

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (contract_id, pdf_document_id)
);

CREATE INDEX idx_contract_documents_contract_id ON contract_documents(contract_id);
CREATE INDEX idx_contract_documents_pdf_id      ON contract_documents(pdf_document_id);

-- RLS via the parent contract, same pattern as contract_parties above.
ALTER TABLE contract_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_documents_member_read ON contract_documents
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_documents.contract_id
              AND is_project_member(c.project_id)
        )
    );

CREATE POLICY contract_documents_cm_write ON contract_documents
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) = 'cm'
        )
    );

CREATE POLICY contract_documents_cm_update ON contract_documents
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) = 'cm'
        )
    );


-- =============================================================================
-- VERIFICATION  (run AFTER the migration; bring the output back)
-- Expected: 3 tables with rls_enabled = true; 9 policies (3 per table, all
-- writes gated '= ''cm'''); 4 indexes beyond PKs/uniques; 1 trigger on contracts.
-- =============================================================================
-- SELECT c.relname AS table, c.relrowsecurity AS rls_enabled
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public'
--    AND c.relname IN ('contracts', 'contract_parties', 'contract_documents');
--
-- SELECT tablename, policyname, cmd
--   FROM pg_policies
--  WHERE tablename IN ('contracts', 'contract_parties', 'contract_documents')
--  ORDER BY tablename, cmd;
--
-- SELECT indexname FROM pg_indexes
--  WHERE tablename IN ('contracts', 'contract_parties', 'contract_documents')
--  ORDER BY tablename, indexname;
-- =============================================================================
