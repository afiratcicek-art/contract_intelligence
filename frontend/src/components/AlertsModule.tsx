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
  fetchReadAlertIds,
} from "../services/api";
import { useToastContext } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { formatDate } from "../utils/format";
import Button from "./Button";

interface AlertsModuleProps {
  projectId: string;
}

const ACCENT      = "var(--color-accent)";      // bg, border, stroke
const ACCENT_TEXT = "var(--color-accent-text)"; // color only — WCAG AA

const PRIORITY_BORDER: Record<string, string> = {
  critical: "var(--color-priority-critical)",
  high:     "var(--color-priority-high)",
  normal:   "var(--color-priority-normal)",
};

const PRIORITY_BADGE: Record<string, { bg: string; color: string }> = {
  critical: {
    bg: "var(--color-background-danger)",
    color: "var(--color-priority-critical)",
  },
  high: {
    bg: "var(--color-background-warning)",
    color: "var(--color-warning)",
  },
  normal: {
    bg: "var(--color-background-tertiary)",
    color: "var(--color-accent-text)",
  },
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
  fontFamily: "var(--font-ui)",
};

type Translate = (key: string) => string;

function isWithin7Days(dateStr: string): boolean {
  const deadline = new Date(dateStr);
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();
  return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
}

// Unmapped backend values degrade to readable text rather than a raw key, so a
// new alert type, status or role stays legible until its key is added.
function formatAlertType(type: string, t: Translate): string {
  const translated = t(`alerts.type.${type}`);
  if (translated !== `alerts.type.${type}`) return translated;
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusLabel(status: string, t: Translate): string {
  const key = status.toLowerCase().replace(/\s+/g, "_");
  const translated = t(`status.${key}`);
  return translated === `status.${key}` ? status : translated;
}

function roleLabel(role: string | null | undefined, t: Translate): string {
  if (!role) return t("alerts.role.user");
  const translated = t(`alerts.role.${role}`);
  return translated === `alerts.role.${role}` ? role : translated;
}

function priorityLabel(priority: string, t: Translate): string {
  const translated = t(`priority.${priority}`);
  return translated === `priority.${priority}` ? priority : translated;
}

function entityLabel(type: string, t: Translate): string {
  const translated = t(`entity.${type}`);
  return translated === `entity.${type}` ? type : translated;
}

function InfoRow({ label, value, status }: { label: string; value: string; status?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}>{label}</span>
      <span
        style={{
          fontSize: 11,
          color: status ? ACCENT_TEXT : "var(--color-text-primary)",
          fontWeight: 500,
          fontFamily: "var(--font-ui)",
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
  const { showToast } = useToastContext();
  const { t, lang } = useLanguage();

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

  // Restore read state from DB on mount
  useEffect(() => {
    fetchReadAlertIds(projectId)
      .then((ids) => setReadAlertIds(new Set(ids)))
      .catch(() => {});
  }, [projectId]);

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
      .catch((err) => showToast(err.message, "error"))
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
        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}>
          {t("alerts.nosourcedocument")}
        </p>
      );
    }

    if (!entity) {
      return (
        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}>
          {t("state.loading")}
        </p>
      );
    }

    return (
      <>
        {entityType === "rfi" && (
          <>
            <InfoRow label={t("alerts.field.type")} value={t("entity.rfi")} />
            <InfoRow label={t("alerts.field.reference")} value={entity.rfi_number ?? "—"} />
            <InfoRow label={t("alerts.field.subject")} value={entity.subject ?? "—"} />
            <InfoRow label={t("alerts.field.status")} value={entity.status ? statusLabel(entity.status, t) : "—"} status />
            <InfoRow label={t("alerts.field.date")} value={formatDate(entity.submitted_date, lang)} />
          </>
        )}
        {entityType === "correspondence" && (
          <>
            <InfoRow label={t("alerts.field.type")} value={t("entity.correspondence")} />
            <InfoRow label={t("alerts.field.reference")} value={entity.corr_number ?? "—"} />
            <InfoRow label={t("alerts.field.subject")} value={entity.subject ?? "—"} />
            <InfoRow label={t("alerts.field.status")} value={entity.status ? statusLabel(entity.status, t) : "—"} status />
            <InfoRow label={t("alerts.field.date")} value={formatDate(entity.correspondence_date, lang)} />
          </>
        )}
        {entityType === "change" && (
          <>
            <InfoRow label={t("alerts.field.type")} value={t("entity.change")} />
            <InfoRow label={t("alerts.field.reference")} value={entity.change_number ?? "—"} />
            <InfoRow label={t("alerts.field.subject")} value={entity.title ?? "—"} />
            <InfoRow label={t("alerts.field.status")} value={entity.status ? statusLabel(entity.status, t) : "—"} status />
            <InfoRow label={t("alerts.field.date")} value={formatDate(entity.created_at, lang)} />
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
              color: ACCENT_TEXT,
              background: "none",
              border: `0.5px solid ${ACCENT}`,
              borderRadius: 0,
              padding: "4px 10px",
              cursor: "pointer",
              marginTop: 10,
              fontFamily: "var(--font-ui)",
            }}
          >
            <i className="ti ti-external-link" style={{ fontSize: 11 }} />
            {t("alerts.openfulldocument")}
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
                padding: "8px 10px",
                cursor: "pointer",
                marginTop: 8,
                marginLeft: 8,
                fontFamily: "var(--font-ui)",
              }}
            >
              <i className="ti ti-file" style={{ fontSize: 13 }} />
              {t("alerts.attachedfiles").replace("{n}", String(documentsCache[alertItem.id].length))}
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
                      fontFamily: "var(--font-ui)",
                    }}
                  >
                    {doc.document_id}
                    {doc.uploaded_at ? ` · ${formatDate(doc.uploaded_at, lang)}` : ""}
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
              borderBottom: statusFilter === tab ? `3px solid ${ACCENT}` : "3px solid transparent",
              padding: "8px 16px",
              fontSize: 12,
              fontFamily: "var(--font-ui)",
              color: statusFilter === tab ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              fontWeight: statusFilter === tab ? 500 : 400,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {statusLabel(tab, t)}
          </button>
        ))}
      </div>

      {loading && (
        <p style={{ textAlign: "center", fontFamily: "var(--font-ui)", color: "var(--color-text-secondary)", fontSize: 13 }}>
          {t("state.loading")}
        </p>
      )}

      {!loading && alerts.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <p style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-title-card)", color: "var(--color-text-primary)", marginBottom: 8 }}>
            {t("alerts.none")}
          </p>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--color-text-secondary)" }}>
            {t("alerts.allclear")}
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
                ? "4px solid var(--color-accent)"
                : `4px solid ${borderColor}`,
              borderTop: "0.5px solid var(--color-border-tertiary)",
              borderRight: "1px solid var(--color-border-medium)",
              borderBottom: "0.5px solid var(--color-border-tertiary)",
              marginBottom: 12,
              borderRadius: 0,
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
              {/* Unread indicator dot — hidden when read */}
              {!readAlertIds.has(alertItem.id) && (
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: borderColor,
                    flexShrink: 0,
                    marginRight: 6,
                    alignSelf: "center",
                  }}
                />
              )}
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--color-text-primary)", fontWeight: 500 }}>
                {formatAlertType(alertItem.alert_type, t)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  textTransform: "uppercase",
                  background: badge.bg,
                  color: badge.color,
                  fontFamily: "var(--font-ui)",
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                  borderRadius: 0,
                  flexShrink: 0,
                  marginRight: 0,
                  position: "relative",
                }}
              >
                {priorityLabel(alertItem.priority, t)}
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
                  fontFamily: "var(--font-ui)",
                }}
              >
                {t("alerts.from")}: {entityLabel(alertItem.source_entity_type, t)}
              </p>
            )}

            {/* Row C */}
            {alertItem.narrative && (
              <p
                style={{
                  fontSize: 13,
                  color: "var(--color-text-primary)",
                  marginTop: 8,
                  fontFamily: "var(--font-ui)",
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
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}>
                {t("alerts.flagged")}: {formatDate(alertItem.flagged_at, lang)}
              </span>
              {alertItem.notice_deadline && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-ui)",
                    color: isWithin7Days(alertItem.notice_deadline) ? "var(--color-danger)" : "var(--color-text-secondary)",
                  }}
                >
                  {t("col.deadline")}: {formatDate(alertItem.notice_deadline, lang)}
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
                color: ACCENT_TEXT,
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: 16,
                paddingRight: 16,
                fontFamily: "var(--font-ui)",
                textAlign: "left",
              }}
            >
              {isExpanded ? "▴" : "▾"} {t("alerts.actionsdetails")}
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
                  <div style={SECTION_LABEL}>{t("alerts.sourcedocument")}</div>
                  {renderEntitySummary(alertItem)}
                </div>

                {/* Right column — actions */}
                <div style={{ padding: "14px 16px", minHeight: 120, overflowY: "visible" }}>
                  <div style={SECTION_LABEL}>{t("alerts.actions")}</div>

                  {actions.length === 0 && (
                    <p style={{ fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}>{t("alerts.noactions")}</p>
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
                        fontFamily: "var(--font-ui)",
                      }}
                    >
                      {action.action_type === "note" && (
                        <>
                          <i
                            className="ti ti-notes"
                            aria-hidden="true"
                            style={{ fontSize: 13, marginRight: 4, color: ACCENT_TEXT, flexShrink: 0 }}
                          />
                          <span>{action.note} — {formatDate(action.created_at, lang)}</span>
                        </>
                      )}
                      {action.action_type === "assignment" && (
                        <>
                          <i
                            className="ti ti-user"
                            aria-hidden="true"
                            style={{ fontSize: 13, marginRight: 4, color: ACCENT_TEXT, flexShrink: 0 }}
                          />
                          <span>
                            {roleLabel(action.assigned_to_role, t)}
                            {action.due_date ? ` · ${t("col.due")} ${formatDate(action.due_date, lang)}` : ""}
                            {" — "}{formatDate(action.created_at, lang)}
                          </span>
                        </>
                      )}
                      {action.action_type !== "note" && action.action_type !== "assignment" && (
                        <span>{action.action_type} — {formatDate(action.created_at, lang)}</span>
                      )}
                    </div>
                  ))}

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setShowAddAction(alertItem.id);
                      setActionType("note");
                      setActionNote("");
                      setActionRole("");
                      setActionDueDate("");
                    }}
                    style={{ marginTop: 8 }}
                  >
                    {t("alerts.addaction")}
                  </Button>

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
                                ? "var(--color-bg-primary)"
                                : "var(--color-text-primary)",
                              border: actionType === type
                                ? "0.5px solid var(--color-accent)"
                                : "0.5px solid var(--color-border-primary)",
                              borderRadius: 0,
                              padding: "8px 14px",
                              fontSize: 12,
                              cursor: "pointer",
                              fontFamily: "var(--font-ui)",
                              textTransform: "capitalize",
                              marginRight: 4,
                            }}
                          >
                            {t(`alerts.tab.${type}`)}
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
                            fontFamily: "var(--font-ui)",
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
                              fontFamily: "var(--font-ui)",
                              borderRadius: 0,
                              boxSizing: "border-box",
                              background: "var(--color-bg-secondary)",
                              color: "var(--color-text-primary)",
                            }}
                          >
                            <option value="">{t("alerts.selectrole")}</option>
                            <option value="cm">{t("alerts.role.cm")}</option>
                            <option value="engineer">{t("alerts.role.engineer")}</option>
                            <option value="dcc">{t("alerts.role.dcc")}</option>
                            <option value="any">{t("alerts.role.any")}</option>
                          </select>
                          <input
                            type="date"
                            value={actionDueDate}
                            onChange={(e) => setActionDueDate(e.target.value)}
                            style={{
                              width: "100%",
                              marginTop: 8,
                              border: "0.5px solid var(--color-border-tertiary)",
                              padding: 6,
                              fontSize: 13,
                              fontFamily: "var(--font-ui)",
                              borderRadius: 0,
                              boxSizing: "border-box",
                              background: "var(--color-bg-secondary)",
                              color: "var(--color-text-primary)",
                            }}
                          />
                        </div>
                      )}

                      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleSubmitAction(alertItem.id)}
                          disabled={submitting}
                          loading={submitting}
                          loadingText={t("state.saving")}
                        >
                          {t("alerts.saveaction")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setShowAddAction(null)}
                        >
                          {t("action.cancel")}
                        </Button>
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
