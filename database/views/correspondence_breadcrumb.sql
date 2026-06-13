-- =====================================================================
-- VIEW: correspondence_breadcrumb
-- Her correspondence için tam parent zincirini döndürür (depth <= 10)
-- Kullanım: WHERE correspondence_id = '<id>'
-- =====================================================================

CREATE OR REPLACE VIEW correspondence_breadcrumb AS
WITH RECURSIVE breadcrumb AS (
    -- Base: her correspondence kendi başlangıcıdır
    SELECT
        c.id                AS correspondence_id,
        c.id                AS ancestor_id,
        c.parent_id,
        c.corr_number       AS ancestor_number,
        c.type              AS ancestor_type,
        c.subject           AS ancestor_subject,
        c.direction         AS ancestor_direction,
        c.correspondence_date AS ancestor_date,
        0                   AS depth
    FROM correspondences c
    WHERE c.is_deleted = false

    UNION ALL

    SELECT
        b.correspondence_id,
        p.id                AS ancestor_id,
        p.parent_id,
        p.corr_number       AS ancestor_number,
        p.type              AS ancestor_type,
        p.subject           AS ancestor_subject,
        p.direction         AS ancestor_direction,
        p.correspondence_date AS ancestor_date,
        b.depth + 1         AS depth
    FROM breadcrumb b
    JOIN correspondences p
        ON p.id = b.parent_id
        AND p.is_deleted = false
    WHERE b.depth < 10
)
SELECT
    correspondence_id,
    ancestor_id,
    ancestor_number,
    ancestor_type,
    ancestor_subject,
    ancestor_direction,
    ancestor_date,
    depth
FROM breadcrumb
WHERE depth > 0
ORDER BY correspondence_id, depth;
