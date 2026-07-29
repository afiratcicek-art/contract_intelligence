-- Migration 046: audit_log — 'ai_disabled'
-- Author: ClauseIQ
--
-- !! audit_log_action_check icin GUNCEL KAYNAK BU DOSYADIR. !!
-- Kisit her migration'da tam liste ile yeniden tanimlanir.
-- Yeni action eklerken: en son migration'daki listeyi kopyala, ustune ekle,
-- YENI dosya ac. Eski dosyalari DUZENLEME — onlar tarih kaydidir.
--
-- Kaynak liste: 031_audit_missing_actions.sql
-- Eklenen: ai_disabled — C1b provider gate fail-closed (claude_service
--   _block_ai_disabled / _handle_gate_block reason=ai_disabled)

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
        'close',
        'post_processor_correction',
        -- 046 ile eklenen:
        'ai_disabled'
    ));

COMMIT;

-- DOGRULAMA (Ali calistiracak):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'audit_log'::regclass AND conname = 'audit_log_action_check';
-- Beklenen: listede 'ai_disabled' var.
