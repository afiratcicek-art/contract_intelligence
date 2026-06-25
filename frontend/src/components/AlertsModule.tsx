import { useState, useEffect, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { AlertItem, AlertAction, AlertDocument } from "../types/alerts";
import {
  api,
  fetchAlerts,
  fetchAlertActions,
  createAlertAction,
  fetchAlertDocuments,
  markAlertAsRead,
} from "../services/api";

interface AlertsModuleProps {
  projectId: string;
}

const ACCENT = "#A0714A";

const PRIORITY_BORDER: Record<string, string> = {
  critical: "#C0392B",
  high: "#E07060",
  normal: "#A0714A",
};

const PRIORITY_BADGE: Record<string, { bg: string; color: string }> = {
  critical: {
    bg: "var(--color-background-danger)",
    color: "#C0392B",
  },
  high: {
    bg: "var(--color-background-warning)",
    color: "#92400E",
  },
  normal: {
    bg: "var(--color-background-tertiary)",
    color: "#6B5D3F",
  },
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  potential_impact: "Potential Impact",
  wp_message: "WP Message",
  ew_deadline: "EW Deadline",
};

const STATUS_TABS = ["pending", "actioned", "snoozed", "dismissed"] as const;
type StatusFilter = (typeof STATUS_TABS)[number];

const SECTION_LABEL: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-secondary)",
  fontWeight: 500,
  marginBottom: 10,
  fontFamily: "Inter, sans-serif",
};

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

function InfoRow({ label, value, status }: { label: string; value: string; status?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}>{label}</span>
      <span
        style={{
          fontSize: 11,
          color: status ? ACCENT : "var(--color-text-primary)",
          fontWeight: 500,
          fontFamily: "Inter, sans-serif",
          textAlign: "left",
          maxWidth: "60%",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default function AlertsModule({ projectId }: AlertsModuleProps) {
  const navigate = useNavigate();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const [actionsCache, setActionsCache] = useState<Record<string, AlertAction[]>>({});
  const [entityCache, setEntityCache] = useState<Record<string, any>>({});
  const [documentsCache, setDocumentsCache] = useState<Record<string, AlertDocument[]>>({});
  const [documentsExpanded, setDocumentsExpanded] = useState<Record<string, boolean>>({});
  const [readAlertIds, setReadAlertIds] =
    useState<Set<string>>(new Set());
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

  useEffect(() => {
    if (showAddAction) {
      setActionType("note");
      setActionNote("");
      setActionRole("");
      setActionDueDate("");
    }
  }, [showAddAction]);

  const handleExpand = (alertItem: AlertItem) => {
    const alertId = alertItem.id;
    if (expandedAlertId === alertId) {
      setExpandedAlertId(null);
      return;
    }
    setExpandedAlertId(alertId);

    // Mark alert as read — silent fail if network error
    if (!readAlertIds.has(alertId)) {
      markAlertAsRead(projectId, alertId)
        .then(() =>
          setReadAlertIds((prev) => {
            const next = new Set(prev);
            next.add(alertId);
            return next;
          })
        )
        .catch(() => {});
    }

    if (!actionsCache[alertId]) {
      fetchAlertActions(projectId, alertId)
        .then((actions) => setActionsCache((prev) => ({ ...prev, [alertId]: actions })))
        .catch(() => setActionsCache((prev) => ({ ...prev, [alertId]: [] })));
    }

    if (!documentsCache[alertId]) {
      fetchAlertDocuments(projectId, alertId)
        .then((docs) => setDocumentsCache((prev) => ({ ...prev, [alertId]: docs })))
        .catch(() => setDocumentsCache((prev) => ({ ...prev, [alertId]: [] })));
    }

    if (alertItem.source_entity_type && alertItem.source_entity_id && !entityCache[alertId]) {
      const { source_entity_type, source_entity_id } = alertItem;
      let url = "";
      if (source_entity_type === "rfi") {
        url = `/projects/${projectId}/rfis/${source_entity_id}`;
      } else if (source_entity_type === "correspondence") {
        url = `/projects/${projectId}/correspondences/${source_entity_id}`;
      } else if (source_entity_type === "change") {
        url = `/projects/${projectId}/changes/${source_entity_id}`;
      }
      if (url) {
        api.get(url)
          .then((data) => setEntityCache((prev) => ({ ...prev, [alertId]: data })))
          .catch(() => {});
      }
    }
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
      .catch((err) => window.alert(err.message))
      .finally(() => setSubmitting(false));
  };

  const navigateToEntity = (type: string, id: string) => {
    if (type === "rfi")
      navigate(`/projects/${projectId}/workspace/rfis/${id}`);
    else if (type === "correspondence")
      navigate(`/projects/${projectId}/workspace/correspondence/${id}`);
    else if (type === "change")
      navigate(`/projects/${projectId}/workspace/changes/${id}`);
  };

  const priorityKey = (p: string) => {
    if (p === "critical" || p === "high") return p;
    return "normal";
  };

  const renderEntitySummary = (alertItem: AlertItem) => {
    const entity = entityCache[alertItem.id];
    const entityType = alertItem.source_entity_type;

    if (!entityType) {
      return (
        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}>
          No source document.
        </p>
      );
    }

    if (!entity) {
      return (
        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}>
          Loading...
        </p>
      );
    }

    return (
      <>
        {entityType === "rfi" && (
          <>
            <InfoRow label="Type" value="RFI" />
            <InfoRow label="Reference" value={entity.rfi_number ?? "—"} />
            <InfoRow label="Subject" value={entity.subject ?? "—"} />
            <InfoRow label="Status" value={entity.status ?? "—"} status />
            <InfoRow label="Date" value={entity.submitted_date ? formatDate(entity.submitted_date) : "—"} />
          </>
        )}
        {entityType === "correspondence" && (
          <>
            <InfoRow label="Type" value="Correspondence" />
            <InfoRow label="Reference" value={entity.corr_number ?? "—"} />
            <InfoRow label="Subject" value={entity.subject ?? "—"} />
            <InfoRow label="Status" value={entity.status ?? "—"} status />
            <InfoRow label="Date" value={entity.correspondence_date ? formatDate(entity.correspondence_date) : "—"} />
          </>
        )}
        {entityType === "change" && (
          <>
            <InfoRow label="Type" value="Change" />
            <InfoRow label="Reference" value={entity.change_number ?? "—"} />
            <InfoRow label="Subject" value={entity.title ?? "—"} />
            <InfoRow label="Status" value={entity.status ?? "—"} status />
            <InfoRow label="Date" value={entity.created_at ? formatDate(entity.created_at) : "—"} />
          </>
        )}

        {alertItem.source_entity_id && (
          <button
            type="button"
            onClick={() => navigateToEntity(entityType, alertItem.source_entity_id!)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: ACCENT,
              background: "none",
              border: `0.5px solid ${ACCENT}`,
              borderRadius: 0,
              padding: "4px 10px",
              cursor: "pointer",
              marginTop: 10,
              fontFamily: "Inter, sans-serif",
            }}
          >
            <i className="ti ti-external-link" style={{ fontSize: 11 }} />
            Open full document
          </button>
        )}

        {(documentsCache[alertItem.id]?.length ?? 0) > 0 && (
          <>
            <button
              type="button"
              onClick={() =>
                setDocumentsExpanded((prev) => ({
                  ...prev,
                  [alertItem.id]: !prev[alertItem.id],
                }))
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "var(--color-text-primary)",
                background: "var(--color-background-secondary)",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: 0,
                padding: "5px 10px",
                cursor: "pointer",
                marginTop: 8,
                marginLeft: 6,
                fontFamily: "Inter, sans-serif",
              }}
            >
              <i className="ti ti-file" style={{ fontSize: 13 }} />
              {documentsCache[alertItem.id].length} attached file(s)
            </button>
            {documentsExpanded[alertItem.id] && (
              <div style={{ marginTop: 8 }}>
                {documentsCache[alertItem.id].map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-secondary)",
                      marginBottom: 4,
                      fontFamily: "Inter, sans-serif",
                    }}
                  >
                    {doc.document_id}
                    {doc.uploaded_at ? ` · ${formatDate(doc.uploaded_at)}` : ""}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </>
    );
  };

  return (
    <div>
      {/* Status filter tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid var(--color-border-tertiary)" }}>
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
              color: statusFilter === tab ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              fontWeight: statusFilter === tab ? 500 : 400,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading && (
        <p style={{ textAlign: "center", fontFamily: "Inter, sans-serif", color: "var(--color-text-secondary)", fontSize: 13 }}>
          Loading alerts...
        </p>
      )}

      {!loading && alerts.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <p style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 16, color: "var(--color-text-primary)", marginBottom: 8 }}>
            No {statusFilter} alerts.
          </p>
          <p style={{ fontFamily: "Inter, sans-serif", fontSize: 12, color: "var(--color-text-secondary)" }}>
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
              background: "var(--color-background-secondary)",
              borderLeft: readAlertIds.has(alertItem.id)
                ? "4px solid var(--color-border-medium)"
                : `4px solid ${borderColor}`,
              borderTop: "0.5px solid var(--color-border-tertiary)",
              borderRight: "1px solid var(--color-border-medium)",
              borderBottom: "0.5px solid var(--color-border-tertiary)",
              marginBottom: 12,
              borderRadius: 0,
              opacity: readAlertIds.has(alertItem.id) ? 0.75 : 1,
              transition: "opacity 0.3s ease, border-left-color 0.3s ease",
            }}
          >
            {/* Row A — full width with padding */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: "12px 12px 0 12px",
              }}
            >
              <span style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 14, color: "var(--color-text-primary)", fontWeight: 500 }}>
                {formatAlertType(alertItem.alert_type)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  textTransform: "uppercase",
                  background: badge.bg,
                  color: badge.color,
                  fontFamily: "Inter, sans-serif",
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                  borderRadius: 0,
                  flexShrink: 0,
                  marginRight: 0,
                  position: "relative",
                }}
              >
                {alertItem.priority}
              </span>
            </div>

            {/* Rows B-D — inner wrapper */}
            <div style={{ paddingTop: 8, paddingLeft: 16, paddingRight: 16, paddingBottom: 0 }}>
            {/* Row B */}
            {alertItem.source_entity_type && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  marginTop: 8,
                  fontFamily: "Inter, sans-serif",
                }}
              >
                From: {alertItem.source_entity_type.toUpperCase()}
              </p>
            )}

            {/* Row C */}
            {alertItem.narrative && (
              <p
                style={{
                  fontSize: 13,
                  color: "var(--color-text-primary)",
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
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}>
                Flagged: {formatDate(alertItem.flagged_at)}
              </span>
              {alertItem.notice_deadline && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "Inter, sans-serif",
                    color: isWithin7Days(alertItem.notice_deadline) ? "var(--color-danger)" : "var(--color-text-secondary)",
                  }}
                >
                  Deadline: {formatDate(alertItem.notice_deadline)}
                </span>
              )}
            </div>
            </div>

            {/* Row E */}
            <button
              onClick={() => handleExpand(alertItem)}
              style={{
                display: "block",
                width: "100%",
                background: "none",
                borderTop: "0.5px solid var(--color-border-tertiary)",
                borderLeft: "none",
                borderRight: "none",
                borderBottom: "none",
                cursor: "pointer",
                fontSize: 12,
                color: ACCENT,
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: 16,
                paddingRight: 16,
                fontFamily: "Inter, sans-serif",
                textAlign: "left",
              }}
            >
              {isExpanded ? "▴ Actions & Details" : "▾ Actions & Details"}
            </button>

            {/* Actions & Details panel */}
            {isExpanded && (
              <div
                style={{
                  background: "var(--color-background-tertiary)",
                  border: "0.5px solid var(--color-border-medium)",
                  borderTop: "none",
                  marginLeft: 0,
                  marginRight: 0,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  alignItems: "start",
                  overflowY: "visible",
                  marginTop: 0,
                  boxShadow: "inset 0 1px 0 var(--color-border-medium)",
                }}
              >
                {/* Left column — source document */}
                <div
                  style={{
                    padding: "14px 16px",
                    borderRight: "0.5px solid var(--color-border-tertiary)",
                    minHeight: 120,
                  }}
                >
                  <div style={SECTION_LABEL}>SOURCE DOCUMENT</div>
                  {renderEntitySummary(alertItem)}
                </div>

                {/* Right column — actions */}
                <div style={{ padding: "14px 16px", minHeight: 120, overflowY: "visible" }}>
                  <div style={SECTION_LABEL}>ACTIONS</div>

                  {actions.length === 0 && (
                    <p style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}>No actions yet.</p>
                  )}
                  {actions.map((action) => (
                    <div
                      key={action.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 6,
                        fontSize: 12,
                        color: "var(--color-text-primary)",
                        marginBottom: 0,
                        paddingBottom: 8,
                        paddingTop: 8,
                        borderBottom: "0.5px solid var(--color-border-light)",
                        fontFamily: "Inter, sans-serif",
                      }}
                    >
                      {action.action_type === "note" && (
                        <>
                          <i
                            className="ti ti-notes"
                            aria-hidden="true"
                            style={{ fontSize: 13, marginRight: 4, color: ACCENT, flexShrink: 0 }}
                          />
                          <span>{action.note} — {formatDate(action.created_at)}</span>
                        </>
                      )}
                      {action.action_type === "assignment" && (
                        <>
                          <i
                            className="ti ti-user"
                            aria-hidden="true"
                            style={{ fontSize: 13, marginRight: 4, color: ACCENT, flexShrink: 0 }}
                          />
                          <span>
                            {action.assigned_to_role ?? "User"}
                            {action.due_date ? ` · due ${formatDate(action.due_date)}` : ""}
                            {" — "}{formatDate(action.created_at)}
                          </span>
                        </>
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
                    <div style={{ background: "var(--color-bg-secondary)", padding: 12, marginTop: 8, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 0 }}>
                      <div style={{ display: "flex", gap: 0, marginBottom: 12 }}>
                        {(["note", "assignment"] as const).map((type) => (
                          <button
                            key={type}
                            onClick={() => setActionType(type)}
                            style={{
                              background: actionType === type
                                ? "var(--color-accent)"
                                : "var(--color-bg-secondary)",
                              color: actionType === type
                                ? "#FFFFFF"
                                : "var(--color-text-primary)",
                              border: actionType === type
                                ? "0.5px solid var(--color-accent)"
                                : "0.5px solid var(--color-border-primary)",
                              borderRadius: 0,
                              padding: "5px 14px",
                              fontSize: 12,
                              cursor: "pointer",
                              fontFamily: "Inter, sans-serif",
                              textTransform: "capitalize",
                              marginRight: 4,
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
                            border: "0.5px solid var(--color-border-secondary)",
                            padding: 8,
                            fontSize: 13,
                            fontFamily: "Inter, sans-serif",
                            borderRadius: 0,
                            resize: "vertical",
                            boxSizing: "border-box",
                            background: "var(--color-bg-secondary)",
                          }}
                        />
                      )}

                      {actionType === "assignment" && (
                        <div>
                          <select
                            value={actionRole}
                            onChange={(e) => setActionRole(e.target.value)}
                            style={{
                              border: "0.5px solid var(--color-border-tertiary)",
                              padding: 6,
                              fontSize: 13,
                              width: "100%",
                              fontFamily: "Inter, sans-serif",
                              borderRadius: 0,
                              boxSizing: "border-box",
                              background: "var(--color-bg-secondary)",
                              color: "var(--color-text-primary)",
                            }}
                          >
                            <option value="">Select role...</option>
                            <option value="cm">CM</option>
                            <option value="engineer">Engineer</option>
                            <option value="dcc">DCC</option>
                            <option value="any">Any</option>
                          </select>
                          <input
                            type="date"
                            value={actionDueDate}
                            onChange={(e) => setActionDueDate(e.target.value)}
                            style={{
                              width: "100%",
                              marginTop: 6,
                              border: "0.5px solid var(--color-border-tertiary)",
                              padding: 6,
                              fontSize: 13,
                              fontFamily: "Inter, sans-serif",
                              borderRadius: 0,
                              boxSizing: "border-box",
                              background: "var(--color-bg-secondary)",
                              color: "var(--color-text-primary)",
                            }}
                          />
                        </div>
                      )}

                      <div style={{ marginTop: 12 }}>
                        <button
                          onClick={() => handleSubmitAction(alertItem.id)}
                          disabled={submitting}
                          style={{
                            background: ACCENT,
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
                            color: "var(--color-text-secondary)",
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
