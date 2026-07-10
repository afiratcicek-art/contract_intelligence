-- ============================================================
-- 032_document_type_alignment.sql
-- Tarih: 2026-07-10
-- DURUM: URETIMDE UYGULANDI (Ali, Supabase SQL Editor, 2026-07-10)
--        Bu dosya bir makbuzdur. Yeniden calistirilmasi gerekmez.
--
-- AMAC
--   Referans ve kronoloji belge tiplerini tek kanonik manuel
--   listede birlestirmek. Kullanici, karsi taraftan gelen her
--   uygulanabilir belgeyi hem referans hem kronoloji olarak
--   isimlendirebilmelidir.
--
-- MANUEL BELGE TIPLERI (dokuz, uc tabloda AYNI):
--   drawing, spec, specialist, submission, response,
--   meeting, inspection, work_permit, other
--
-- IKI LISTE KASITLI OLARAK FARKLIDIR
--   Referans tablolari kayitli varlik olarak 'change' kabul eder
--   (changes.id FK). Kronoloji ETMEZ: chronology_events.document_ref_type
--   yalniz 'correspondence'/'rfi' kabul eder (migration 003).
--   Kronoloji bir BELGE dizisidir; bir Change belge degil, dosyadir.
--   Bu iki listeyi esitlemeye calisan gelecekteki refactor YANLISTIR.
--
-- CIKARILANLAR
--   external_doc  -> Belgenin NE OLDUGUNU degil, NEREDE DURDUGUNU
--                    soyluyordu. Bir cizim, kayitli olmasa da cizimdir.
--                    Uretimde 0 satir.
--   notice        -> Bir Notice, correspondences tablosunda type alaniyla
--                    yasayan bir yazismadir. Ayri tip = cift kimlik.
--                    Uretimde 0 satir.
--   status_change -> Statu gecisi belge degildir; rfis.status /
--                    correspondences.status + audit_log'da yasar.
--                    Verisi 5428339'da silindi; sema borcu burada kapandi.
--
-- KORUNAN
--   dispute_step  -> UI'ya bagli DEGIL, uretimde 0 satir. Olu deger degil,
--                    baglanmamis deger. Ihtilaf asamasi (DAAB/arbitration)
--                    mesru bir kronoloji olayidir. Silinmedi.
--
-- OLCUM (2026-07-10, uretim, migration ONCESI)
--   chronology_events:         correspondence 11, rfi 5, meeting 2, other 2
--   rfi_references:            correspondence 2
--   correspondence_references: 0 satir
--   external_doc / notice / status_change / dispute_step: HEPSI 0
--   -> Veri tasimasi GEREKMEDI. Saf CHECK degisimi.
--
-- KAYIT: TB-85 geri cekildi. "DB'de event_type CHECK'i yok" iddiasi
--        yanlisti; CHECK vardi ve status_change'i iceriyordu. Servis
--        katmani (record_event) dogrulamasi hala YOK.
-- ============================================================

BEGIN;

-- ---------- 1) rfi_references.ref_type ----------
ALTER TABLE rfi_references
  DROP CONSTRAINT rfi_references_ref_type_check;

ALTER TABLE rfi_references
  ADD CONSTRAINT rfi_references_ref_type_check
  CHECK (ref_type IN (
    -- kayitli varliklar (arama kutusundan secilir, FK ile baglanir)
    'rfi', 'correspondence', 'change',
    -- manuel belge tipleri
    'drawing', 'spec', 'specialist', 'submission', 'response',
    'meeting', 'inspection', 'work_permit', 'other'
  ));

-- ---------- 2) correspondence_references.ref_type ----------
ALTER TABLE correspondence_references
  DROP CONSTRAINT correspondence_references_ref_type_check;

ALTER TABLE correspondence_references
  ADD CONSTRAINT correspondence_references_ref_type_check
  CHECK (ref_type IN (
    'rfi', 'correspondence', 'change',
    'drawing', 'spec', 'specialist', 'submission', 'response',
    'meeting', 'inspection', 'work_permit', 'other'
  ));

-- ---------- 3) chronology_events.event_type ----------
-- 'change' YOK: document_ref_type CHECK'i onu zaten disliyor.
ALTER TABLE chronology_events
  DROP CONSTRAINT chronology_events_event_type_check;

ALTER TABLE chronology_events
  ADD CONSTRAINT chronology_events_event_type_check
  CHECK (event_type IN (
    'rfi', 'correspondence',
    'drawing', 'spec', 'specialist', 'submission', 'response',
    'meeting', 'inspection', 'work_permit', 'other',
    'dispute_step'
  ));

COMMIT;

-- ============================================================
-- DOGRULAMA (COMMIT sonrasi ayri calistirildi, 2026-07-10)
-- Sonuc: 12 / 12 / 12, ihlal 0 satir.
-- ============================================================
--
-- SELECT conrelid::regclass::text AS tbl, count(*) AS allowed_count
-- FROM pg_constraint,
--      LATERAL regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''::text', 'g')
-- WHERE conname IN ('rfi_references_ref_type_check',
--                   'correspondence_references_ref_type_check',
--                   'chronology_events_event_type_check')
-- GROUP BY 1 ORDER BY 1;
--
-- SELECT 'rfi_references' AS tbl, ref_type FROM rfi_references
--   WHERE ref_type NOT IN ('rfi','correspondence','change','drawing','spec',
--     'specialist','submission','response','meeting','inspection','work_permit','other')
-- UNION ALL
-- SELECT 'correspondence_references', ref_type FROM correspondence_references
--   WHERE ref_type NOT IN ('rfi','correspondence','change','drawing','spec',
--     'specialist','submission','response','meeting','inspection','work_permit','other')
-- UNION ALL
-- SELECT 'chronology_events', event_type FROM chronology_events
--   WHERE event_type NOT IN ('rfi','correspondence','drawing','spec','specialist',
--     'submission','response','meeting','inspection','work_permit','other','dispute_step');
