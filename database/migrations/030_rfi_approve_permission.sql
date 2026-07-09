-- Migration 030: rfi:approve permission seed
-- Author: ClauseIQ
-- Applied: (uygulama sonrasi doldur)
--
-- 627 onay kapisi: authored RFI 'draft' dogar, rfi:approve izni olan rol
-- onu 'open'a cikarir. Izin correspondence:approve deseninin aynasidir (cm).
-- Kullanicilar yetkiyi kendi aralarinda taksim eder: bu satir yalnizca
-- varsayilan seed'dir, project_role_permissions uzerinden degistirilebilir.

BEGIN;

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
    VALUES ('cm')
) AS roles(project_role)
CROSS JOIN (
    VALUES ('rfi')
) AS entities(entity_type)
CROSS JOIN (
    VALUES ('approve')
) AS perms(permission)
LEFT JOIN (
    VALUES
        ('cm', 'rfi', 'approve')
) AS allowed(project_role, entity_type, permission)
    ON roles.project_role = allowed.project_role
   AND entities.entity_type = allowed.entity_type
   AND perms.permission = allowed.permission
WHERE p.is_deleted = false
ON CONFLICT (project_id, project_role, entity_type, permission) DO NOTHING;

COMMIT;

-- DOGRULAMA (Ali calistiracak):
-- SELECT role, entity_type, permission, is_allowed FROM project_role_permissions
--   WHERE entity_type='rfi' AND permission='approve';
