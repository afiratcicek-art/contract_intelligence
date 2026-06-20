-- =============================================
-- ClauseIQ — Migration 009: change_event_documents
-- Applied: 2026-06-20
-- =============================================

-- change_event_documents: chronology event'lerine belge bağlama
CREATE TABLE IF NOT EXISTS change_event_documents (
    id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id            uuid NOT NULL REFERENCES chronology_events(id),
    link_type           text NOT NULL CHECK (link_type = ANY (ARRAY[
                            'correspondence'::text,
                            'rfi'::text,
                            'uploaded_file'::text
                        ])),
    correspondence_id   uuid REFERENCES correspondences(id),
    rfi_id              uuid REFERENCES rfis(id),
    pdf_document_id     uuid REFERENCES pdf_document(id),
    note                text,
    added_by            uuid REFERENCES profiles(id),
    added_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE change_event_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "change_event_documents_select" ON change_event_documents
FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM chronology_events ce
        JOIN chronologies c ON c.id = ce.chronology_id
        WHERE ce.id = change_event_documents.event_id
        AND is_project_member(c.project_id)
    )
);

CREATE POLICY "change_event_documents_insert" ON change_event_documents
FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM chronology_events ce
        JOIN chronologies c ON c.id = ce.chronology_id
        WHERE ce.id = change_event_documents.event_id
        AND is_project_member(c.project_id)
    )
);

CREATE INDEX idx_change_event_documents_event_id
    ON change_event_documents(event_id);

CREATE INDEX idx_change_event_documents_correspondence_id
    ON change_event_documents(correspondence_id)
    WHERE correspondence_id IS NOT NULL;

CREATE INDEX idx_change_event_documents_rfi_id
    ON change_event_documents(rfi_id)
    WHERE rfi_id IS NOT NULL;

-- Discipline constraint güncellendi (rfis tablosu)
-- ALTER TABLE rfis DROP CONSTRAINT rfis_discipline_check;
-- ALTER TABLE rfis ADD CONSTRAINT rfis_discipline_check
-- CHECK (discipline = ANY (ARRAY[
--     'Civil', 'Architectural', 'Structural',
--     'Mechanical', 'Electrical', 'Plumbing', 'Other'
-- ]));

-- Origin constraint güncellendi (changes tablosu)
-- ALTER TABLE changes DROP CONSTRAINT changes_origin_check;
-- ALTER TABLE changes ADD CONSTRAINT changes_origin_check
-- CHECK (origin = ANY (ARRAY[
--     'employer_instruction', 'contractor_discovery',
--     'design_change', 'site_condition',
--     'scope_addition', 'regulatory', 'other'
-- ]));
