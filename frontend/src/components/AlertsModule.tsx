import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { AlertItem, AlertAction } from "../types/alerts";
import {
  fetchAlerts,
  fetchAlertActions,
  createAlertAction,
} from "../services/api";

interface AlertsModuleProps {
  projectId: string;
}

const BG = "#F5F2ED";
const TEXT_PRIMARY = "#1F2228";
const ACCENT = "#A0714A";
const WARM = "#6B5D3F";
const BORDER = "#E8E4DE";

const PRIORITY_BORDER: Record<string, string> = {
  critical: "#C0392B",
  high: "#E07060",
  normal: "#A0714A",
};

const PRIORITY_BADGE: Record<string, { bg: string; color: string }> = {
  critical: { bg: "#FDECEA", color: "#C0392B" },
  high: { bg: "#FEF3C7", color: "#92400E" },
  normal: { bg: "#F5F2ED", color: "#6B5D3F" },
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  potential_impact: "Potential Impact",
  wp_message: "WP Message",
  ew_deadline: "EW Deadline",
};

const STATUS_TABS = ["pending", "actioned", "snoozed", "dismissed"] as const;
type StatusFilter = (typeof STATUS_TABS)[number];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function isWithin7Days(dateStr: string): boolean {
  const deadline = new Date(dateStr);
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();
  return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
}

function formatAlertType(type: string): string {
  return ALERT_TYPE_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AlertsModule({ projectId }: AlertsModuleProps) {
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const [actionsCache, setActionsCache] = useState<Record<string, AlertAction[]>>({});
  const [showAddAction, setShowAddAction] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"note" | "assignment">("note");
  const [actionNote, setActionNote] = useState("");
  const [actionRole, setActionRole] = useState("");
  const [actionDueDate, setActionDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchAlerts(projectId, statusFilter)
      .then(setAlerts)
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false));
  }, [projectId, statusFilter]);

  const handleExpand = (alertId: string) => {
    if (expandedAlertId === alertId) {
      setExpandedAlertId(null);
      return;
    }
    setExpandedAlertId(alertId);
    if (actionsCache[alertId]) return;
    fetchAlertActions(projectId, alertId)
      .then((actions) => setActionsCache((prev) => ({ ...prev, [alertId]: actions })))
      .catch(() => setActionsCache((prev) => ({ ...prev, [alertId]: [] })));
  };

  const handleSubmitAction = (alertId: string) => {
    const body: {
      action_type: string;
      note?: string;
      assigned_to_role?: string;
      due_date?: string;
    } = { action_type: actionType };
    if (actionType === "note") body.note = actionNote;
    if (actionType === "assignment") {
      body.assigned_to_role = actionRole;
      if (actionDueDate) body.due_date = actionDueDate;
    }
    setSubmitting(true);
    createAlertAction(projectId, alertId, body)
      .then((newAction) => {
        setActionsCache((prev) => ({
          ...prev,
          [alertId]: [...(prev[alertId] || []), newAction],
        }));
        setShowAddAction(null);
        setActionNote("");
        setActionRole("");
        setActionDueDate("");
      })
      .catch((err) => alert(err.message))
      .finally(() => setSubmitting(false));
  };

  const navigateToEntity = (type: string, id: string) => {
    if (type === "rfi") navigate(`/projects/${projectId}/rfis/${id}`);
    else if (type === "correspondence") navigate(`/projects/${projectId}/correspondence/${id}`);
    else if (type === "change") navigate(`/projects/${projectId}/changes/${id}`);
  };

  const priorityKey = (p: string) => {
    if (p === "critical" || p === "high") return p;
    return "normal";
  };

  return (
    <div>
      {/* Status filter tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: `1px solid ${BORDER}` }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            style={{
              background: "none",
              border: "none",
              borderRadius: 0,
              borderBottom: statusFilter === tab ? `2px solid ${ACCENT}` : "2px solid transparent",
              padding: "8px 16px",
              fontSize: 12,
              fontFamily: "Inter, sans-serif",
              color: statusFilter === tab ? TEXT_PRIMARY : WARM,
              fontWeight: statusFilter === tab ? 600 : 400,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading && (
        <p style={{ textAlign: "center", fontFamily: "Inter, sans-serif", color: WARM, fontSize: 13 }}>
          Loading alerts...
        </p>
      )}

      {!loading && alerts.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <p style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 16, color: TEXT_PRIMARY, marginBottom: 8 }}>
            No {statusFilter} alerts.
          </p>
          <p style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: WARM }}>
            All clear for now.
          </p>
        </div>
      )}

      {!loading && alerts.map((alertItem) => {
        const pKey = priorityKey(alertItem.priority);
        const borderColor = PRIORITY_BORDER[pKey];
        const badge = PRIORITY_BADGE[pKey];
        const actions = actionsCache[alertItem.id] ?? [];
        const isExpanded = expandedAlertId === alertItem.id;

        return (
          <div
            key={alertItem.id}
            style={{
              background: "#FFFFFF",
              borderLeft: `4px solid ${borderColor}`,
              borderTop: `1px solid ${BORDER}`,
              borderRight: `1px solid ${BORDER}`,
              borderBottom: `1px solid ${BORDER}`,
              padding: 16,
              marginBottom: 12,
              borderRadius: 0,
            }}
          >
            {/* Row A */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 14, color: TEXT_PRIMARY, fontWeight: 600 }}>
                {formatAlertType(alertItem.alert_type)}
              </span>
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  textTransform: "uppercase",
                  background: badge.bg,
                  color: badge.color,
                  fontFamily: "Inter, sans-serif",
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  borderRadius: 0,
                }}
              >
                {alertItem.priority}
              </span>
            </div>

            {/* Row B */}
            {alertItem.source_entity_type && (
              <p
                onClick={() => alertItem.source_entity_id && navigateToEntity(alertItem.source_entity_type!, alertItem.source_entity_id)}
                style={{
                  fontSize: 12,
                  color: WARM,
                  marginTop: 8,
                  cursor: alertItem.source_entity_id ? "pointer" : "default",
                  fontFamily: "Inter, sans-serif",
                }}
              >
                From: {alertItem.source_entity_type.toUpperCase()} →
              </p>
            )}

            {/* Row C */}
            {alertItem.narrative && (
              <p
                style={{
                  fontSize: 13,
                  color: TEXT_PRIMARY,
                  marginTop: 8,
                  fontFamily: "Inter, sans-serif",
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {alertItem.narrative}
              </p>
            )}

            {/* Row D */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ fontSize: 11, color: WARM, fontFamily: "Inter, sans-serif" }}>
                Flagged: {formatDate(alertItem.flagged_at)}
              </span>
              {alertItem.notice_deadline && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "Inter, sans-serif",
                    color: isWithin7Days(alertItem.notice_deadline) ? "#C0392B" : WARM,
                  }}
                >
                  Deadline: {formatDate(alertItem.notice_deadline)}
                </span>
              )}
            </div>

            {/* Row E */}
            <button
              onClick={() => handleExpand(alertItem.id)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: ACCENT,
                marginTop: 8,
                padding: 0,
                fontFamily: "Inter, sans-serif",
              }}
            >
              {isExpanded ? "▴ Actions" : "▾ Actions"}
            </button>

            {/* Actions panel */}
            {isExpanded && (
              <div style={{ background: BG, padding: 12, marginTop: 8, borderTop: `1px solid ${BORDER}` }}>
                {actions.length === 0 && (
                  <p style={{ fontSize: 12, color: WARM, fontFamily: "Inter, sans-serif" }}>No actions yet.</p>
                )}
                {actions.map((action) => (
                  <div key={action.id} style={{ fontSize: 12, color: TEXT_PRIMARY, marginBottom: 6, fontFamily: "Inter, sans-serif" }}>
                    {action.action_type === "note" && (
                      <span>📝 {action.note} — {formatDate(action.created_at)}</span>
                    )}
                    {action.action_type === "assignment" && (
                      <span>
                        👤 {action.assigned_to_role ?? "User"}
                        {action.due_date ? ` · due ${formatDate(action.due_date)}` : ""}
                        {" — "}{formatDate(action.created_at)}
                      </span>
                    )}
                    {action.action_type !== "note" && action.action_type !== "assignment" && (
                      <span>{action.action_type} — {formatDate(action.created_at)}</span>
                    )}
                  </div>
                ))}

                <button
                  onClick={() => {
                    setShowAddAction(alertItem.id);
                    setActionType("note");
                    setActionNote("");
                    setActionRole("");
                    setActionDueDate("");
                  }}
                  style={{
                    marginTop: 8,
                    background: ACCENT,
                    color: "#FFFFFF",
                    padding: "6px 12px",
                    border: "none",
                    borderRadius: 0,
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  Add Action
                </button>

                {/* Add Action form */}
                {showAddAction === alertItem.id && (
                  <div style={{ background: "#FFFFFF", padding: 12, marginTop: 8, border: `1px solid ${BORDER}`, borderRadius: 0 }}>
                    <div style={{ display: "flex", gap: 0, marginBottom: 12 }}>
                      {(["note", "assignment"] as const).map((type) => (
                        <button
                          key={type}
                          onClick={() => setActionType(type)}
                          style={{
                            background: actionType === type ? TEXT_PRIMARY : BG,
                            color: actionType === type ? "#FFFFFF" : WARM,
                            border: "none",
                            borderRadius: 0,
                            padding: "4px 10px",
                            fontSize: 12,
                            cursor: "pointer",
                            fontFamily: "Inter, sans-serif",
                            textTransform: "capitalize",
                          }}
                        >
                          {type}
                        </button>
                      ))}
                    </div>

                    {actionType === "note" && (
                      <textarea
                        value={actionNote}
                        onChange={(e) => setActionNote(e.target.value)}
                        style={{
                          width: "100%",
                          minHeight: 60,
                          border: `1px solid ${BORDER}`,
                          padding: 8,
                          fontSize: 13,
                          fontFamily: "Inter, sans-serif",
                          borderRadius: 0,
                          resize: "vertical",
                          boxSizing: "border-box",
                        }}
                      />
                    )}

                    {actionType === "assignment" && (
                      <div>
                        <select
                          value={actionRole}
                          onChange={(e) => setActionRole(e.target.value)}
                          style={{
                            border: `1px solid ${BORDER}`,
                            padding: 6,
                            fontSize: 13,
                            width: "100%",
                            fontFamily: "Inter, sans-serif",
                            borderRadius: 0,
                            boxSizing: "border-box",
                          }}
                        >
                          <option value="">Select role...</option>
                          <option value="cm">cm</option>
                          <option value="engineer">engineer</option>
                          <option value="dcc">dcc</option>
                          <option value="any">any</option>
                        </select>
                        <input
                          type="date"
                          value={actionDueDate}
                          onChange={(e) => setActionDueDate(e.target.value)}
                          style={{
                            width: "100%",
                            marginTop: 6,
                            border: `1px solid ${BORDER}`,
                            padding: 6,
                            fontSize: 13,
                            fontFamily: "Inter, sans-serif",
                            borderRadius: 0,
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    )}

                    <div style={{ marginTop: 12 }}>
                      <button
                        onClick={() => handleSubmitAction(alertItem.id)}
                        disabled={submitting}
                        style={{
                          background: TEXT_PRIMARY,
                          color: "#FFFFFF",
                          padding: "6px 14px",
                          border: "none",
                          borderRadius: 0,
                          fontSize: 12,
                          cursor: submitting ? "not-allowed" : "pointer",
                          fontFamily: "Inter, sans-serif",
                          opacity: submitting ? 0.6 : 1,
                        }}
                      >
                        Save Action
                      </button>
                      <button
                        onClick={() => setShowAddAction(null)}
                        style={{
                          background: "none",
                          color: WARM,
                          border: "none",
                          fontSize: 12,
                          cursor: "pointer",
                          marginLeft: 8,
                          fontFamily: "Inter, sans-serif",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
