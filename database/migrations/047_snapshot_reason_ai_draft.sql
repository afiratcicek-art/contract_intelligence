-- Migration 047: document_draft_versions — snapshot_reason AI-draft moments
-- Author: ClauseIQ
--
-- !! document_draft_versions_snapshot_reason_check icin GUNCEL KAYNAK BU DOSYADIR. !!
-- Kisit her migration'da tam liste ile yeniden tanimlanir.
-- Yeni reason eklerken: en son migration'daki listeyi kopyala, ustune ekle,
-- YENI dosya ac. Eski dosyalari DUZENLEME — onlar tarih kaydidir.
--
-- Kaynak liste: 044_document_authoring.sql
-- Eklenen (C2-A editor↔AI wire):
--   pre_ai_draft   — body before LLM replace (undo / audit)
--   post_ai_draft  — body after successful LLM write

BEGIN;

ALTER TABLE document_draft_versions
    DROP CONSTRAINT IF EXISTS document_draft_versions_snapshot_reason_check;

ALTER TABLE document_draft_versions
    ADD CONSTRAINT document_draft_versions_snapshot_reason_check CHECK (snapshot_reason IN (
        'manual',
        'pre_generation',
        'post_generation',
        'approval',
        -- 047 ile eklenenler:
        'pre_ai_draft',
        'post_ai_draft'
    ));

COMMIT;

-- DOGRULAMA (Ali calistiracak):
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'document_draft_versions'::regclass
--     AND conname = 'document_draft_versions_snapshot_reason_check';
-- Beklenen: listede 'pre_ai_draft' ve 'post_ai_draft' var.
