-- ============================================================
-- Migration 028: RFI draft status (additive, stage 1 of 627)
-- Adds 'draft' to rfis.status enum. DEFAULT deliberately UNCHANGED
-- (stays 'open') — flipping default to 'draft' happens in a LATER
-- migration, only AFTER draft-exclusion filters (deadline/graph/
-- alerts/chronology/EDOS) are in place. This step alone creates
-- zero drafts and zero behavioural ripple.
-- Re-runnable (DROP CONSTRAINT IF EXISTS). Additive only.
-- Supabase SQL Editor'da çalıştır
-- Applied: 2026-07-09
-- ============================================================

BEGIN;

ALTER TABLE rfis DROP CONSTRAINT IF EXISTS rfis_status_check;

ALTER TABLE rfis ADD CONSTRAINT rfis_status_check
CHECK (status IN ('draft', 'open', 'responded', 'closed', 'overdue'));

COMMIT;
