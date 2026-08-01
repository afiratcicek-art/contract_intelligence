-- =============================================================================
-- 050_reference_page_ranges.sql
-- =============================================================================
-- WHY
--   A reference may cite specific page ranges of its primary PDF (e.g. spec
--   pages 3-5 & 8-11, or "3 to end"). Optional: absent/null = whole document.
--   Stored as JSONB (inner detail of a reference, never queried/filtered
--   separately) — multi-range + open-ended (to:null) fit naturally in one col.
--
-- WHAT
--   * rfi_references.page_ranges JSONB (nullable)
--   * correspondence_references.page_ranges JSONB (nullable)
--   Shape: [{"from":3,"to":5},{"from":8,"to":11},{"from":12,"to":null}]
--   Validation is enforced in the application layer (server-side), not a DB
--   CHECK — JSONB structural rules + page_count bound are app concerns.
-- =============================================================================

BEGIN;

ALTER TABLE rfi_references
  ADD COLUMN IF NOT EXISTS page_ranges JSONB;

ALTER TABLE correspondence_references
  ADD COLUMN IF NOT EXISTS page_ranges JSONB;

COMMIT;
