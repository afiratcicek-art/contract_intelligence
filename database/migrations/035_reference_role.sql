-- ============================================================
-- 035_reference_role.sql
-- Tarih: 2026-07-14
-- DURUM: URETIMDE UYGULANDI (Ali, Supabase SQL Editor, 2026-07-14)
--        Dogrulama: ref_role iki tabloda NOT NULL DEFAULT 'citation';
--        mevcut 26 satir (rfi=12, corr=14) hepsi citation; iki unique
--        index (owner, document_id, ref_role) uzerine kuruldu. Bu dosya
--        bir makbuzdur. Yeniden calistirilmasi gerekmez.
--
-- AMAC
--   EKLI BELGELER (kaydin kendi evraki) ile REFERANSLAR (kaydin atif
--   yaptigi ekler) ayrimini SEMAYA kaydet. Bugune kadar bu ayrim hicbir
--   kolonda yoktu (v11 §3: ayrim document_id dolu/bos ekseninde
--   CIKARILIYORDU — kirilgan, yanlis). Bu migration niyeti ACIK kolonla
--   kaydeder: ref_role in {attachment, citation}.
--     attachment = kaydin kendi evraki (upload-path yazar; EKLI panel).
--     citation   = kaydin atif yaptigi ek (picker yazar; REFERANSLAR panel).
--   Bir belge AYNI kayda hem attachment hem citation olabilir (farkli
--   kavramlar); ama ayni rolde iki kez giremez.
--
-- MODEL KARARI: AK-YOLX-2 = (A) tek unified tablo + acik ayirici kolon.
--   (B) reddedildi: "belgeler referanslarla birlikte saklanir" + EDOS
--   tek-liste export gereksinimi tek kaynak istiyor.
--
-- ADR-eBundle-002 UYUMU
--   Uyelik HER ZAMAN referans tablosundan okunur. attachment satiri da
--   referans tablosunda -> EKLI panel artik pdf_document.entity
--   taramasindan DEGIL, ref_role='attachment'tan okunacak (D1).
--
-- INDEX GEVSETME (EK-10 — ayri, onayli karar)
--   033'un uq_*_owner_document index'i (owner, document_id) idi. Bu,
--   attachment+citation birlikteligini yanlislikla YASAKLIYOR ->
--   backfill'de 23505. Index'e ref_role eklenir: (owner, document_id,
--   ref_role). Duplicate korumasi KALKMAZ, rol eksenine tasinir:
--   iki attachment yasak, iki citation yasak, attachment+citation serbest.
--   Guvenlik: yetki/RLS/IDOR guard'a dokunmaz; yalniz butunluk ekseni.
--
-- BACKFILL YOK (bu dosyada)
--   Mevcut satirlarin hepsi picker/manuel kaynakli = citation. DEFAULT
--   'citation' onlari dogru etiketler. Evrak->attachment backfill'i AYRI
--   script, bu migration UYGULANDIKTAN sonra.
--
-- IDEMPOTENCY: 034 deseni.
-- ============================================================
BEGIN;

-- ---------- 1) rfi_references ----------
ALTER TABLE rfi_references
  ADD COLUMN IF NOT EXISTS ref_role TEXT NOT NULL DEFAULT 'citation';

ALTER TABLE rfi_references
  DROP CONSTRAINT IF EXISTS rfi_references_ref_role_check;
ALTER TABLE rfi_references
  ADD CONSTRAINT rfi_references_ref_role_check
  CHECK (ref_role IN ('attachment','citation'));

ALTER TABLE rfi_references
  DROP CONSTRAINT IF EXISTS rfi_references_attachment_needs_doc;
ALTER TABLE rfi_references
  ADD CONSTRAINT rfi_references_attachment_needs_doc
  CHECK (ref_role <> 'attachment' OR document_id IS NOT NULL);

DROP INDEX IF EXISTS uq_rfi_refs_owner_document;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rfi_refs_owner_document
  ON rfi_references(owner_rfi_id, document_id, ref_role)
  WHERE document_id IS NOT NULL;

-- ---------- 2) correspondence_references (SIMETRIK) ----------
ALTER TABLE correspondence_references
  ADD COLUMN IF NOT EXISTS ref_role TEXT NOT NULL DEFAULT 'citation';

ALTER TABLE correspondence_references
  DROP CONSTRAINT IF EXISTS correspondence_references_ref_role_check;
ALTER TABLE correspondence_references
  ADD CONSTRAINT correspondence_references_ref_role_check
  CHECK (ref_role IN ('attachment','citation'));

ALTER TABLE correspondence_references
  DROP CONSTRAINT IF EXISTS correspondence_references_attachment_needs_doc;
ALTER TABLE correspondence_references
  ADD CONSTRAINT correspondence_references_attachment_needs_doc
  CHECK (ref_role <> 'attachment' OR document_id IS NOT NULL);

DROP INDEX IF EXISTS uq_corr_refs_owner_document;
CREATE UNIQUE INDEX IF NOT EXISTS uq_corr_refs_owner_document
  ON correspondence_references(correspondence_id, document_id, ref_role)
  WHERE document_id IS NOT NULL;

COMMIT;

-- ============================================================
-- DOGRULAMA (COMMIT sonrasi AYRI calistir)
-- ============================================================
-- 1) ref_role kolonu iki tabloda da var + default citation
-- SELECT table_name, column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE column_name = 'ref_role'
--   AND table_name IN ('rfi_references','correspondence_references');
--   -- 2 satir; column_default = 'citation'::text; is_nullable = NO
--
-- 2) mevcut satirlarin hepsi citation (attachment henuz yok)
-- SELECT 'rfi' t, ref_role, count(*) FROM rfi_references GROUP BY 2
-- UNION ALL
-- SELECT 'corr', ref_role, count(*) FROM correspondence_references GROUP BY 2;
--   -- yalniz 'citation' satirlari donmeli
--
-- 3) yeni unique index ref_role iceriyor
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE indexname IN ('uq_rfi_refs_owner_document','uq_corr_refs_owner_document');
--   -- indexdef icinde ref_role gorunmeli
