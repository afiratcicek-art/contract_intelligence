export interface ChronologyEvent {
  id: string;
  chronology_id: string;
  event_date: string;
  event_type: string;
  document_ref_id: string | null;
  document_ref_type: string | null;
  is_key_event: boolean;
  is_active: boolean;
  inactivation_reason: string | null;
  auto_narrative: string | null;
  approved_narrative: string | null;
  narrative_approved_by: string | null;
  narrative_approved_at: string | null;
  activity_id: string | null;
  boq_ref: string | null;
  subject: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Chronology {
  id: string;
  project_id: string;
  title: string;
  entity_type: string;
  entity_id: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  events: ChronologyEvent[];
  event_count?: number;
}

// Labels for manual event entry dropdown.
// 'dispute_step' is system-triggered only —
// not listed here but valid in DB.
// Chronology is a sequence of documents, not a notebook.
// 'other' = a document type not listed above
// (permit, method statement, test report...).
// Display order for the manual event-type pickers. Labels are not stored here:
// resolve each with t(`chrono.evt.${type}`) so the list stays translatable.
export const MANUAL_EVENT_TYPES = [
  "rfi",
  "correspondence",
  "notice",
  "submission",
  "response",
  "meeting",
  "inspection",
  "work_permit",
  "other",
] as const;

export type ManualEventType = (typeof MANUAL_EVENT_TYPES)[number];

export const ENTITY_TYPE_LABELS:
  Record<string, string> = {
  change: "Change",
  rfi: "RFI",
  correspondence: "Correspondence",
  general: "General",
};
