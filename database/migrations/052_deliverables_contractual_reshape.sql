-- 052_deliverables_contractual_reshape.sql
-- Contractual Deliverables (C&C register) — reshape legacy deliverables.
-- Ali 2026-08-05: no real user data → DROP + recreate (F1a migrate-in-place).
-- Locked model: ClauseIQ_Deliverables_Modul_Kapsam_v1.md
--   contract-scoped register, kind/cadence/direction, flat sub-items,
--   manual status + date-derived time_status (app layer / DeadlineService).

-- Drop legacy (CASCADE removes deliverable_documents + policies/indexes/triggers
-- that depend on these tables; FK fk_pm_proxy_document_deliv goes with the table).
DROP TABLE IF EXISTS deliverable_documents CASCADE;
DROP TABLE IF EXISTS deliverables CASCADE;

-- ── deliverables (künye) ──────────────────────────────────────────────────
CREATE TABLE deliverables (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    contract_id             UUID NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,

    title                   TEXT NOT NULL,
    category                TEXT NOT NULL
                            CHECK (category IN (
                                'hse', 'insurance', 'bond_security', 'statutory',
                                'report', 'certification', 'permit_approval',
                                'administrative', 'other'
                            )),
    source                  TEXT NOT NULL
                            CHECK (source IN (
                                'contract_clause', 'handover',
                                'employer_imposition', 'statutory'
                            )),
    source_ref              TEXT,

    kind                    TEXT NOT NULL
                            CHECK (kind IN ('artifact', 'compliance')),
    direction               TEXT NOT NULL
                            CHECK (direction IN ('we_owe', 'they_owe')),
    direction_override      BOOLEAN NOT NULL DEFAULT false,

    cadence                 TEXT NOT NULL DEFAULT 'one_time'
                            CHECK (cadence IN (
                                'one_time', 'recurring', 'standing_renewal'
                            )),
    cadence_rule            TEXT,

    status                  TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN (
                                'open', 'in_progress', 'completed', 'not_applicable'
                            )),

    due_date                DATE,
    expiry_date             DATE,

    responsible             TEXT,
    notes                   TEXT,
    pending_detail          BOOLEAN NOT NULL DEFAULT false,

    entry_source            TEXT NOT NULL DEFAULT 'manual'
                            CHECK (entry_source IN ('scan', 'library', 'manual')),

    version                 INTEGER NOT NULL DEFAULT 1,
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    created_by              UUID REFERENCES profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deliverables_project
    ON deliverables(project_id) WHERE is_deleted = false;
CREATE INDEX idx_deliverables_contract
    ON deliverables(contract_id) WHERE is_deleted = false;
CREATE INDEX idx_deliverables_status
    ON deliverables(project_id, status) WHERE is_deleted = false;
CREATE INDEX idx_deliverables_category
    ON deliverables(project_id, category) WHERE is_deleted = false;
CREATE INDEX idx_deliverables_due
    ON deliverables(project_id, due_date)
    WHERE is_deleted = false AND due_date IS NOT NULL;

CREATE TRIGGER trg_deliverables_updated_at
    BEFORE UPDATE ON deliverables
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE deliverables ENABLE ROW LEVEL SECURITY;

CREATE POLICY deliverables_member_read ON deliverables
    FOR SELECT USING (is_project_member(project_id) AND is_deleted = false);

CREATE POLICY deliverables_non_viewer_write ON deliverables
    FOR INSERT WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) IN ('cm', 'engineer', 'dcc')
    );

CREATE POLICY deliverables_non_viewer_update ON deliverables
    FOR UPDATE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) IN ('cm', 'engineer', 'dcc')
    )
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) IN ('cm', 'engineer', 'dcc')
    );

-- ── deliverable_documents (evidence / artifact files) ─────────────────────
-- Forensic archive: no is_deleted, no UPDATE policy.
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
);

ALTER TABLE deliverable_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY deliv_docs_member_read ON deliverable_documents
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM deliverables d
            WHERE d.id = deliverable_documents.deliverable_id
              AND is_project_member(d.project_id)
              AND d.is_deleted = false
        )
    );

CREATE POLICY deliv_docs_non_viewer_write ON deliverable_documents
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM deliverables d
            WHERE d.id = deliverable_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) IN ('cm', 'engineer', 'dcc')
        )
    );

-- ── deliverable_sub_items (flat milestones / occurrences — nesting YOK) ───
CREATE TABLE deliverable_sub_items (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deliverable_id      UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,

    name                TEXT NOT NULL,
    due_date            DATE,
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN (
                            'open', 'in_progress', 'completed', 'not_applicable'
                        )),
    fulfillment         TEXT NOT NULL DEFAULT 'pending'
                        CHECK (fulfillment IN ('pending', 'fulfilled', 'waived')),
    notes               TEXT,
    origin              TEXT NOT NULL DEFAULT 'user_added'
                        CHECK (origin IN ('user_added', 'cadence_generated')),
    sort_order          INTEGER NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deliv_sub_items_deliverable
    ON deliverable_sub_items(deliverable_id);

CREATE TRIGGER trg_deliverable_sub_items_updated_at
    BEFORE UPDATE ON deliverable_sub_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE deliverable_sub_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY deliv_sub_items_member_read ON deliverable_sub_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM deliverables d
            WHERE d.id = deliverable_sub_items.deliverable_id
              AND is_project_member(d.project_id)
              AND d.is_deleted = false
        )
    );

CREATE POLICY deliv_sub_items_non_viewer_write ON deliverable_sub_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM deliverables d
            WHERE d.id = deliverable_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) IN ('cm', 'engineer', 'dcc')
        )
    );

CREATE POLICY deliv_sub_items_non_viewer_update ON deliverable_sub_items
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM deliverables d
            WHERE d.id = deliverable_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) IN ('cm', 'engineer', 'dcc')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM deliverables d
            WHERE d.id = deliverable_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) IN ('cm', 'engineer', 'dcc')
        )
    );

CREATE POLICY deliv_sub_items_non_viewer_delete ON deliverable_sub_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM deliverables d
            WHERE d.id = deliverable_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) IN ('cm', 'engineer', 'dcc')
        )
    );
