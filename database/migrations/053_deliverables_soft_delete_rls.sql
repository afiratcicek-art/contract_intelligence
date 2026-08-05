-- 053_deliverables_soft_delete_rls.sql
-- Measured root cause (user JWT): UPDATE deliverables SET is_deleted=true
-- fails with Postgres 42501 "new row violates row-level security policy"
-- because SELECT policy required is_deleted=false and Postgres CHECKS the
-- new row on UPDATE (even without RETURNING / Prefer return=minimal).
--
-- Fix: SELECT visibility = project membership only. Soft-deleted rows stay
-- hidden via application filters (.eq("is_deleted", False)) already present
-- in DeliverableRepository / BaseRepository.

DROP POLICY IF EXISTS deliverables_member_read ON deliverables;

CREATE POLICY deliverables_member_read ON deliverables
    FOR SELECT USING (is_project_member(project_id));

-- DOGRULAMA:
-- SET ROLE authenticated; -- + JWT claims for a project member
-- UPDATE deliverables SET is_deleted = true WHERE id = '<id>';
-- Beklenen: success (no 42501).
