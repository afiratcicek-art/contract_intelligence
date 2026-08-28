-- =============================================================================
-- 055_dispute_ready.sql
-- =============================================================================
-- WHY
--   Dispute Ready dossier — case lifecycle end-state. A change / hak talebi /
--   kesinti that falls into dispute is prepared as an EDOS-ready pack for
--   higher management / arbitration. Legal-effect write (CM-only), same class
--   as amendments (038). Reads = any active project member.
--
-- WHAT
--   * tables: disputes, dispute_impacts, dispute_issues, dispute_positions,
--     dispute_position_refs
--   * chronologies.entity_type CHECK += 'dispute'
--   * pdf_document.entity_type CHECK += 'dispute'
--   * No DELETE policy on disputes (forensic). Nested rows may be updated
--     or deleted; the dispute row itself is closed, never hard-deleted.
--
-- ACCESS
--   API: verify_project_access (read) / require_cm_role (write).
--   RLS: member SELECT; CM INSERT/UPDATE. Nested tables gate through parent.
--   No project_role_permissions seed — coarse CM gate, not a new matrix.
--
-- APPLY
--   Ali: Supabase SQL Editor. No BEGIN/COMMIT — runner owns the transaction.
--   Run the VERIFICATION query at the bottom and bring output back.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) disputes
-- -----------------------------------------------------------------------------
CREATE TABLE disputes (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id                  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dispute_number              TEXT NOT NULL,
    title                       TEXT NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'open', 'prepared', 'closed')),
    origin                      TEXT NOT NULL
                                CHECK (origin IN ('change', 'correspondence', 'mixed', 'manual')),
    source_change_id            UUID REFERENCES changes(id) ON DELETE SET NULL,
    source_correspondence_id    UUID REFERENCES correspondences(id) ON DELETE SET NULL,
    summary                     TEXT,
    venue                       TEXT,
    chronology_id               UUID REFERENCES chronologies(id) ON DELETE SET NULL,
    pack_storage_path           TEXT,
    pack_generated_at           TIMESTAMPTZ,
    created_by                  UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, dispute_number)
);

CREATE INDEX idx_disputes_project_id             ON disputes(project_id);
CREATE INDEX idx_disputes_source_change_id       ON disputes(source_change_id);
CREATE INDEX idx_disputes_source_correspondence  ON disputes(source_correspondence_id);
CREATE INDEX idx_disputes_chronology_id          ON disputes(chronology_id);

CREATE TRIGGER trg_disputes_updated_at
    BEFORE UPDATE ON disputes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY disputes_member_read ON disputes
    FOR SELECT
    USING (is_project_member(project_id));

CREATE POLICY disputes_cm_write ON disputes
    FOR INSERT
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

CREATE POLICY disputes_cm_update ON disputes
    FOR UPDATE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    )
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );
-- DELETE yok — forensic. Kapatma = status='closed'.


-- -----------------------------------------------------------------------------
-- 2) dispute_impacts
-- -----------------------------------------------------------------------------
CREATE TABLE dispute_impacts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispute_id  UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('cost', 'time', 'other')),
    label       TEXT NOT NULL,
    amount      NUMERIC,
    unit        TEXT,
    notes       TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispute_impacts_dispute_id ON dispute_impacts(dispute_id);

ALTER TABLE dispute_impacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY dispute_impacts_member_read ON dispute_impacts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.id = dispute_impacts.dispute_id
              AND is_project_member(d.project_id)
        )
    );

CREATE POLICY dispute_impacts_cm_write ON dispute_impacts
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.id = dispute_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );

CREATE POLICY dispute_impacts_cm_update ON dispute_impacts
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.id = dispute_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.id = dispute_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );

CREATE POLICY dispute_impacts_cm_delete ON dispute_impacts
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.id = dispute_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );


-- -----------------------------------------------------------------------------
-- 3) dispute_issues  (diagram centre)
-- -----------------------------------------------------------------------------
CREATE TABLE dispute_issues (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispute_id  UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispute_issues_dispute_id ON dispute_issues(dispute_id);

ALTER TABLE dispute_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY dispute_issues_member_read ON dispute_issues
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.id = dispute_issues.dispute_id
              AND is_project_member(d.project_id)
        )
    );

CREATE POLICY dispute_issues_cm_write ON dispute_issues
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.id = dispute_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );

CREATE POLICY dispute_issues_cm_update ON dispute_issues
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.id = dispute_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.id = dispute_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );

CREATE POLICY dispute_issues_cm_delete ON dispute_issues
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.id = dispute_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );


-- -----------------------------------------------------------------------------
-- 4) dispute_positions  (left = claim, right = response)
-- -----------------------------------------------------------------------------
CREATE TABLE dispute_positions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_id    UUID NOT NULL REFERENCES dispute_issues(id) ON DELETE CASCADE,
    side        TEXT NOT NULL CHECK (side IN ('claim', 'response')),
    title       TEXT NOT NULL,
    summary     TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispute_positions_issue_id ON dispute_positions(issue_id);

ALTER TABLE dispute_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY dispute_positions_member_read ON dispute_positions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM dispute_issues i
            JOIN disputes d ON d.id = i.dispute_id
            WHERE i.id = dispute_positions.issue_id
              AND is_project_member(d.project_id)
        )
    );

CREATE POLICY dispute_positions_cm_write ON dispute_positions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM dispute_issues i
            JOIN disputes d ON d.id = i.dispute_id
            WHERE i.id = issue_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );

CREATE POLICY dispute_positions_cm_update ON dispute_positions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM dispute_issues i
            JOIN disputes d ON d.id = i.dispute_id
            WHERE i.id = issue_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM dispute_issues i
            JOIN disputes d ON d.id = i.dispute_id
            WHERE i.id = issue_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );

CREATE POLICY dispute_positions_cm_delete ON dispute_positions
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM dispute_issues i
            JOIN disputes d ON d.id = i.dispute_id
            WHERE i.id = issue_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );


-- -----------------------------------------------------------------------------
-- 5) dispute_position_refs
--    System XOR manual: either a system entity/document OR manual fields.
-- -----------------------------------------------------------------------------
CREATE TABLE dispute_position_refs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    position_id     UUID NOT NULL REFERENCES dispute_positions(id) ON DELETE CASCADE,
    ref_type        TEXT NOT NULL
                    CHECK (ref_type IN (
                        'change', 'correspondence', 'rfi', 'document', 'manual'
                    )),
    entity_id       UUID,
    document_id     UUID REFERENCES pdf_document(id) ON DELETE SET NULL,
    manual_title    TEXT,
    manual_date     DATE,
    manual_note     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT dispute_position_refs_system_xor_manual CHECK (
        (
            ref_type IN ('change', 'correspondence', 'rfi', 'document')
            AND (entity_id IS NOT NULL OR document_id IS NOT NULL)
            AND manual_title IS NULL
        )
        OR (
            ref_type = 'manual'
            AND entity_id IS NULL
            AND document_id IS NULL
            AND manual_title IS NOT NULL
        )
    )
);

CREATE INDEX idx_dispute_position_refs_position_id  ON dispute_position_refs(position_id);
CREATE INDEX idx_dispute_position_refs_document_id  ON dispute_position_refs(document_id);
CREATE INDEX idx_dispute_position_refs_entity_id    ON dispute_position_refs(entity_id);

ALTER TABLE dispute_position_refs ENABLE ROW LEVEL SECURITY;

CREATE POLICY dispute_position_refs_member_read ON dispute_position_refs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM dispute_positions p
            JOIN dispute_issues i ON i.id = p.issue_id
            JOIN disputes d ON d.id = i.dispute_id
            WHERE p.id = dispute_position_refs.position_id
              AND is_project_member(d.project_id)
        )
    );

CREATE POLICY dispute_position_refs_cm_write ON dispute_position_refs
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM dispute_positions p
            JOIN dispute_issues i ON i.id = p.issue_id
            JOIN disputes d ON d.id = i.dispute_id
            WHERE p.id = position_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );

CREATE POLICY dispute_position_refs_cm_update ON dispute_position_refs
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM dispute_positions p
            JOIN dispute_issues i ON i.id = p.issue_id
            JOIN disputes d ON d.id = i.dispute_id
            WHERE p.id = position_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM dispute_positions p
            JOIN dispute_issues i ON i.id = p.issue_id
            JOIN disputes d ON d.id = i.dispute_id
            WHERE p.id = position_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );

CREATE POLICY dispute_position_refs_cm_delete ON dispute_position_refs
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM dispute_positions p
            JOIN dispute_issues i ON i.id = p.issue_id
            JOIN disputes d ON d.id = i.dispute_id
            WHERE p.id = position_id
              AND is_project_member(d.project_id)
              AND get_project_role(d.project_id) = 'cm'
        )
    );


-- -----------------------------------------------------------------------------
-- 6) chronologies.entity_type += 'dispute'
--    Kronoloji bir belge dizisidir; dispute container'ı o diziyi taşır.
--    chronology_events.document_ref_type BILEREK dokunulmaz (032: Change bir
--    dosyadır, belge değil). Dispute kronolojisi correspondence/rfi/manual
--    + mevcut dispute_step event_type kullanır.
-- -----------------------------------------------------------------------------
ALTER TABLE chronologies
    DROP CONSTRAINT IF EXISTS chronologies_entity_type_check;

ALTER TABLE chronologies
    ADD CONSTRAINT chronologies_entity_type_check
    CHECK (entity_type IN (
        'change', 'rfi', 'correspondence', 'general', 'dispute'
    ));


-- -----------------------------------------------------------------------------
-- 7) pdf_document.entity_type += 'dispute'
--    Kaynak liste: 048. Yeni değer: dispute (dosyeye eklenen sergiler).
-- -----------------------------------------------------------------------------
ALTER TABLE pdf_document
    DROP CONSTRAINT IF EXISTS pdf_document_entity_type_check;

ALTER TABLE pdf_document
    ADD CONSTRAINT pdf_document_entity_type_check CHECK (
        entity_type IN (
            'correspondence',
            'rfi',
            'change',
            'deliverable',
            'chronology',
            'contract_document',
            'internal_alert',
            'draft',
            'dispute'
        )
    );


-- =============================================================================
-- VERIFICATION  (runnable as-is — Ali, after apply)
-- Expected:
--   disputes: member_read SELECT, cm_write INSERT, cm_update UPDATE; no DELETE
--   nested tables: member_read + cm_write/update/delete
--   chronologies CHECK includes 'dispute'
--   pdf_document CHECK includes 'dispute'
-- =============================================================================
-- SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE tablename LIKE 'dispute%'
--   ORDER BY tablename, cmd, policyname;
--
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'chronologies'::regclass
--     AND conname = 'chronologies_entity_type_check';
--
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'pdf_document'::regclass
--     AND conname = 'pdf_document_entity_type_check';
