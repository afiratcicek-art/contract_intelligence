-- ============================================================
-- Migration 045: ai_policy — per-project AI provider gate (C1b)
-- Governs the CHAT/completion egress channel ONLY.
-- Embeddings are LOCAL (ADR-0001) → NOT gated here.
-- provider ∈ (anthropic, local, none). 'local' forward-declared
--   (no adapter yet → app fail-closes until Faz-3).
-- Effective provider = MOST RESTRICTIVE of (tenant-default, project-override):
--   restrictiveness: none > local > anthropic.
--   No tenant-default row → 'none' (fail-closed; absence = AI off).
-- Project override can only RESTRICT, never escalate.
-- No seed rows: table ships empty → AI off everywhere until set.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_policy (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,                       -- soft anchor (no tenants table)
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = tenant-default
    provider    TEXT NOT NULL CHECK (provider IN ('anthropic','local','none')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_policy IS
    'Per-project AI chat-provider gate (C1b). project_id NULL = tenant default. '
    'Effective = most-restrictive(tenant-default, project-override); no row = none (fail-closed). '
    'Embeddings are local (ADR-0001) and NOT governed here.';

-- One tenant-default per tenant; one override per project.
CREATE UNIQUE INDEX IF NOT EXISTS ai_policy_tenant_default_uq
    ON ai_policy (tenant_id) WHERE project_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ai_policy_project_override_uq
    ON ai_policy (project_id) WHERE project_id IS NOT NULL;

-- Effective provider: most-restrictive of tenant-default (or 'none' if absent) and project-override.
CREATE OR REPLACE FUNCTION effective_provider(p_project_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE((
        SELECT provider FROM (
            -- tenant-default, fail-closed to 'none' when absent
            SELECT COALESCE((
                SELECT ap.provider FROM ai_policy ap
                JOIN projects pr ON pr.id = p_project_id
                WHERE ap.project_id IS NULL AND ap.tenant_id = pr.tenant_id
                LIMIT 1
            ), 'none') AS provider
            UNION ALL
            -- project override (if any)
            SELECT ap.provider FROM ai_policy ap WHERE ap.project_id = p_project_id
        ) c
        ORDER BY CASE provider WHEN 'none' THEN 2 WHEN 'local' THEN 1 ELSE 0 END DESC
        LIMIT 1
    ), 'none');
$$;

ALTER TABLE ai_policy ENABLE ROW LEVEL SECURITY;

-- Read: tenant-default rows → tenant members; override rows → project members.
CREATE POLICY ai_policy_read ON ai_policy
    FOR SELECT
    USING (
        (project_id IS NULL AND tenant_id = get_user_tenant_id())
        OR (project_id IS NOT NULL AND is_project_member(project_id))
    );

-- Write override rows (project_id set): CM-only (043 pattern).
-- Tenant-default rows (project_id NULL): NO policy → service_role only.
CREATE POLICY ai_policy_cm_write ON ai_policy
    FOR INSERT
    WITH CHECK (
        project_id IS NOT NULL
        AND is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );

CREATE POLICY ai_policy_cm_update ON ai_policy
    FOR UPDATE
    USING (
        project_id IS NOT NULL
        AND is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    )
    WITH CHECK (
        project_id IS NOT NULL
        AND is_project_member(project_id)
        AND get_project_role(project_id) = 'cm'
    );
-- No DELETE / no FOR ALL (house pattern).
