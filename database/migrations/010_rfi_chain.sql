-- =============================================
-- ClauseIQ — Migration 010: RFI chain support
-- Applied: 2026-06-22
-- =============================================

-- RFI tablosuna parent_id ve rfi_type eklendi
-- parent_id NULL = original RFI
-- rfi_type: original | response | revision

ALTER TABLE rfis
ADD COLUMN parent_id uuid REFERENCES rfis(id),
ADD COLUMN rfi_type text NOT NULL DEFAULT 'original'
    CHECK (rfi_type = ANY (ARRAY[
        'original'::text,
        'response'::text,
        'revision'::text
    ]));

CREATE INDEX idx_rfis_parent_id
    ON rfis(parent_id)
    WHERE parent_id IS NOT NULL;

-- correspondence_references RLS durumu kontrol edildi
-- rowsecurity: true — ek işlem gerekmedi
