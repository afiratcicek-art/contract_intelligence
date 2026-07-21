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
--   duration, no DLP, no contract_type, no precedence among constituent
--   documents. This migration is the SINGLE authoritative definition of the
--   contract-root tables (contracts + contract_parties + contract_documents)
--   and their RLS.
--
-- SUPERSEDES / CONSOLIDATES
--   This file SUPERSEDES and consolidates the former incremental patches that
--   briefly lived as separate files and are now DELETED from the repo:
--     * former 040_contract_documents_nullable_pdf.sql
--         → pdf_document_id nullable + ON DELETE SET NULL (annex may exist
--           before its file; row survives file removal)
--     * former 041_contract_documents_cm_delete.sql
--         → contract_documents_cm_delete (CM-only DELETE of the LINK row only;
--           the filed PDF stays in pdf_document / storage)
--     * former 042_contracts_contract_type.sql
--         → contracts.contract_type TEXT CHECK(...) matching ContractType
--           (backend/models/common.py); projects.contract_type remains (TB-28)
--   Fresh environments apply ONLY this 039. Environments that already ran the
--   old 039+040+041+042 must DROP the three tables and re-apply this file
--   (see the reset steps in the PR / architect handover — not in this SQL).
--
-- DOMAIN DECISIONS ENCODED HERE (Ali, 2026-07-20 — binding)
--   * CARDINALITY — "model for N, default to 1": contracts carries project_id
--     with NO UNIQUE(project_id). Pilot UX is 1:1, enforced at the API (409).
--     Multi-contract UX deferred → TECHNICAL_DEBT.md TB-27.
--   * PARTIES — STRUCTURED (name + role), in contract_parties.
--   * TERM — commencement_date + duration_days + dlp_days. dlp_days is the
--     DLP's LENGTH ONLY; its window derives from ACTUAL completion (never
--     stored as dates).
--   * CONTRACT TYPE — same vocabulary as projects.contract_type / ContractType
--     enum (lump_sum | remeasure | cost_plus | target_cost | epc | epcm |
--     framework | other). Dual-source with projects → TB-28.
--   * BESPOKE PRECEDENCE — contract_documents.precedence_rank (1 = highest;
--     NULL = unranked).
--   * ACCESS — reads = any active member; writes = CM ONLY (legal-effect
--     decision, same ruling as migration 038 for amendments). Composition
--     links (contract_documents) additionally allow CM DELETE of the link
--     only. contracts / contract_parties: no DELETE policy (soft-delete /
--     forensic archive on the aggregate root).
--
-- CONVENTION NOTES (era-split, same as 037 header)
--   001-family idiom: uuid_generate_v4() + created_by -> profiles(id).
--
-- APPLY SEQUENCE (EK-15)
--   file -> database/migrations/039_contracts.sql
--   -> run in Supabase SQL Editor -> run the VERIFICATION block at the bottom
--   -> bring its output back to the architect -> Ali commits (EK-5).
--   Update docs/migrations/INDEX.md when this file changes.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TABLE 1: contracts — structured base-contract record (hierarchy root)
-- -----------------------------------------------------------------------------
CREATE TABLE contracts (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    contract_number    TEXT,
    title              TEXT NOT NULL,
    description        TEXT,

    -- Same vocabulary as projects.contract_type / ContractType (TB-28).
    contract_type      TEXT
                         CHECK (
                             contract_type IS NULL
                             OR contract_type IN (
                                 'lump_sum',
                                 'remeasure',
                                 'cost_plus',
                                 'target_cost',
                                 'epc',
                                 'epcm',
                                 'framework',
                                 'other'
                             )
                         ),

    -- TERM: DLP is a LENGTH, never a stored date.
    commencement_date  DATE,
    duration_days      INTEGER CHECK (duration_days > 0),
    dlp_days           INTEGER CHECK (dlp_days > 0),

    version            INTEGER     NOT NULL DEFAULT 1,
    is_deleted         BOOLEAN     NOT NULL DEFAULT false,

    created_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()

    -- NO UNIQUE(project_id) — deliberate ("model for N, default to 1").
);

CREATE INDEX idx_contracts_project_id ON contracts(project_id);

CREATE TRIGGER trg_contracts_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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
-- No DELETE policy: soft-delete via is_deleted (forensic archive).


-- -----------------------------------------------------------------------------
-- TABLE 2: contract_parties — structured parties (name + role)
-- -----------------------------------------------------------------------------
CREATE TABLE contract_parties (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id  UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,

    role         TEXT NOT NULL
                   CHECK (role IN ('employer', 'contractor', 'engineer', 'other')),
    name         TEXT NOT NULL,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contract_parties_contract_id ON contract_parties(contract_id);

-- RLS via parent contract (child-table pattern, mirrors chronology_events).
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
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) = 'cm'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) = 'cm'
        )
    );
-- No DELETE policy (forensic; parties are registration-time facts).


-- -----------------------------------------------------------------------------
-- TABLE 3: contract_documents — constituent docs / annexes + bespoke precedence
--   pdf_document_id nullable: annex row may exist before its file arrives;
--   ON DELETE SET NULL so the row survives if the PDF is later removed.
--   UNIQUE(contract_id, pdf_document_id) does not constrain NULL rows
--   (Postgres treats NULLs as distinct) — many file-less annexes are legal.
-- -----------------------------------------------------------------------------
CREATE TABLE contract_documents (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_id      UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    pdf_document_id  UUID REFERENCES pdf_document(id) ON DELETE SET NULL,

    label            TEXT,      -- e.g. 'Contract Agreement', 'EK-1 Özel Şartname'
    precedence_rank  INTEGER    CHECK (precedence_rank > 0),  -- 1 = highest; NULL = unranked

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (contract_id, pdf_document_id)
);

CREATE INDEX idx_contract_documents_contract_id ON contract_documents(contract_id);
CREATE INDEX idx_contract_documents_pdf_id      ON contract_documents(pdf_document_id);

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
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) = 'cm'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) = 'cm'
        )
    );

-- CM-only DELETE of the LINK row (composition membership). The filed PDF
-- remains in pdf_document / storage — forensic archive of the file itself.
CREATE POLICY contract_documents_cm_delete ON contract_documents
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_documents.contract_id
              AND is_project_member(c.project_id)
              AND get_project_role(c.project_id) = 'cm'
        )
    );


-- =============================================================================
-- VERIFICATION  (run AFTER the migration; bring the output back)
-- Expected:
--   * 3 tables, rls_enabled = true
--   * contracts.contract_type present, nullable text
--   * contract_documents.pdf_document_id is_nullable = YES
--   * 10 policies: 3 on contracts, 3 on parties, 4 on documents (incl. DELETE)
-- =============================================================================
-- SELECT c.relname AS table, c.relrowsecurity AS rls_enabled
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public'
--    AND c.relname IN ('contracts', 'contract_parties', 'contract_documents');
--
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'contracts' AND column_name = 'contract_type';
--
-- SELECT c.is_nullable,
--        CASE rc.delete_rule WHEN 'SET NULL' THEN 'SET NULL' ELSE rc.delete_rule END AS delete_action
--   FROM information_schema.columns c
--   JOIN information_schema.referential_constraints rc
--     ON rc.constraint_name = 'contract_documents_pdf_document_id_fkey'
--  WHERE c.table_name = 'contract_documents' AND c.column_name = 'pdf_document_id';
--
-- SELECT tablename, policyname, cmd
--   FROM pg_policies
--  WHERE tablename IN ('contracts', 'contract_parties', 'contract_documents')
--  ORDER BY tablename, cmd, policyname;
-- =============================================================================
