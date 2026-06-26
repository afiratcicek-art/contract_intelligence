-- =============================================
-- ClauseIQ — Migration 015: Chronology event types
-- Applied: 2026-06-26
-- =============================================
-- Extends chronology_events.event_type CHECK
-- to include sector-specific manual entry types.
-- 
-- New types added:
--   inspection  → WIR (Work Inspection Request) / MIR
--   work_permit → Work Permit documents
--   other       → Note & Others (replaces generic 'note')
--
-- Kept: dispute_step — reserved for future
--   Dispute Register auto-trigger (not user-selectable)
-- =============================================

ALTER TABLE chronology_events
    DROP CONSTRAINT IF EXISTS 
        chronology_events_event_type_check;

ALTER TABLE chronology_events
    ADD CONSTRAINT chronology_events_event_type_check
    CHECK (event_type IN (
        'rfi',
        'correspondence',
        'notice',
        'submission',
        'response',
        'meeting',
        'inspection',
        'work_permit',
        'status_change',
        'dispute_step',
        'other'
    ));
