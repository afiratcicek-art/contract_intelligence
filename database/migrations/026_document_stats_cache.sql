-- Migration 026: project_document_stats + project_keyword_stats + project_location_stats
--
-- Pattern: App-layer cache — no triggers on source tables, RLS fully enforced.
-- Write: backend uses admin client (service_role) — bypasses RLS by design.
-- Read:  JWT client with is_project_member() RLS policy.
--
-- keyword_stats source: correspondences.keywords + rfis.keywords (card-level, migration 024)
--   Keywords are immutable after creation — no decrement needed.
--   Soft-deleted records keep keyword signal (is_deleted rows excluded at stats build time).
--
-- location_stats source: pdf_document.location ONLY
--   correspondences + rfis have no location column (confirmed migration 017).
--
-- updated_at: managed by update_updated_at() trigger (defined in migration 001).

-- ── Stats cache (JSONB snapshot) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_document_stats (
  project_id  UUID        PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  stats_json  JSONB       NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at on every stats refresh
CREATE TRIGGER trg_project_document_stats_updated_at
  BEFORE UPDATE ON project_document_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Keyword frequency (incremental counter) ───────────────────────────────────
-- Source: correspondences.keywords + rfis.keywords (card-level, migration 024)
-- Immutable after creation — increment only, never decrement.
CREATE TABLE IF NOT EXISTS project_keyword_stats (
  project_id  UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword     TEXT    NOT NULL,
  count       INT     NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (project_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_keyword_stats_project_count
  ON project_keyword_stats (project_id, count DESC);

-- ── Location frequency (pdf_document.location only) ──────────────────────────
-- Source: pdf_document.location — correspondences/rfis have no location column.
-- Populated on PDF metadata approval (when location is confirmed by user/Haiku).
CREATE TABLE IF NOT EXISTS project_location_stats (
  project_id  UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  location    TEXT    NOT NULL,
  count       INT     NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (project_id, location)
);

CREATE INDEX IF NOT EXISTS idx_location_stats_project_count
  ON project_location_stats (project_id, count DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read: JWT client — project members only.
-- Write: admin client (service_role) — bypasses RLS by design.
--        No write policy needed; service_role ignores RLS.
--        Backend enforces project ownership before writing.

ALTER TABLE project_document_stats  ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_keyword_stats   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_location_stats  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read_doc_stats"
  ON project_document_stats FOR SELECT
  USING (is_project_member(project_id));

CREATE POLICY "members_read_keyword_stats"
  ON project_keyword_stats FOR SELECT
  USING (is_project_member(project_id));

CREATE POLICY "members_read_location_stats"
  ON project_location_stats FOR SELECT
  USING (is_project_member(project_id));

-- ── Verification ─────────────────────────────────────────────────────────────
-- Run after migration:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN (
--     'project_document_stats',
--     'project_keyword_stats',
--     'project_location_stats'
--   );
-- Expected: 3 rows
