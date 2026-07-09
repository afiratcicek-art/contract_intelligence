-- Migration 031: audit_log — 'close' ve 'post_processor_correction'
-- Author: ClauseIQ
-- Applied: 2026-07-09
--
-- !! audit_log_action_check icin GUNCEL KAYNAK BU DOSYADIR. !!
-- Kisit her migration'da tam liste ile yeniden tanimlanir (001, 005, 006,
-- 008, 011, 013, 014, 017, 018 ve bu dosya). Yeni action eklerken:
-- en son migration'daki listeyi kopyala, ustune ekle, YENI dosya ac.
-- Eski dosyalari DUZENLEME — onlar tarih kaydidir.
--
-- SORUN: Bu iki action CHECK listesinde yoktu; AuditService.log() insert
-- hatasini yutuyordu (sadece logger.error). Iki islem denetim kaydina
-- HIC yazilmiyordu. Forensic append-only invaryantinin ihlali.
--
-- Eklenenler:
--   close                      -> RFI kapatma bir sozlesmesel olaydir (kim/ne zaman)
--   post_processor_correction  -> LLM ciktisina yapilan otomatik mudahale;
--                                 "hicbir LLM ciktisi denetimsiz islenmez"
--                                 invaryantinin kaydi
--
-- KAPSAM DISI (bilincli karar, Ali 2026-07-09): alert_actioned,
-- alert_document_linked, alert_read. Alert olaylari denetim kapsaminda
-- degildir; ilgili audit.log cagrilari koddan KALDIRILDI (ayni commit).
--
-- ACIK BORC: AuditService.log() hala sessizce yutuyor. Ayri degisiklikle
-- ele alinacak (once liste, sonra yutma — ters sirada endpoint'ler 500 verir).

BEGIN;

ALTER TABLE audit_log
    DROP CONSTRAINT IF EXISTS audit_log_action_check;

ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_action_check CHECK (action IN (
        'create', 'update', 'delete', 'view',
        'approve', 'reject', 'submit', 'assign',
        'publish', 'export', 'import',
        'login', 'logout', 'permission_change',
        'llm_call',
        'pdf_upload', 'pdf_parse_start',
        'pdf_parse_complete', 'pdf_parse_failed', 'pdf_delete',
        'alert_created', 'alert_action_created',
        'metadata_extraction_start',
        'metadata_extraction_complete',
        'metadata_extraction_failed',
        'metadata_approved',
        'modify', 'inactivate',
        'embedding_created',
        'relation_detected',
        'relation_confirmed',
        'relation_rejected',
        -- 031 ile eklenenler:
        'close',
        'post_processor_correction'
    ));

COMMIT;

-- DOGRULAMA (Ali calistiracak):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'audit_log'::regclass AND conname = 'audit_log_action_check';
-- Beklenen: listede 'close' ve 'post_processor_correction' var,
--           alert_actioned / alert_document_linked / alert_read YOK.
