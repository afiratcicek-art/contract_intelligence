-- Migration 025: extend rfis + correspondences search_vector to include
-- card-level keywords (TB-17 + TB-18).
--
-- GENERATED ALWAYS columns cannot be altered in-place; must DROP + ADD.
-- GIN indexes are recreated automatically on the new column definition.
--
-- immutable_array_to_string: already defined in migration 020.

-- ── rfis ─────────────────────────────────────────────────────────────────────
ALTER TABLE rfis DROP COLUMN IF EXISTS search_vector;

ALTER TABLE rfis
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    immutable_tsvector_english(
      coalesce(subject, '') || ' ' ||
      coalesce(immutable_array_to_string(keywords, ' '), '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS rfis_search_vector_gin
  ON rfis USING GIN (search_vector);

-- ── correspondences ───────────────────────────────────────────────────────────
ALTER TABLE correspondences DROP COLUMN IF EXISTS search_vector;

ALTER TABLE correspondences
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    immutable_tsvector_english(
      coalesce(subject, '') || ' ' ||
      coalesce(immutable_array_to_string(keywords, ' '), '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS correspondences_search_vector_gin
  ON correspondences USING GIN (search_vector);

-- Verify (run after migration):
-- SELECT id, subject, keywords, search_vector FROM rfis LIMIT 3;
-- SELECT id, subject, keywords, search_vector FROM correspondences LIMIT 3;
