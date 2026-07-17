-- ============================================================================
-- 036_pdf_document_rls_fix.sql
-- ClauseIQ — 2026-07-17
-- ============================================================================
--
-- WHAT THIS FILE DOES
--   Replaces the row-level security policy on pdf_document with three
--   policies that follow this schema's established access model.
--
-- !! THIS FILE IS THE CURRENT SOURCE OF TRUTH FOR RLS ON pdf_document. !!
--    Earlier definitions are SUPERSEDED. Do not read them as current:
--       006_pdf_pipeline.sql:47        -- original CREATE POLICY
--       008_audit_rls_version.sql:49   -- DROP + re-CREATE
--    `rg pdf_document_tenant_isolation database/migrations/` returns three
--    hits. Only this file is in force. The policies created here carry NEW
--    NAMES, so once this migration is applied the old name returns zero rows
--    from pg_policies — grep and the live database finally agree.
--
-- !! REVISIT AFTER THE PILOT. !!
--    This is a pilot-phase decision, taken 2026-07-17 by the product owner.
--    Once the remaining pilot elements are complete, the whole role/permission
--    model — this file included — is to be reviewed as one piece, not patched
--    table by table. If you are reading this after the pilot and the roles
--    below look arbitrary, that review is the conversation you are looking for.
--
-- ----------------------------------------------------------------------------
-- WHY — two defects in the superseded policy
-- ----------------------------------------------------------------------------
--
-- DEFECT 1 — no is_active check.
--
--   The superseded policy read:
--       project_id IN (SELECT project_id FROM project_members
--                      WHERE user_id = auth.uid())
--
--   project_members rows are NEVER deleted. backend/routers/projects.py has
--   add_member() and update_member() only; there is no delete path, and
--   list_members() (projects.py:124) hides removed members with
--   .eq("is_active", True). Removal is a soft flag, and the row survives it —
--   so the subquery above kept matching forever.
--
--   Effect: a user removed from a project could still read that project's
--   pdf_document rows — including extracted_text and storage_path — by calling
--   PostgREST directly with their own JWT (readable from the browser's own
--   inspector; httpOnly stops JavaScript, not DevTools).
--
--   Every other guard in this system checks is_active:
--       backend/core/dependencies.py:71   verify_project_access
--       storage policies documents_read / documents_upload / documents_delete
--       002_rls_policies.sql:38-59        is_project_member / get_project_role
--   This one policy did not. That is the whole bug.
--
-- DEFECT 2 — FOR ALL, with the read predicate reused as WITH CHECK.
--
--   Any project member — including a 'viewer' — could INSERT, UPDATE or DELETE
--   pdf_document rows directly via PostgREST. The application never offers
--   that button, but RLS does not know about the application's buttons.
--
-- ----------------------------------------------------------------------------
-- THE MODEL: the schema states the intended access model, not today's callers.
-- ----------------------------------------------------------------------------
--
--   Measured 2026-07-17 (`rg -n -C 6 'table\(.*pdf_document' backend/`):
--   every write to pdf_document today goes through get_admin_client() —
--   the service_role client, which bypasses RLS entirely:
--
--       backend/routers/documents.py:222        insert  (upload, pending row)
--       backend/routers/documents.py:243        delete  (upload rollback)
--       backend/routers/documents.py:1467       update  (metadata approve)
--       backend/services/pdf_pipeline_service.py:320, :358   insert
--       backend/services/extraction_service.py:173, :261     update
--       backend/workers/pdf_worker.py:52, :80, :100, :134, :170   update
--       backend/main.py:132, :153               update  (startup recovery)
--
--   Not one write uses access["db"], the JWT-scoped client. So the write
--   policies below are, TODAY, unexercised.
--
--   They are here anyway, and deliberately. Call sites move; the access model
--   should not. RLS is where this system writes down who may do what, and the
--   answer for pdf_document is the same as for every sibling table: reading is
--   for members, writing is for non-viewers. A policy that merely mirrored
--   today's call sites would teach the next engineer nothing and would have to
--   be rediscovered the first time a write moves.
--
--   Roles are 'cm', 'engineer', 'dcc', 'viewer'. The ARRAY below is the
--   schema's spelling of "non-viewer" — see backend/core/dependencies.py:108
--   (require_non_viewer) for the application-side twin of the same rule.
--
-- ----------------------------------------------------------------------------
-- WHY THERE IS NO DELETE POLICY  (read before adding one)
-- ----------------------------------------------------------------------------
--
--   No table in this schema has a DELETE policy — not one, across all 35.
--   Deletion here is either a service_role operation (documents.py:243, the
--   upload rollback) or a soft flag (see backend/repositories/
--   chronology_repository.py:7 — "Forensic — silinmez, is_active kullanilir").
--   RLS denies any command with no matching policy, so DELETE via a user token
--   is closed. That is the schema's existing rule, not a new one invented here.
--
--   The superseded FOR ALL policy let any member DELETE. That was an accident
--   of using one policy for four commands, not a decision. It is removed.
--
-- ----------------------------------------------------------------------------
-- PATTERN — DO NOT HAND-WRITE MEMBERSHIP SUBQUERIES IN POLICIES.
-- ----------------------------------------------------------------------------
--
--       002_rls_policies.sql:38-48   is_project_member(p_project_id)
--                                    -> membership AND is_active
--       002_rls_policies.sql:50-59   get_project_role(p_project_id)
--                                    -> project_role, membership AND is_active
--
--   Every other policy in this schema calls these two helpers. DEFECT 1 exists
--   for exactly one reason: this table hand-wrote its subquery instead, and the
--   hand-written version dropped the is_active clause. Nobody noticed, because
--   nothing put the two side by side. Use the helpers.
--
-- ----------------------------------------------------------------------------
-- APPLICATION IMPACT: none. Visible delta for a legitimate user: zero.
-- ----------------------------------------------------------------------------
--
--   Reads through access["db"] — documents.py:296 (list), :1313 (detail),
--   :1352 (extracted_text), :1394 (signed-url -> storage_path), and
--   _reference_enrichment.py:37 — are all preceded by verify_project_access,
--   which already rejects inactive members at the API boundary. An active
--   member loses nothing here.
--
--   The only caller that loses access is a deactivated member going around the
--   API. That is the entire point of this file.
--
-- ROLLBACK: commented block at the end of this file.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS pdf_document_tenant_isolation ON pdf_document;

-- Read: any ACTIVE member of the owning project.
-- Name follows the schema convention <entity>_member_read — see
-- 002_rls_policies.sql:262 corr_docs_member_read, :365 deliv_docs_member_read.
CREATE POLICY pdf_document_member_read ON pdf_document
    FOR SELECT
    USING (is_project_member(project_id));

-- Insert: active member AND non-viewer role.
-- Mirrors 002_rls_policies.sql:271 corr_docs_non_viewer_write.
CREATE POLICY pdf_document_non_viewer_write ON pdf_document
    FOR INSERT
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = ANY (ARRAY['cm'::text, 'engineer'::text, 'dcc'::text])
    );

-- Update: same rule on both the old row (USING) and the new row (WITH CHECK).
-- WITH CHECK is what stops a member from moving a row into another project.
-- Mirrors 002_rls_policies.sql:157 rfis_non_viewer_update.
CREATE POLICY pdf_document_non_viewer_update ON pdf_document
    FOR UPDATE
    USING (
        is_project_member(project_id)
        AND get_project_role(project_id) = ANY (ARRAY['cm'::text, 'engineer'::text, 'dcc'::text])
    )
    WITH CHECK (
        is_project_member(project_id)
        AND get_project_role(project_id) = ANY (ARRAY['cm'::text, 'engineer'::text, 'dcc'::text])
    );

-- Delete: no policy, on purpose. See "WHY THERE IS NO DELETE POLICY" above.
-- Deleting these comment lines does not change behaviour; it only deletes the
-- reason. Keep them.

COMMIT;

-- ============================================================================
-- VERIFICATION — run after applying. Expect EXACTLY THREE rows:
--   pdf_document_member_read        | SELECT
--   pdf_document_non_viewer_write   | INSERT
--   pdf_document_non_viewer_update  | UPDATE
-- and NO row named pdf_document_tenant_isolation.
-- ============================================================================
--
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'pdf_document'
--   order by policyname;
--
--   Zero rows means RLS is on with no policy at all: the table is closed to
--   every JWT client, the application looks broken to users, and the
--   service_role paths keep working so the logs stay quiet. That is the
--   failure mode to watch for.
--
-- ============================================================================
-- ROLLBACK — restores the superseded policy from 008_audit_rls_version.sql.
--            Use only if 036 breaks something. It re-opens DEFECT 1 and
--            DEFECT 2 above. Read them before running this.
-- ============================================================================
--
--   BEGIN;
--   DROP POLICY IF EXISTS pdf_document_member_read ON pdf_document;
--   DROP POLICY IF EXISTS pdf_document_non_viewer_write ON pdf_document;
--   DROP POLICY IF EXISTS pdf_document_non_viewer_update ON pdf_document;
--   CREATE POLICY pdf_document_tenant_isolation ON pdf_document
--       FOR ALL
--       USING (project_id IN (SELECT project_members.project_id
--                             FROM project_members
--                             WHERE project_members.user_id = auth.uid()))
--       WITH CHECK (project_id IN (SELECT project_members.project_id
--                                  FROM project_members
--                                  WHERE project_members.user_id = auth.uid()));
--   COMMIT;
--
-- ============================================================================