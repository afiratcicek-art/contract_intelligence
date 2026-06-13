-- =====================================================================
-- VIEW: rfi_correspondence_links
-- Bir RFI'ya referans veren tüm correspondence'ları gösterir
-- Kullanım: WHERE rfi_id = '<id>'
-- =====================================================================

CREATE OR REPLACE VIEW rfi_correspondence_links AS
SELECT
    cr.rfi_id,
    r.rfi_number,
    r.subject                       AS rfi_subject,
    r.status                        AS rfi_status,
    r.project_id,

    c.id                            AS correspondence_id,
    c.corr_number,
    c.type                          AS corr_type,
    c.subject                       AS corr_subject,
    c.direction,
    c.correspondence_date,
    c.status                        AS corr_status,
    c.has_response,
    c.response_corr_id,

    cr.note,
    cr.added_at,
    cr.added_by
FROM correspondence_references cr
JOIN rfis r
    ON r.id = cr.rfi_id
    AND r.is_deleted = false
JOIN correspondences c
    ON c.id = cr.correspondence_id
    AND c.is_deleted = false
WHERE cr.ref_type = 'rfi';
