-- ============================================================
-- Migration 024: Card-level keywords
-- Keywords live directly on correspondences and rfis —
-- independent of any attached pdf_document.
-- ============================================================

ALTER TABLE correspondences
    ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}';

ALTER TABLE rfis
    ADD COLUMN IF NOT EXISTS keywords TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_correspondences_keywords_gin
    ON correspondences USING GIN (keywords);

CREATE INDEX IF NOT EXISTS idx_rfis_keywords_gin
    ON rfis USING GIN (keywords);

COMMENT ON COLUMN correspondences.keywords IS
    'User-entered or Haiku-extracted keywords for this card.';

COMMENT ON COLUMN rfis.keywords IS
    'User-entered or Haiku-extracted keywords for this card.';
