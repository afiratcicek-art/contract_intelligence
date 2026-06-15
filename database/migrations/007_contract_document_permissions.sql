-- ============================================================
-- Migration 007: contract_document entity
-- pdf_document.entity_type genişletme +
-- project_role_permissions contract_document satırları
-- ============================================================

-- ------------------------------------------------------------
-- 1. pdf_document.entity_type CHECK — contract_document eklenir
-- ------------------------------------------------------------
ALTER TABLE pdf_document
    DROP CONSTRAINT IF EXISTS pdf_document_entity_type_check;

ALTER TABLE pdf_document
    ADD CONSTRAINT pdf_document_entity_type_check CHECK (
        entity_type IN (
            'correspondence',
            'rfi',
            'change',
            'deliverable',
            'chronology',
            'contract_document'
        )
    );

-- ------------------------------------------------------------
-- 2. project_role_permissions — contract_document satırları
-- Tüm mevcut projeler için cm/engineer/dcc/viewer × 7 izin
-- ON CONFLICT DO NOTHING — manuel ayarları korur
-- ------------------------------------------------------------
INSERT INTO project_role_permissions
    (project_id, project_role, entity_type, permission, is_allowed)
SELECT
    p.id                AS project_id,
    r.role              AS project_role,
    'contract_document' AS entity_type,
    r.permission,
    r.is_allowed
FROM projects p
CROSS JOIN (VALUES
    ('cm',       'view',       true),
    ('cm',       'create',     true),
    ('cm',       'edit',       true),
    ('cm',       'approve',    false),
    ('cm',       'publish',    false),
    ('cm',       'close',      false),
    ('cm',       'inactivate', false),
    ('engineer', 'view',       true),
    ('engineer', 'create',     false),
    ('engineer', 'edit',       false),
    ('engineer', 'approve',    false),
    ('engineer', 'publish',    false),
    ('engineer', 'close',      false),
    ('engineer', 'inactivate', false),
    ('dcc',      'view',       true),
    ('dcc',      'create',     false),
    ('dcc',      'edit',       false),
    ('dcc',      'approve',    false),
    ('dcc',      'publish',    false),
    ('dcc',      'close',      false),
    ('dcc',      'inactivate', false),
    ('viewer',   'view',       true),
    ('viewer',   'create',     false),
    ('viewer',   'edit',       false),
    ('viewer',   'approve',    false),
    ('viewer',   'publish',    false),
    ('viewer',   'close',      false),
    ('viewer',   'inactivate', false)
) AS r(role, permission, is_allowed)
ON CONFLICT (project_id, project_role, entity_type, permission)
DO NOTHING;
