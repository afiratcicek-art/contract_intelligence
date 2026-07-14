-- ============================================================
-- 035_attachment_backfill.sql
-- Tarih: 2026-07-14
-- TUR: BACKFILL (migration DEGIL — tek seferlik veri islemi).
--      database/backfills/ altinda; migration sirasina KATILMAZ.
-- DURUM: NOT YET APPLIED (draft).
--
-- AMAC
--   035_reference_role.sql attachment/citation ayrimini semaya ekledi.
--   Bu backfill, o migrationdan ONCE yuklenmis evraklari geriye donuk
--   'attachment' referans satiri olarak etiketler. Boylece EKLI BELGELER
--   paneli (yeni kaynak: ref_role='attachment') mevcut evraklari gosterir.
--   Migration sonrasi UPLOAD yolundan gelen evraklar bu backfille DAHIL
--   DEGIL — onlari D2 (upload-path) canli yazar. Bu script bir kez calisir.
--
-- KARARLAR (Ali, 2026-07-14)
--   K1 = EVET: parse_status='failed' evraklar da attachment olur. Evrak
--        parse edilememis olabilir ama hala kaydin FIZIKSEL evraki; panel
--        parse_status'u zaten gosterir. Filtre YOK.
--   K2 = (a): Q2'deki 2 correspondence evraki zaten citation olarak bagli.
--        Onlarin citation satirina DOKUNULMAZ; ek olarak attachment satiri
--        eklenir. Ayni belge ayni kayda hem citation hem attachment olur —
--        model buna izin verir (uclu unique, ref_role ekseni). Citation
--        SILINMEZ/CEVRILMEZ (EK-10).
--
-- OLCUM (uygulama ONCESI, 2026-07-14 dev DB)
--   pdf_document entity rfi=13, correspondence=20 (Q1). Yetim=0 (Q3).
--   Zaten-attachment=0 -> beklenen YENI satir: rfi 13 + corr 20 = 33.
--   (Q2'deki 2 citation ayri satir, dokunulmaz.)
--
-- INCELIK 1 — added_by FK guvenligi (savunmali)
--   references.added_by -> profiles(id); pdf_document.created_by ->
--   auth.users(id). Supabase deseninde profiles.id = auth.users.id ama
--   eslesmeyen kullanici olabilir. LEFT JOIN profiles ile: eslesirse
--   provenance korunur, eslesmezse added_by NULL (kolon nullable, FK
--   ihlali OLMAZ). Backfill hicbir kosulda FK'den patlamaz.
--
-- INCELIK 2 — added_at = d.created_at (KARAR)
--   Referans satiri BUGUN ekleniyor ama iliskiyi temsil ettigi olay
--   evragin yuklendigi an. Arbitration-grade provenance icin added_at
--   evragin created_at'i yazilir (iliski o zaman dogdu), now() DEGIL.
--
-- IDEMPOTENCY
--   NOT EXISTS(attachment) guard'i + uclu partial unique. Tekrar
--   calistirilirsa 0 yeni satir; patlamaz.
--
-- GERI ALMA (cerrahi)
--   DELETE FROM rfi_references          WHERE ref_role='attachment' AND note='[backfill-035]';
--   DELETE FROM correspondence_references WHERE ref_role='attachment' AND note='[backfill-035]';
--   note marker'i yalniz bu backfill'i hedefler; canli upload attachment'larina DOKUNMAZ.
-- ============================================================
BEGIN;

-- ---------- 1) rfi evraklari -> attachment ----------
INSERT INTO rfi_references
  (owner_rfi_id, document_id, ref_type, ref_role, added_by, added_at, note)
SELECT
  d.entity_id, d.id, 'document', 'attachment', p.id, d.created_at, '[backfill-035]'
FROM pdf_document d
JOIN rfis x        ON x.id = d.entity_id
LEFT JOIN profiles p ON p.id = d.created_by
WHERE d.entity_type = 'rfi'
  AND NOT EXISTS (
    SELECT 1 FROM rfi_references r
    WHERE r.owner_rfi_id = d.entity_id
      AND r.document_id  = d.id
      AND r.ref_role     = 'attachment'
  );

-- ---------- 2) correspondence evraklari -> attachment ----------
INSERT INTO correspondence_references
  (correspondence_id, document_id, ref_type, ref_role, added_by, added_at, note)
SELECT
  d.entity_id, d.id, 'document', 'attachment', p.id, d.created_at, '[backfill-035]'
FROM pdf_document d
JOIN correspondences x ON x.id = d.entity_id
LEFT JOIN profiles p   ON p.id = d.created_by
WHERE d.entity_type = 'correspondence'
  AND NOT EXISTS (
    SELECT 1 FROM correspondence_references r
    WHERE r.correspondence_id = d.entity_id
      AND r.document_id       = d.id
      AND r.ref_role          = 'attachment'
  );

COMMIT;

-- ============================================================
-- DOGRULAMA (COMMIT sonrasi AYRI calistir)
-- ============================================================
-- 1) beklenen yeni satir sayisi: rfi 13, corr 20
-- SELECT 'rfi' t, count(*) FROM rfi_references
--   WHERE ref_role='attachment' AND note='[backfill-035]'
-- UNION ALL
-- SELECT 'corr', count(*) FROM correspondence_references
--   WHERE ref_role='attachment' AND note='[backfill-035]';
--
-- 2) attachment CHECK ihlali yok (hepsi document_id dolu)
-- SELECT count(*) AS bad FROM rfi_references
--   WHERE ref_role='attachment' AND document_id IS NULL
-- UNION ALL
-- SELECT count(*) FROM correspondence_references
--   WHERE ref_role='attachment' AND document_id IS NULL;
--
-- 3) K2 kontrol: 2 corr evraki artik hem citation hem attachment
-- SELECT correspondence_id, document_id, array_agg(ref_role ORDER BY ref_role)
-- FROM correspondence_references
-- WHERE document_id IS NOT NULL
-- GROUP BY correspondence_id, document_id
-- HAVING count(*) > 1;
