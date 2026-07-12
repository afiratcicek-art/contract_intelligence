-- ============================================================
-- 034_reference_document_type.sql
-- Tarih: 2026-07-12
-- DURUM: URETIMDE UYGULANDI (Ali, Supabase SQL Editor, 2026-07-12)
--        Dogrulama: allowed_count 13/13, ihlal 0 satir. Bu dosya bir
--        makbuzdur. Yeniden calistirilmasi gerekmez.
--
-- AMAC
--   e-Bundle Katman 2: bir referans, document_id FK ile gercek bir
--   pdf_document satirina baglanabilir (033). Mevcut CHECK (032)
--   'document' degerini icermiyor -> INSERT 23514 CHECK violation ->
--   (TB-115 nedeniyle) HTTP 500. Bu migration 'document' degerini iki
--   referans tablosunun ref_type CHECK listesine ekler.
--
-- 'document' NEREYE AITTIR (gelecekteki mimar icin)
--   ref_type iki gruba ayrilir:
--     (1) KAYITLI VARLIK ayrimlayicilari — FK ile baglanir; ref_type
--         yalnizca "hangi varlik" der, ayrinti FK hedefinden okunur:
--           'rfi' -> rfi_id, 'correspondence' -> ref_corr_id,
--           'change' -> change_id, 'document' -> document_id (033 FK).
--     (2) MANUEL belge tipleri — FK YOK, tip external_doc_* ile elle
--         girilir: 'drawing','spec','specialist','submission',
--         'response','meeting','inspection','work_permit','other'.
--   'document' (1)'e girer, (2)'ye DEGIL. Bir ayrimlayicidir: "bu
--   referans bir yuklu belgeye isaret eder, ayrintiyi pdf_document'ten
--   oku" der. Belgenin TIPI pdf_document.doc_type'ta yasar (019) ve
--   join ile okunur (P2 doc_map deseni). ref_type'a KOPYALANMAZ ->
--   tek-dogruluk-kaynagi korunur.
--
-- 032'DE CIKARILAN external_doc ILE KARISTIRMA
--   external_doc MANUEL gruptaydi (FK yok) ve bir manuel belgenin
--   TIPINI tasimasi gerekirken "nerede durdugunu" soyluyordu -> atildi.
--   'document' KAYITLI grupta, arkasinda document_id FK var, tipini FK
--   hedefinden verir. Ayni hatanin tekrari DEGIL.
--
-- CHRONOLOGY'YE DOKUNULMAZ
--   chronology_events.event_type'a 'document' EKLENMEZ; kronolojinin
--   document_id baglantisi yok (e-Bundle Katman 1, yol haritasinda en
--   son). 032'nin iki listeyi kasitli farkli tutma karari korunur.
--
-- OLCUM (2026-07-12, uygulama ONCESI beklenen)
--   ref_type='document' olan satir: 0 (UI'den henuz baglanamiyor;
--   create-picker P3'te gelir). Saf CHECK genislemesi, veri tasimasi YOK.
--
-- IDEMPOTENCY
--   DROP CONSTRAINT IF EXISTS kullanilir (032 kullanmiyordu). Sebep:
--   TECHNICAL_DEBT.md manuel surecte "tekrar calistirma riski"ni
--   isaretliyor; IF EXISTS bu migration'i tekrar-guvenli yapar.
-- ============================================================

BEGIN;

-- ---------- 1) rfi_references.ref_type ----------
ALTER TABLE rfi_references
  DROP CONSTRAINT IF EXISTS rfi_references_ref_type_check;

ALTER TABLE rfi_references
  ADD CONSTRAINT rfi_references_ref_type_check
  CHECK (ref_type IN (
    -- kayitli varliklar (FK ile baglanir; ayrintiyi hedeften oku)
    'rfi', 'correspondence', 'change', 'document',
    -- manuel belge tipleri (FK yok; tip external_doc_* ile girilir)
    'drawing', 'spec', 'specialist', 'submission', 'response',
    'meeting', 'inspection', 'work_permit', 'other'
  ));

-- ---------- 2) correspondence_references.ref_type (SIMETRIK) ----------
ALTER TABLE correspondence_references
  DROP CONSTRAINT IF EXISTS correspondence_references_ref_type_check;

ALTER TABLE correspondence_references
  ADD CONSTRAINT correspondence_references_ref_type_check
  CHECK (ref_type IN (
    'rfi', 'correspondence', 'change', 'document',
    'drawing', 'spec', 'specialist', 'submission', 'response',
    'meeting', 'inspection', 'work_permit', 'other'
  ));

COMMIT;

-- ============================================================
-- DOGRULAMA (COMMIT sonrasi AYRI calistir)
-- Beklenen: her iki constraint 13 izinli deger; ihlal 0 satir.
-- ============================================================
--
-- SELECT conrelid::regclass::text AS tbl, count(*) AS allowed_count
-- FROM pg_constraint,
--      LATERAL regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''::text', 'g')
-- WHERE conname IN ('rfi_references_ref_type_check',
--                   'correspondence_references_ref_type_check')
-- GROUP BY 1 ORDER BY 1;   -- her iki satir allowed_count = 13
--
-- SELECT 'rfi_references' tbl, ref_type FROM rfi_references
--   WHERE ref_type NOT IN ('rfi','correspondence','change','document',
--     'drawing','spec','specialist','submission','response','meeting',
--     'inspection','work_permit','other')
-- UNION ALL
-- SELECT 'correspondence_references', ref_type FROM correspondence_references
--   WHERE ref_type NOT IN ('rfi','correspondence','change','document',
--     'drawing','spec','specialist','submission','response','meeting',
--     'inspection','work_permit','other');   -- 0 satir donmeli
