-- =============================================
-- ClauseIQ — Migration 012: Alert document references
-- Applied: 2026-06-24
-- =============================================
-- internal_alerts tablosuna document_references eklendi.
-- Her alert ilgili pdf_document kayıtlarına referans verebilir.
-- İki kaynak:
--   1. Mevcut entity belgelerinden seçilen (referans)
--   2. Doğrudan alert'e yüklenen yeni belgeler
--      (pdf_document.entity_type = 'internal_alert')

ALTER TABLE internal_alerts
ADD COLUMN document_references UUID[] DEFAULT '{}';

COMMENT ON COLUMN internal_alerts.document_references IS
'pdf_document.id referansları — mevcut belgelerden seçilen veya
 doğrudan bu alert e yüklenen belgeler. entity_type=internal_alert
 olan pdf_document kayıtları da bu diziye eklenir.';
