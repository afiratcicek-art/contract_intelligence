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
export const MANUAL_EVENT_TYPE_LABELS:
  Record<string, string> = {
  rfi: "RFI",
  correspondence: "Correspondence",
  notice: "Notice",
  submission: "Submission",
  response: "Response",
  meeting: "Meeting / MOM",
  inspection: "Inspection (WIR/MIR)",
  work_permit: "Work Permit",
  status_change: "Status Change",
  other: "Note & Others",
};

export const ENTITY_TYPE_LABELS:
  Record<string, string> = {
  change: "Change",
  rfi: "RFI",
  correspondence: "Correspondence",
  general: "General",
};
