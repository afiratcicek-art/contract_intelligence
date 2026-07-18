-- =============================================================================
-- 038_amendments_clause_overrides_cm_only_rls.sql
-- =============================================================================
-- WHY THIS EXISTS  (this is a CORRECTION of migration 037)
--   Migration 037 granted INSERT/UPDATE on `amendments` and `clause_overrides`
--   to non-viewer roles (cm/engineer/dcc), by mirroring 036 (pdf_document)
--   verbatim. That was the WRONG access model for this surface.
--
--   An `amendments` row is the record of a CONTRACT-ALTERING instrument, and a
--   `clause_overrides` row is an assertion of CONTRACTUAL EFFECT (which clause
--   is superseded by which instrument). Per the product owner's domain ruling
--   (MRICS): registering an amendment AND asserting/confirming an override are
--   Contract Manager authority — not an engineer's or a document controller's.
--   A pdf_document is an ordinary filed document; an amendment/override is a
--   legal-effect decision. They must not share the same write gate.
--
--   The API layer gates these endpoints with require_cm_role. This migration
--   makes the RLS second-line defense STATE THE SAME MODEL, per binding
--   decision K9 ("the schema must state the intended access model, not mirror
--   today's call sites"). 037 stated the wrong model; 038 fixes it.
--
-- WHAT CHANGES
--   For BOTH tables: DROP the *_non_viewer_write / *_non_viewer_update policies
--   from 037 and recreate them as *_cm_write / *_cm_update, gated on
--   get_project_role(project_id) = 'cm'. The *_member_read policies are LEFT
--   UNCHANGED: reading the in-force contract picture stays at project-member
--   level (every member may SEE it; only a CM may WRITE it). K9 revisits the
--   read model as one piece later — not touched here.
--
-- WHAT THIS IS NOT
--   This is NOT the per-entity permission patching K9 forbids. That would mean
--   seeding project_role_permissions rows to drive require_permission(). This
--   migration only retunes the EXISTING coarse role gate to its correct value
--   ('cm') — the same is_project_member()/get_project_role() machinery every
--   other table already uses (002:38-59).
--
-- APPLY SEQUENCE
--   file -> database/migrations/038_amendments_clause_overrides_cm_only_rls.sql
--   -> run in Supabase SQL Editor -> run the VERIFICATION query at the bottom
--   (runnable as-is) -> bring output back to the architect -> Ali commits (EK-5).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- amendments: non-viewer write/update  ->  CM-only
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS amendments_non_viewer_write  ON amendments;
DROP POLICY IF EXISTS amendments_non_viewer_update ON amendments;

CREATE POLICY amendments_cm_write ON amendments
    FOR INSERT
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

CREATE POLICY amendments_cm_update ON amendments
    FOR UPDATE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    )
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );


-- -----------------------------------------------------------------------------
-- clause_overrides: non-viewer write/update  ->  CM-only
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS clause_overrides_non_viewer_write  ON clause_overrides;
DROP POLICY IF EXISTS clause_overrides_non_viewer_update ON clause_overrides;

CREATE POLICY clause_overrides_cm_write ON clause_overrides
    FOR INSERT
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

CREATE POLICY clause_overrides_cm_update ON clause_overrides
    FOR UPDATE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    )
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );


-- =============================================================================
-- VERIFICATION  (runnable as-is — run after the migration, bring output back)
-- Expected 6 rows: each table has member_read [SELECT] = 'member-read',
-- cm_write [INSERT] = 'CM-ONLY', cm_update [UPDATE] = 'CM-ONLY'.
-- If ANY row shows 'NON-VIEWER (037 leftover!)', a drop failed — stop and report.
-- =============================================================================
SELECT tablename,
       policyname,
       cmd,
       CASE
         WHEN coalesce(qual, '') ILIKE '%engineer%' OR coalesce(with_check, '') ILIKE '%engineer%'
              THEN 'NON-VIEWER (037 leftover!)'
         WHEN coalesce(qual, '') ILIKE '%= ''cm''%' OR coalesce(with_check, '') ILIKE '%= ''cm''%'
              THEN 'CM-ONLY'
         WHEN cmd = 'SELECT'
              THEN 'member-read'
         ELSE 'other'
       END AS gate
FROM pg_policies
WHERE tablename IN ('amendments', 'clause_overrides')
ORDER BY tablename, cmd, policyname;
