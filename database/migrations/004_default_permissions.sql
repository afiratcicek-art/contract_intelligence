-- =====================================================================
-- ClauseIQ — Migration 004: Default project_role_permissions
-- 001–003 çalıştırıldıktan sonra uygula
--
-- Rol × entity × permission matrisini doldurur (is_allowed true/false).
-- "view" izni 001 şemasında yok; önce CHECK genişletilir.
-- ON CONFLICT DO NOTHING: mevcut satırlar korunur.
-- =====================================================================

ALTER TABLE project_role_permissions
    DROP CONSTRAINT IF EXISTS project_role_permissions_permission_check;

ALTER TABLE project_role_permissions
    ADD CONSTRAINT project_role_permissions_permission_check
    CHECK (permission IN (
        'view', 'create', 'edit', 'approve', 'publish', 'close', 'inactivate'
    ));

INSERT INTO project_role_permissions (
    project_id,
    project_role,
    entity_type,
    permission,
    is_allowed
)
SELECT
    p.id,
    roles.project_role,
    entities.entity_type,
    perms.permission,
    (allowed.permission IS NOT NULL) AS is_allowed
FROM projects p
CROSS JOIN (
    VALUES ('cm'), ('engineer'), ('dcc'), ('viewer')
) AS roles(project_role)
CROSS JOIN (
    VALUES
        ('rfi'),
        ('correspondence'),
        ('change'),
        ('chronology'),
        ('deliverable')
) AS entities(entity_type)
CROSS JOIN (
    VALUES
        ('view'),
        ('create'),
        ('edit'),
        ('approve'),
        ('publish'),
        ('close'),
        ('inactivate')
) AS perms(permission)
LEFT JOIN (
    VALUES
        -- CM
        ('cm', 'rfi', 'view'),
        ('cm', 'rfi', 'close'),
        ('cm', 'correspondence', 'create'),
        ('cm', 'correspondence', 'edit'),
        ('cm', 'correspondence', 'approve'),
        ('cm', 'correspondence', 'publish'),
        ('cm', 'correspondence', 'close'),
        ('cm', 'correspondence', 'inactivate'),
        ('cm', 'change', 'create'),
        ('cm', 'change', 'edit'),
        ('cm', 'change', 'approve'),
        ('cm', 'change', 'publish'),
        ('cm', 'change', 'close'),
        ('cm', 'change', 'inactivate'),
        ('cm', 'chronology', 'create'),
        ('cm', 'chronology', 'edit'),
        ('cm', 'chronology', 'approve'),
        ('cm', 'chronology', 'publish'),
        ('cm', 'chronology', 'close'),
        ('cm', 'chronology', 'inactivate'),
        ('cm', 'deliverable', 'create'),
        ('cm', 'deliverable', 'edit'),
        ('cm', 'deliverable', 'approve'),
        ('cm', 'deliverable', 'publish'),
        ('cm', 'deliverable', 'close'),
        ('cm', 'deliverable', 'inactivate'),
        -- Engineer
        ('engineer', 'rfi', 'create'),
        ('engineer', 'rfi', 'edit'),
        ('engineer', 'rfi', 'close'),
        ('engineer', 'correspondence', 'create'),
        ('engineer', 'correspondence', 'edit'),
        ('engineer', 'deliverable', 'create'),
        ('engineer', 'deliverable', 'edit'),
        -- DCC
        ('dcc', 'rfi', 'view'),
        ('dcc', 'correspondence', 'create'),
        ('dcc', 'change', 'view'),
        ('dcc', 'chronology', 'view'),
        ('dcc', 'deliverable', 'view'),
        -- Viewer
        ('viewer', 'rfi', 'view'),
        ('viewer', 'correspondence', 'view'),
        ('viewer', 'change', 'view'),
        ('viewer', 'chronology', 'view'),
        ('viewer', 'deliverable', 'view')
) AS allowed(project_role, entity_type, permission)
    ON roles.project_role = allowed.project_role
   AND entities.entity_type = allowed.entity_type
   AND perms.permission = allowed.permission
WHERE p.is_deleted = false
ON CONFLICT (project_id, project_role, entity_type, permission) DO NOTHING;
