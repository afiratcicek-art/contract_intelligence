-- Migration 016: Add subject field to chronology_events
-- Used for manual entries where no document is linked.
-- Nullable — document-linked events do not use this field.

ALTER TABLE chronology_events
    ADD COLUMN IF NOT EXISTS subject VARCHAR(500);

COMMENT ON COLUMN chronology_events.subject IS
    'Optional subject/title for manual entries. '
    'Null for document-linked events.';
