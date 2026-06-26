import { useState, useEffect, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { Chronology, ChronologyEvent } from "../types/chronology";
import { MANUAL_EVENT_TYPE_LABELS } from "../types/chronology";
import {
  fetchChronologies,
  fetchChronology,
  createChronology,
  addChronologyEvent,
  approveNarrative,
} from "../services/api";

interface ChronologiesModuleProps {
  projectId: string;
}

const ACCENT = "#A0714A";

// Section label style — reused across panels
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
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ChronologiesModule(
  { projectId }: ChronologiesModuleProps
) {
  const navigate = useNavigate();

  // Chronology list state
  const [chronologies, setChronologies] =
    useState<Chronology[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] =
    useState<string | null>(null);
  const [selected, setSelected] =
    useState<Chronology | null>(null);
  const [loadingDetail, setLoadingDetail] =
    useState(false);

  // New chronology form state
  const [showNewForm, setShowNewForm] =
    useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newEntityType, setNewEntityType] =
    useState("general");
  const [submittingNew, setSubmittingNew] =
    useState(false);

  // Add event form state
  const [showAddEvent, setShowAddEvent] =
    useState(false);
  const [eventDate, setEventDate] = useState("");
  const [eventType, setEventType] =
    useState("other");
  const [eventIsKey, setEventIsKey] =
    useState(false);
  const [submittingEvent, setSubmittingEvent] =
    useState(false);

  // Narrative editing — maps event_id → edited text
  const [editingNarrative, setEditingNarrative] =
    useState<Record<string, string>>({});
  const [approvingId, setApprovingId] =
    useState<string | null>(null);

  // Load chronology list on mount
  useEffect(() => {
    fetchChronologies(projectId)
      .then(setChronologies)
      .catch(() => setChronologies([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Load selected chronology detail
  useEffect(() => {
    if (!selectedId) return;
    setLoadingDetail(true);
    fetchChronology(projectId, selectedId)
      .then(setSelected)
      .catch(() => setSelected(null))
      .finally(() => setLoadingDetail(false));
  }, [projectId, selectedId]);

  // Auto-select first chronology on load
  useEffect(() => {
    if (chronologies.length > 0 && !selectedId) {
      setSelectedId(chronologies[0].id);
    }
  }, [chronologies, selectedId]);

  const handleCreateChronology = () => {
    if (!newTitle.trim()) return;
    setSubmittingNew(true);
    createChronology(projectId, {
      title: newTitle.trim(),
      entity_type: newEntityType,
    })
      .then((created) => {
        setChronologies((prev) => [created, ...prev]);
        setSelectedId(created.id);
        setShowNewForm(false);
        setNewTitle("");
        setNewEntityType("general");
      })
      .catch((err) => window.alert(err.message))
      .finally(() => setSubmittingNew(false));
  };

  const handleAddEvent = () => {
    if (!selectedId || !eventDate) return;
    setSubmittingEvent(true);
    addChronologyEvent(projectId, selectedId, {
      event_date: eventDate,
      event_type: eventType,
      is_key_event: eventIsKey,
    })
      .then(() => {
        // Refresh detail to include new event
        fetchChronology(projectId, selectedId)
          .then(setSelected)
          .catch(() => {});
        setShowAddEvent(false);
        setEventDate("");
        setEventType("other");
        setEventIsKey(false);
      })
      .catch((err) => window.alert(err.message))
      .finally(() => setSubmittingEvent(false));
  };

  const handleApprove = (event: ChronologyEvent) => {
    if (!selectedId) return;
    const narrative =
      editingNarrative[event.id] ??
      event.auto_narrative ??
      "";
    if (!narrative.trim()) return;
    setApprovingId(event.id);
    approveNarrative(
      projectId,
      selectedId,
      event.id,
      narrative,
    )
      .then(() => {
        fetchChronology(projectId, selectedId)
          .then(setSelected)
          .catch(() => {});
        // Clear edited narrative after approval
        setEditingNarrative((prev) => {
          const next = { ...prev };
          delete next[event.id];
          return next;
        });
      })
      .catch((err) => window.alert(err.message))
      .finally(() => setApprovingId(null));
  };

  // Navigate to source document in workspace
  const navigateToDoc = (
    refType: string,
    refId: string,
  ) => {
    if (refType === "rfi") {
      navigate(
        `/projects/${projectId}/workspace/rfis/${refId}`
      );
    } else if (refType === "correspondence") {
      navigate(
        `/projects/${projectId}/workspace/correspondence/${refId}`
      );
    }
  };

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "260px 1fr",
      height: "100%",
      minHeight: 500,
    }}>

      {/* ── LEFT PANEL — Chronology list ── */}
      <div style={{
        borderRight:
          "0.5px solid var(--color-border-medium)",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg-secondary)",
      }}>

        {/* Left header */}
        <div style={{
          padding: "14px 16px 10px",
          borderBottom:
            "0.5px solid var(--color-border-medium)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{
            fontFamily:
              "Playfair Display, Georgia, serif",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}>
            Chronologies
          </span>
          <button
            onClick={() => setShowNewForm(true)}
            style={{
              fontSize: 11,
              color: ACCENT,
              background: "none",
              border: `0.5px solid ${ACCENT}`,
              borderRadius: 0,
              padding: "4px 10px",
              cursor: "pointer",
              fontFamily: "Inter, sans-serif",
            }}
          >
            + New
          </button>
        </div>

        {/* New chronology form */}
        {showNewForm && (
          <div style={{
            padding: 12,
            borderBottom:
              "0.5px solid var(--color-border-medium)",
            background:
              "var(--color-background-tertiary)",
          }}>
            <input
              type="text"
              placeholder="Chronology title..."
              value={newTitle}
              onChange={(e) =>
                setNewTitle(e.target.value)}
              style={{
                width: "100%",
                fontSize: 12,
                padding: "5px 8px",
                border:
                  "0.5px solid var(--color-border-medium)",
                borderRadius: 0,
                background:
                  "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
                fontFamily: "Inter, sans-serif",
                boxSizing: "border-box",
                marginBottom: 6,
              }}
            />
            <select
              value={newEntityType}
              onChange={(e) =>
                setNewEntityType(e.target.value)}
              style={{
                width: "100%",
                fontSize: 12,
                padding: "5px 8px",
                border:
                  "0.5px solid var(--color-border-medium)",
                borderRadius: 0,
                background:
                  "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
                fontFamily: "Inter, sans-serif",
                boxSizing: "border-box",
                marginBottom: 8,
              }}
            >
              <option value="general">General</option>
              <option value="change">Change</option>
              <option value="rfi">RFI</option>
              <option value="correspondence">
                Correspondence
              </option>
            </select>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={handleCreateChronology}
                disabled={submittingNew}
                style={{
                  fontSize: 11,
                  background: ACCENT,
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: 0,
                  padding: "4px 10px",
                  cursor: submittingNew
                    ? "not-allowed"
                    : "pointer",
                  fontFamily: "Inter, sans-serif",
                  opacity: submittingNew ? 0.6 : 1,
                }}
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowNewForm(false);
                  setNewTitle("");
                }}
                style={{
                  fontSize: 11,
                  background: "none",
                  color:
                    "var(--color-text-secondary)",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "Inter, sans-serif",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Chronology list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && (
            <p style={{
              padding: 16,
              fontSize: 12,
              color: "var(--color-text-secondary)",
              fontFamily: "Inter, sans-serif",
            }}>
              Loading...
            </p>
          )}
          {!loading && chronologies.length === 0 && (
            <p style={{
              padding: 16,
              fontSize: 12,
              color: "var(--color-text-secondary)",
              fontFamily: "Inter, sans-serif",
            }}>
              No chronologies yet.
            </p>
          )}
          {chronologies.map((c) => {
            const isActive = selectedId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                style={{
                  padding: "12px 16px",
                  paddingLeft: 13,
                  borderBottom:
                    "0.5px solid var(--color-border-light)",
                  cursor: "pointer",
                  borderLeft: isActive
                    ? `3px solid ${ACCENT}`
                    : "3px solid transparent",
                  background: isActive
                    ? "var(--color-background-tertiary)"
                    : "transparent",
                }}
              >
                <p style={{
                  fontSize: 13,
                  color: "var(--color-text-primary)",
                  fontWeight: 500,
                  marginBottom: 4,
                  fontFamily: "Inter, sans-serif",
                  lineHeight: 1.4,
                }}>
                  {c.title}
                </p>
                <div style={{
                  display: "flex",
                  gap: 8,
                  fontSize: 11,
                  color:
                    "var(--color-text-secondary)",
                  fontFamily: "Inter, sans-serif",
                }}>
                  <span>
                    {(c.events ?? []).length === 1 ? "1 event" : `${(c.events ?? []).length} events`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT PANEL — Event timeline ── */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        background: "transparent",
      }}>

        {/* Empty state */}
        {!selectedId && (
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <p style={{
              fontSize: 13,
              color: "var(--color-text-secondary)",
              fontFamily: "Inter, sans-serif",
            }}>
              Select a chronology.
            </p>
          </div>
        )}

        {/* Loading detail */}
        {selectedId && loadingDetail && (
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <p style={{
              fontSize: 13,
              color: "var(--color-text-secondary)",
              fontFamily: "Inter, sans-serif",
            }}>
              Loading...
            </p>
          </div>
        )}

        {/* Chronology detail */}
        {selectedId && !loadingDetail && selected && (
          <>
            {/* Right header */}
            <div style={{
              padding: "14px 20px 12px",
              borderBottom:
                "0.5px solid var(--color-border-medium)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}>
              <div>
                <p style={{
                  fontFamily:
                    "Playfair Display, Georgia, serif",
                  fontSize: 16,
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                  marginBottom: 4,
                }}>
                  {selected.title}
                </p>
                <div style={{
                  display: "flex",
                  gap: 12,
                  fontSize: 11,
                  color:
                    "var(--color-text-secondary)",
                  fontFamily: "Inter, sans-serif",
                }}>
                  <span>
                    {selected.events.length === 1 ? "1 event" : `${selected.events.length} events`}
                  </span>
                  {selected.events.filter(
                    (e) =>
                      e.is_active &&
                      e.auto_narrative &&
                      !e.approved_narrative
                  ).length > 0 && (
                    <>
                      <span>·</span>
                      <span style={{
                        color: ACCENT,
                      }}>
                        {selected.events.filter(
                          (e) =>
                            e.is_active &&
                            e.auto_narrative &&
                            !e.approved_narrative
                        ).length} pending approval
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() =>
                  setShowAddEvent(true)}
                style={{
                  fontSize: 12,
                  background: ACCENT,
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: 0,
                  padding: "8px 16px",
                  cursor: "pointer",
                  fontFamily: "Inter, sans-serif",
                  flexShrink: 0,
                }}
              >
                + Add Event
              </button>
            </div>

            {/* Add event form */}
            {showAddEvent && (
              <div style={{
                padding: "12px 20px",
                borderBottom:
                  "0.5px solid var(--color-border-medium)",
                background:
                  "var(--color-background-secondary)",
                display: "flex",
                gap: 10,
                alignItems: "flex-end",
                flexWrap: "wrap",
              }}>
                <div>
                  <div style={{
                    ...SECTION_LABEL,
                    marginBottom: 4,
                  }}>
                    Date
                  </div>
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) =>
                      setEventDate(e.target.value)}
                    style={{
                      fontSize: 12,
                      padding: "4px 8px",
                      border:
                        "0.5px solid var(--color-border-medium)",
                      borderRadius: 0,
                      background:
                        "var(--color-bg-secondary)",
                      color:
                        "var(--color-text-primary)",
                      fontFamily: "Inter, sans-serif",
                    }}
                  />
                </div>
                <div>
                  <div style={{
                    ...SECTION_LABEL,
                    marginBottom: 4,
                  }}>
                    Type
                  </div>
                  <select
                    value={eventType}
                    onChange={(e) =>
                      setEventType(e.target.value)}
                    style={{
                      fontSize: 12,
                      padding: "4px 8px",
                      border:
                        "0.5px solid var(--color-border-medium)",
                      borderRadius: 0,
                      background:
                        "var(--color-bg-secondary)",
                      color:
                        "var(--color-text-primary)",
                      fontFamily: "Inter, sans-serif",
                    }}
                  >
                    {Object.entries(
                      MANUAL_EVENT_TYPE_LABELS
                    ).map(([val, label]) => (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}>
                  <input
                    type="checkbox"
                    id="is_key"
                    checked={eventIsKey}
                    onChange={(e) =>
                      setEventIsKey(
                        e.target.checked)}
                  />
                  <label
                    htmlFor="is_key"
                    style={{
                      fontSize: 12,
                      color:
                        "var(--color-text-secondary)",
                      fontFamily: "Inter, sans-serif",
                      cursor: "pointer",
                    }}
                  >
                    Key event
                  </label>
                </div>
                <div style={{
                  display: "flex",
                  gap: 6,
                }}>
                  <button
                    onClick={handleAddEvent}
                    disabled={
                      submittingEvent || !eventDate
                    }
                    style={{
                      fontSize: 11,
                      background: ACCENT,
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: 0,
                      padding: "5px 10px",
                      cursor: submittingEvent
                        ? "not-allowed"
                        : "pointer",
                      fontFamily: "Inter, sans-serif",
                      opacity: submittingEvent
                        ? 0.6
                        : 1,
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setShowAddEvent(false);
                      setEventDate("");
                      setEventType("other");
                      setEventIsKey(false);
                    }}
                    style={{
                      fontSize: 11,
                      background: "none",
                      color:
                        "var(--color-text-secondary)",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "Inter, sans-serif",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Timeline */}
            <div style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 20px",
            }}>
              {selected.events.length === 0 && (
                <p style={{
                  fontSize: 12,
                  color:
                    "var(--color-text-secondary)",
                  fontFamily: "Inter, sans-serif",
                }}>
                  No events yet. Add the first event.
                </p>
              )}

              {selected.events
                .filter((e) => e.is_active)
                .sort((a, b) =>
                  a.event_date.localeCompare(
                    b.event_date))
                .map((event) => {
                  const isDraft =
                    !!event.auto_narrative &&
                    !event.approved_narrative;
                  const narrativeValue =
                    editingNarrative[event.id] ??
                    event.approved_narrative ??
                    event.auto_narrative ??
                    "";

                  return (
                    <div
                      key={event.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "82px 1fr",
                        gap: 12,
                        marginBottom: 20,
                      }}
                    >
                      {/* Date column */}
                      <div style={{
                        fontSize: 11,
                        color:
                          "var(--color-text-secondary)",
                        paddingTop: 3,
                        textAlign: "right",
                        fontFamily:
                          "Inter, sans-serif",
                        lineHeight: 1.4,
                      }}>
                        {formatDate(event.event_date)}
                      </div>

                      {/* Event body */}
                      <div style={{
                        borderLeft:
                          event.is_key_event
                            ? `2px solid ${ACCENT}`
                            : "2px solid var(--color-border-medium)",
                        paddingLeft: 14,
                        paddingBottom: 16,
                        position: "relative",
                      }}>
                        {/* Timeline dot */}
                        <div style={{
                          position: "absolute",
                          left: -5,
                          top: 5,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background:
                            event.is_key_event
                              ? ACCENT
                              : "var(--color-border-medium)",
                        }} />

                        {/* Event type label */}
                        <div style={{
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color:
                            "var(--color-text-secondary)",
                          marginBottom: 6,
                          fontFamily:
                            "Inter, sans-serif",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}>
                          {event.is_key_event && (
                            <i
                              className="ti ti-star"
                              aria-hidden="true"
                              style={{ fontSize: 11 }}
                            />
                          )}
                          {MANUAL_EVENT_TYPE_LABELS[
                            event.event_type
                          ] ?? event.event_type}
                        </div>

                        {/* Draft narrative — editable */}
                        {isDraft && (
                          <>
                            <div style={{
                              fontSize: 11,
                              fontWeight: 500,
                              textTransform:
                                "uppercase",
                              letterSpacing: "0.06em",
                              color: ACCENT,
                              marginBottom: 4,
                              fontFamily:
                                "Inter, sans-serif",
                            }}>
                              Claude draft — pending approval
                            </div>
                            <textarea
                              value={narrativeValue}
                              onChange={(e) =>
                                setEditingNarrative(
                                  (prev) => ({
                                    ...prev,
                                    [event.id]:
                                      e.target.value,
                                  })
                                )
                              }
                              style={{
                                width: "100%",
                                minHeight: 80,
                                fontSize: 12,
                                lineHeight: 1.5,
                                padding: "8px 10px",
                                border:
                                  `0.5px solid ${ACCENT}`,
                                borderLeft:
                                  `3px solid ${ACCENT}`,
                                borderRadius: 0,
                                background:
                                  "var(--color-background-warning)",
                                color:
                                  "var(--color-text-primary)",
                                fontFamily:
                                  "Inter, sans-serif",
                                resize: "vertical",
                                boxSizing:
                                  "border-box",
                                marginBottom: 6,
                              }}
                            />
                          </>
                        )}

                        {/* Approved narrative */}
                        {!isDraft &&
                          event.approved_narrative && (
                          <>
                            <div style={{
                              fontSize: 11,
                              fontWeight: 500,
                              textTransform:
                                "uppercase",
                              letterSpacing: "0.06em",
                              color:
                                "var(--color-accent)",
                              marginBottom: 4,
                              fontFamily:
                                "Inter, sans-serif",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}>
                              <i
                                className="ti ti-check"
                                aria-hidden="true"
                                style={{ fontSize: 11 }}
                              />
                              Approved
                            </div>
                            <div style={{
                              fontSize: 12,
                              lineHeight: 1.5,
                              padding: "8px 10px",
                              borderLeft:
                                "3px solid var(--color-accent)",
                              background:
                                "var(--color-background-tertiary)",
                              color:
                                "var(--color-text-primary)",
                              fontFamily:
                                "Inter, sans-serif",
                              marginBottom: 6,
                            }}>
                              {event.approved_narrative}
                            </div>
                          </>
                        )}

                        {/* No narrative state */}
                        {!isDraft &&
                          !event.approved_narrative && (
                          <div style={{
                            fontSize: 12,
                            color:
                              "var(--color-text-secondary)",
                            fontFamily:
                              "Inter, sans-serif",
                            marginBottom: 6,
                            fontStyle: "italic",
                          }}>
                            No narrative yet.
                          </div>
                        )}

                        {/* Document reference link */}
                        {event.document_ref_id &&
                          event.document_ref_type && (
                          <div style={{
                            marginTop: 4,
                            marginBottom: 6,
                          }}>
                            <button
                              onClick={() =>
                                navigateToDoc(
                                  event.document_ref_type!,
                                  event.document_ref_id!,
                                )
                              }
                              style={{
                                fontSize: 11,
                                color: ACCENT,
                                background: "none",
                                border:
                                  `0.5px solid ${ACCENT}`,
                                borderRadius: 0,
                                padding: "2px 8px",
                                cursor: "pointer",
                                fontFamily:
                                  "Inter, sans-serif",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <i
                                className="ti ti-external-link"
                                aria-hidden="true"
                                style={{ fontSize: 11 }}
                              />
                              {event.document_ref_type
                                .toUpperCase()} — open
                            </button>
                          </div>
                        )}

                        {/* Approve action — CM only */}
                        {isDraft && (
                          <div style={{
                            display: "flex",
                            gap: 8,
                            marginTop: 8,
                          }}>
                            <button
                              onClick={() =>
                                handleApprove(event)}
                              disabled={
                                approvingId === event.id
                              }
                              style={{
                                fontSize: 11,
                                color:
                                  "var(--color-accent)",
                                background: "none",
                                border:
                                  "0.5px solid var(--color-accent)",
                                borderRadius: 0,
                                padding: "3px 8px",
                                cursor:
                                  approvingId ===
                                  event.id
                                    ? "not-allowed"
                                    : "pointer",
                                fontFamily:
                                  "Inter, sans-serif",
                                opacity:
                                  approvingId ===
                                  event.id
                                    ? 0.6
                                    : 1,
                              }}
                            >
                              Approve
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
