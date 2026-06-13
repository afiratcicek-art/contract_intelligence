-- =====================================================================
-- VIEW: pending_deadlines
-- Tüm entitylerin yaklaşan deadline'larını tek sorguda döndürür
-- Kullanım: WHERE project_id = '<id>' AND days_remaining <= 14
-- =====================================================================

CREATE OR REPLACE VIEW pending_deadlines AS

-- RFI deadlines
SELECT
    r.project_id,
    'rfi'                       AS entity_type,
    r.id                        AS entity_id,
    r.rfi_number                AS reference_number,
    r.subject,
    r.response_due_date         AS deadline_date,
    r.response_due_source       AS deadline_source,
    r.response_due_day_type     AS day_type,
    (r.response_due_date - CURRENT_DATE)::INTEGER AS days_remaining,
    CASE
        WHEN r.response_due_date < CURRENT_DATE                         THEN 'KRITIK'
        WHEN (r.response_due_date - CURRENT_DATE) <= 3                  THEN 'ACIL'
        WHEN (r.response_due_date - CURRENT_DATE) <= 7                  THEN 'UYARI'
        ELSE 'NORMAL'
    END                         AS urgency,
    r.status
FROM rfis r
WHERE r.is_deleted = false
  AND r.response_due_date IS NOT NULL
  AND r.status IN ('open', 'overdue')

UNION ALL

-- Correspondence deadlines
SELECT
    c.project_id,
    'correspondence'            AS entity_type,
    c.id                        AS entity_id,
    c.corr_number               AS reference_number,
    c.subject,
    c.response_due_date         AS deadline_date,
    c.response_due_source       AS deadline_source,
    c.response_due_day_type     AS day_type,
    (c.response_due_date - CURRENT_DATE)::INTEGER AS days_remaining,
    CASE
        WHEN c.response_due_date < CURRENT_DATE                         THEN 'KRITIK'
        WHEN (c.response_due_date - CURRENT_DATE) <= 3                  THEN 'ACIL'
        WHEN (c.response_due_date - CURRENT_DATE) <= 7                  THEN 'UYARI'
        ELSE 'NORMAL'
    END                         AS urgency,
    c.status
FROM correspondences c
WHERE c.is_deleted = false
  AND c.response_due_date IS NOT NULL
  AND c.actual_response_date IS NULL
  AND c.status IN ('draft', 'under_review', 'approved', 'published')

UNION ALL

-- Change notice deadlines
SELECT
    ch.project_id,
    'change_notice'             AS entity_type,
    ch.id                       AS entity_id,
    ch.change_number            AS reference_number,
    ch.title                    AS subject,
    ch.notice_due_date          AS deadline_date,
    ch.notice_due_source        AS deadline_source,
    ch.notice_due_day_type      AS day_type,
    (ch.notice_due_date - CURRENT_DATE)::INTEGER AS days_remaining,
    CASE
        WHEN ch.notice_due_date < CURRENT_DATE                          THEN 'KRITIK'
        WHEN (ch.notice_due_date - CURRENT_DATE) <= 3                   THEN 'ACIL'
        WHEN (ch.notice_due_date - CURRENT_DATE) <= 7                   THEN 'UYARI'
        ELSE 'NORMAL'
    END                         AS urgency,
    ch.status
FROM changes ch
WHERE ch.is_deleted = false
  AND ch.notice_due_date IS NOT NULL
  AND ch.notice_sent = false

UNION ALL

-- Change impact deadlines
SELECT
    ch.project_id,
    'change_impact'             AS entity_type,
    ch.id                       AS entity_id,
    ch.change_number            AS reference_number,
    ch.title                    AS subject,
    ch.impact_due_date          AS deadline_date,
    ch.impact_due_source        AS deadline_source,
    NULL                        AS day_type,
    (ch.impact_due_date - CURRENT_DATE)::INTEGER AS days_remaining,
    CASE
        WHEN ch.impact_due_date < CURRENT_DATE                          THEN 'KRITIK'
        WHEN (ch.impact_due_date - CURRENT_DATE) <= 3                   THEN 'ACIL'
        WHEN (ch.impact_due_date - CURRENT_DATE) <= 7                   THEN 'UYARI'
        ELSE 'NORMAL'
    END                         AS urgency,
    ch.status
FROM changes ch
WHERE ch.is_deleted = false
  AND ch.impact_due_date IS NOT NULL
  AND ch.impact_submitted_date IS NULL;
