-- ============================================================
-- Migration 027: RFI-owned references (rfi_references)
-- Symmetric to correspondence_references — owner is the RFI
-- card, not a correspondence card.
-- Additive only. No changes to existing tables/policies/views.
-- Supabase SQL Editor'da çalıştır
-- Applied: ____ (uygulama sonrası doldur)
-- ============================================================

BEGIN;

CREATE TABLE rfi_references (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_rfi_id        UUID NOT NULL REFERENCES rfis(id) ON DELETE CASCADE,
    ref_type            TEXT NOT NULL CHECK (ref_type IN
                        ('rfi','correspondence','change','external_doc',
                         'drawing','spec','other')),
    rfi_id              UUID REFERENCES rfis(id),            -- hedef RFI
    ref_corr_id         UUID REFERENCES correspondences(id), -- hedef Corr
    change_id           UUID REFERENCES changes(id),         -- hedef Change
    external_doc_number TEXT,
    external_doc_title  TEXT,
    external_doc_date   DATE,
    note                TEXT,
    added_by            UUID REFERENCES profiles(id),
    added_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rfi_refs_owner ON rfi_references(owner_rfi_id);

-- ── RLS (symmetric to correspondence_references, migration 002) ─────────────

ALTER TABLE rfi_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rfi_refs_member_read" ON rfi_references
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM rfis r
            WHERE r.id = rfi_references.owner_rfi_id
              AND is_project_member(r.project_id)
        )
    );

CREATE POLICY "rfi_refs_non_viewer_write" ON rfi_references
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM rfis r
            WHERE r.id = owner_rfi_id
              AND is_project_member(r.project_id)
              AND get_project_role(r.project_id) IN ('cm', 'engineer', 'dcc')
        )
    );

COMMIT;
