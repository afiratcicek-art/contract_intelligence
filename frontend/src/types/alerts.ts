export interface AlertItem {
  id: string;
  alert_type: string;
  status: string;
  priority: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  narrative: string | null;
  notice_deadline: string | null;
  flagged_at: string;
  cm_decision: string | null;
  assigned_to_role: string | null;
  assigned_to_user: string | null;
  flagged_by: string;
}

export interface AlertAction {
  id: string;
  alert_id: string;
  action_type: string;
  note: string | null;
  assigned_to_user: string | null;
  assigned_to_role: string | null;
  due_date: string | null;
  created_by: string;
  created_at: string;
}

export interface AlertDocument {
  id: string;
  alert_id: string;
  document_id: string;
  uploaded_by: string;
  uploaded_at: string;
}
