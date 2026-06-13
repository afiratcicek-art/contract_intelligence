-- =====================================================================
-- VIEW: change_correspondence_links
-- Bir Change'e doğrudan veya referans yoluyla bağlı tüm correspondence'ları gösterir
-- Kullanım: WHERE change_id = '<id>'
-- =====================================================================

CREATE OR REPLACE VIEW change_correspondence_links AS

-- Direct links via correspondence_change_links table
SELECT
    ccl.change_id,
    ch.change_number,
    ch.title                    AS change_title,
    ch.status                   AS change_status,
    ch.project_id,

    c.id                        AS correspondence_id,
    c.corr_number,
    c.type                      AS corr_type,
    c.subject                   AS corr_subject,
    c.direction,
    c.correspondence_date,
    c.status                    AS corr_status,
    c.has_response,
    c.response_corr_id,

    'direct'                    AS link_type,
    ccl.note,
    ccl.linked_at               AS linked_at,
    ccl.linked_by
FROM correspondence_change_links ccl
JOIN changes ch
    ON ch.id = ccl.change_id
    AND ch.is_deleted = false
JOIN correspondences c
    ON c.id = ccl.correspondence_id
    AND c.is_deleted = false

UNION ALL

-- Reference-based links via correspondence_references table
SELECT
    cr.change_id,
    ch.change_number,
    ch.title                    AS change_title,
    ch.status                   AS change_status,
    ch.project_id,

    c.id                        AS correspondence_id,
    c.corr_number,
    c.type                      AS corr_type,
    c.subject                   AS corr_subject,
    c.direction,
    c.correspondence_date,
    c.status                    AS corr_status,
    c.has_response,
    c.response_corr_id,

    'reference'                 AS link_type,
    cr.note,
    cr.added_at                 AS linked_at,
    cr.added_by                 AS linked_by
FROM correspondence_references cr
JOIN changes ch
    ON ch.id = cr.change_id
    AND ch.is_deleted = false
JOIN correspondences c
    ON c.id = cr.correspondence_id
    AND c.is_deleted = false
WHERE cr.ref_type = 'change';
