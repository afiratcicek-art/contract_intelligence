import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { Chronology, ChronologyEvent } from "../types/chronology";
import { MANUAL_EVENT_TYPE_LABELS } from "../types/chronology";
import {
  fetchChronologies,
  fetchChronology,
  createChronology,
  addChronologyEvent,
  approveNarrative,
  fetchLinkableDocuments,
  type LinkableDoc,
} from "../services/api";

interface ChronologiesModuleProps {
  projectId: string;
}

const ACCENT = "var(--color-accent)";

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
    day: "2-digit", month: "short", year: "numeric",
  });
}

// A pending event in create mode (before saving)
interface PendingEvent {
  doc: LinkableDoc;
  narrativeMode: "llm" | "manual" | null;
  manualText: string;
  autoNarrative: string | null;
  loadingLlm: boolean;
  approved: boolean;
  approvedText: string;
}

export default function ChronologiesModule({ projectId }: ChronologiesModuleProps) {
  const navigate = useNavigate();

  // ── List & selection state ──────────────────────────────────
  const [chronologies, setChronologies] = useState<Chronology[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Chronology | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ── Add-event form (existing chronology) ────────────────────
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [eventType, setEventType] = useState("other");
  const [eventIsKey, setEventIsKey] = useState(false);
  const [submittingEvent, setSubmittingEvent] = useState(false);

  // ── Narrative editing (existing chronology) ─────────────────
  const [editingNarrative, setEditingNarrative] = useState<Record<string, string>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // ── CREATE MODE ─────────────────────────────────────────────
  const [createMode, setCreateMode] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [linkableDocs, setLinkableDocs] = useState<LinkableDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [pendingEvents, setPendingEvents] = useState<PendingEvent[]>([]);
  const [savingChronology, setSavingChronology] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [showDocDropdown, setShowDocDropdown] = useState(false);

  // ── Load chronology list ─────────────────────────────────────
  useEffect(() => {
    fetchChronologies(projectId)
      .then(setChronologies)
      .catch(() => setChronologies([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  // ── Load selected chronology detail ─────────────────────────
  useEffect(() => {
    if (!selectedId) return;
    setLoadingDetail(true);
    fetchChronology(projectId, selectedId)
      .then(setSelected)
      .catch(() => setSelected(null))
      .finally(() => setLoadingDetail(false));
  }, [projectId, selectedId]);

  // ── Auto-select first chronology ─────────────────────────────
  useEffect(() => {
    if (chronologies.length > 0 && !selectedId) {
      setSelectedId(chronologies[0].id);
    }
  }, [chronologies, selectedId]);

  // ── Load linkable docs when entering create mode ─────────────
  useEffect(() => {
    if (!createMode) return;
    setLoadingDocs(true);
    fetchLinkableDocuments(projectId)
      .then(setLinkableDocs)
      .catch(() => setLinkableDocs([]))
      .finally(() => setLoadingDocs(false));
  }, [createMode, projectId]);

  // ── Handlers: existing chronology ───────────────────────────
  const handleAddEvent = () => {
    if (!selectedId || !eventDate) return;
    setSubmittingEvent(true);
    addChronologyEvent(projectId, selectedId, {
      event_date: eventDate,
      event_type: eventType,
      is_key_event: eventIsKey,
    })
      .then(() => {
        fetchChronology(projectId, selectedId).then(setSelected).catch(() => {});
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
    const narrative = editingNarrative[event.id] ?? event.auto_narrative ?? "";
    if (!narrative.trim()) return;
    setApprovingId(event.id);
    approveNarrative(projectId, selectedId, event.id, narrative)
      .then(() => {
        fetchChronology(projectId, selectedId).then(setSelected).catch(() => {});
        setEditingNarrative((prev) => { const n = { ...prev }; delete n[event.id]; return n; });
      })
      .catch((err) => window.alert(err.message))
      .finally(() => setApprovingId(null));
  };

  const navigateToDoc = (refType: string, refId: string) => {
    if (refType === "rfi") navigate(`/projects/${projectId}/workspace/rfis/${refId}`);
    else if (refType === "correspondence") navigate(`/projects/${projectId}/workspace/correspondence/${refId}`);
  };

  // ── Handlers: create mode ────────────────────────────────────
  const addDocToTimeline = useCallback((doc: LinkableDoc) => {
    if (pendingEvents.some((e) => e.doc.id === doc.id)) return;
    setPendingEvents((prev) => {
      const next = [...prev, {
        doc,
        narrativeMode: null,
        manualText: "",
        autoNarrative: null,
        loadingLlm: false,
        approved: false,
        approvedText: "",
      }];
      return next.sort((a, b) => (a.doc.date > b.doc.date ? 1 : -1));
    });
    setDocSearch("");
    setShowDocDropdown(false);
  }, [pendingEvents]);

  const removeFromTimeline = (docId: string) => {
    setPendingEvents((prev) => prev.filter((e) => e.doc.id !== docId));
  };

  const updatePending = (docId: string, patch: Partial<PendingEvent>) => {
    setPendingEvents((prev) => prev.map((e) => e.doc.id === docId ? { ...e, ...patch } : e));
  };

  const requestLlmNarrative = async (pe: PendingEvent) => {
    // LLM narrative preview requires a saved chronology_id.
    // In create mode, we call a dedicated preview endpoint.
    // This is handled by: POST /chronologies/narrative-preview
    // Until that endpoint is built, we fall back to manual mode.
    // TB: implement narrative-preview endpoint (lightweight, no DB write).
    updatePending(pe.doc.id, { narrativeMode: "manual" });
    window.alert(
      "LLM narrative preview is coming soon. Please write the narrative manually for now."
    );
  };

  const handleSaveChronology = async () => {
    if (!createTitle.trim()) { window.alert("Please enter a title."); return; }
    setSavingChronology(true);
    try {
      const created = await createChronology(projectId, {
        title: createTitle.trim(),
        entity_type: "general",
      });
      for (const pe of pendingEvents) {
        const manualNarrative = pe.approved
          ? pe.approvedText || pe.autoNarrative || pe.manualText || undefined
          : undefined;
        await addChronologyEvent(projectId, created.id, {
          event_date: pe.doc.date,
          event_type: pe.doc.type,
          document_ref_id: pe.doc.id,
          document_ref_type: pe.doc.type,
          manual_narrative: manualNarrative,
        });
      }
      const updated = await fetchChronologies(projectId);
      setChronologies(updated);
      setSelectedId(created.id);
      setCreateMode(false);
      setCreateTitle("");
      setPendingEvents([]);
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingChronology(false);
    }
  };

  const exitCreateMode = () => {
    setCreateMode(false);
    setCreateTitle("");
    setPendingEvents([]);
    setDocSearch("");
    setShowDocDropdown(false);
  };

  // ── Filtered doc list for dropdown ──────────────────────────
  const filteredDocs = linkableDocs.filter((d) => {
    const q = docSearch.toLowerCase();
    return (
      d.ref_number.toLowerCase().includes(q) ||
      d.subject.toLowerCase().includes(q)
    );
  });

  // ── RENDER ───────────────────────────────────────────────────
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: createMode ? "0px 1fr" : "260px 1fr",
      height: "100%",
      minHeight: 500,
      transition: "grid-template-columns 200ms ease",
    }}>

      {/* ── LEFT PANEL ── */}
      {!createMode && (
        <div style={{
          borderRight: "0.5px solid var(--color-border-medium)",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-bg-secondary)",
          overflow: "hidden",
        }}>
          {/* Left header */}
          <div style={{
            padding: "14px 16px 10px",
            borderBottom: "0.5px solid var(--color-border-medium)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <span style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-text-secondary)",
              fontFamily: "Inter, sans-serif",
            }}>
              Chronologies
            </span>
            <button
              onClick={() => setCreateMode(true)}
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

          {/* Chronology list */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {loading && (
              <p style={{ padding: "12px 16px", fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}>
                Loading...
              </p>
            )}
            {!loading && chronologies.length === 0 && (
              <p style={{ padding: "12px 16px", fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}>
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
                    borderBottom: "0.5px solid var(--color-border-light)",
                    cursor: "pointer",
                    borderLeft: isActive ? `3px solid ${ACCENT}` : "3px solid transparent",
                    background: isActive ? "var(--color-background-tertiary)" : "transparent",
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
                  <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}>
                    <span>
                      {(c.events ?? []).length === 1 ? "1 event" : `${(c.events ?? []).length} events`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── RIGHT PANEL ── */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* ════════════════════════════════════════
            CREATE MODE
            ════════════════════════════════════════ */}
        {createMode && (
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

            {/* Create header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <p style={{
                fontFamily: "Playfair Display, Georgia, serif",
                fontSize: 20,
                fontWeight: 500,
                color: "var(--color-text-primary)",
                margin: 0,
              }}>
                New Chronology
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handleSaveChronology}
                  disabled={savingChronology || !createTitle.trim()}
                  style={{
                    background: createTitle.trim() ? ACCENT : "var(--color-border-medium)",
                    color: "#F5F2ED",
                    border: "none",
                    padding: "8px 20px",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: savingChronology || !createTitle.trim() ? "not-allowed" : "pointer",
                    borderRadius: 0,
                    fontFamily: "Inter, sans-serif",
                    opacity: savingChronology ? 0.6 : 1,
                  }}
                >
                  {savingChronology ? "Saving..." : "Save Chronology"}
                </button>
                <button
                  onClick={exitCreateMode}
                  disabled={savingChronology}
                  style={{
                    background: "none",
                    border: "1px solid var(--color-border-light)",
                    color: "var(--color-text-secondary)",
                    padding: "8px 16px",
                    fontSize: 12,
                    cursor: "pointer",
                    borderRadius: 0,
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>

            {/* Title input */}
            <div style={{ marginBottom: 24 }}>
              <label style={SECTION_LABEL}>Chronology Title *</label>
              <input
                type="text"
                placeholder="e.g. Cephe İşleri Claim Chronology"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                style={{
                  width: "100%",
                  fontSize: 14,
                  padding: "10px 12px",
                  border: "1px solid var(--color-border-medium)",
                  borderRadius: 0,
                  background: "var(--color-bg-secondary)",
                  color: "var(--color-text-primary)",
                  fontFamily: "Inter, sans-serif",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Document picker */}
            <div style={{ marginBottom: 24 }}>
              <label style={SECTION_LABEL}>Add Documents to Timeline</label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  placeholder={loadingDocs ? "Loading documents..." : "Search RFI or Correspondence..."}
                  value={docSearch}
                  disabled={loadingDocs}
                  onChange={(e) => { setDocSearch(e.target.value); setShowDocDropdown(true); }}
                  onFocus={() => setShowDocDropdown(true)}
                  style={{
                    width: "100%",
                    fontSize: 13,
                    padding: "9px 12px",
                    border: "1px solid var(--color-border-medium)",
                    borderRadius: 0,
                    background: "var(--color-bg-secondary)",
                    color: "var(--color-text-primary)",
                    fontFamily: "Inter, sans-serif",
                    boxSizing: "border-box",
                  }}
                />
                {showDocDropdown && filteredDocs.length > 0 && (
                  <div style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    zIndex: 200,
                    background: "var(--color-bg-primary)",
                    border: "1px solid var(--color-border-medium)",
                    maxHeight: 260,
                    overflowY: "auto",
                  }}>
                    {filteredDocs.map((doc) => {
                      const already = pendingEvents.some((e) => e.doc.id === doc.id);
                      return (
                        <div
                          key={doc.id}
                          onClick={() => !already && addDocToTimeline(doc)}
                          style={{
                            padding: "10px 14px",
                            borderBottom: "0.5px solid var(--color-border-light)",
                            cursor: already ? "default" : "pointer",
                            opacity: already ? 0.4 : 1,
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                          }}
                        >
                          <span style={{
                            fontSize: 10,
                            fontWeight: 500,
                            textTransform: "uppercase",
                            color: "var(--color-text-secondary)",
                            fontFamily: "JetBrains Mono, monospace",
                            minWidth: 80,
                            paddingTop: 1,
                          }}>
                            {doc.ref_number}
                          </span>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontSize: 12, color: "var(--color-text-primary)", margin: 0, fontFamily: "Inter, sans-serif" }}>
                              {doc.subject}
                            </p>
                            <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "2px 0 0", fontFamily: "Inter, sans-serif" }}>
                              {formatDate(doc.date)} · {doc.type.toUpperCase()} · {doc.status}
                            </p>
                          </div>
                          {already && (
                            <span style={{ fontSize: 10, color: "var(--color-success)", fontFamily: "Inter, sans-serif" }}>Added</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {showDocDropdown && filteredDocs.length === 0 && !loadingDocs && docSearch && (
                <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 6, fontFamily: "Inter, sans-serif" }}>
                  No matching documents found.
                </p>
              )}
            </div>

            {/* Timeline — pending events */}
            {pendingEvents.length === 0 && (
              <div style={{
                padding: "32px 0",
                textAlign: "center",
                color: "var(--color-text-secondary)",
                fontSize: 13,
                fontFamily: "Inter, sans-serif",
                fontStyle: "italic",
              }}>
                Search and select documents above to build the timeline.
              </div>
            )}

            {pendingEvents.length > 0 && (
              <div>
                <p style={SECTION_LABEL}>Timeline — {pendingEvents.length} event{pendingEvents.length !== 1 ? "s" : ""}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {pendingEvents.map((pe) => (
                    <div
                      key={pe.doc.id}
                      style={{
                        border: `1px solid ${pe.approved ? "var(--color-success)" : "var(--color-border-medium)"}`,
                        padding: 16,
                        background: "var(--color-bg-secondary)",
                        position: "relative",
                      }}
                    >
                      {/* Event header */}
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                        <div>
                          <span style={{
                            fontSize: 10,
                            fontFamily: "JetBrains Mono, monospace",
                            color: "var(--color-text-secondary)",
                            marginRight: 8,
                          }}>
                            {pe.doc.ref_number}
                          </span>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 500,
                            textTransform: "uppercase",
                            color: "var(--color-text-secondary)",
                            fontFamily: "Inter, sans-serif",
                          }}>
                            {pe.doc.type}
                          </span>
                          {pe.doc.is_key_event && (
                            <span style={{ fontSize: 10, color: ACCENT, marginLeft: 8, fontFamily: "Inter, sans-serif" }}>● KEY</span>
                          )}
                          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", margin: "4px 0 2px", fontFamily: "Inter, sans-serif" }}>
                            {pe.doc.subject}
                          </p>
                          <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: 0, fontFamily: "Inter, sans-serif" }}>
                            {formatDate(pe.doc.date)}
                          </p>
                        </div>
                        <button
                          onClick={() => removeFromTimeline(pe.doc.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--color-text-secondary)", padding: 0, lineHeight: 1 }}
                        >
                          ×
                        </button>
                      </div>

                      {/* Narrative section */}
                      {!pe.narrativeMode && !pe.approved && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => requestLlmNarrative(pe)}
                            style={{
                              fontSize: 11,
                              padding: "5px 12px",
                              background: ACCENT,
                              color: "#F5F2ED",
                              border: "none",
                              borderRadius: 0,
                              cursor: "pointer",
                              fontFamily: "Inter, sans-serif",
                            }}
                          >
                            ✦ Request LLM Narrative
                          </button>
                          <button
                            onClick={() => updatePending(pe.doc.id, { narrativeMode: "manual" })}
                            style={{
                              fontSize: 11,
                              padding: "5px 12px",
                              background: "none",
                              color: "var(--color-text-secondary)",
                              border: "1px solid var(--color-border-light)",
                              borderRadius: 0,
                              cursor: "pointer",
                              fontFamily: "Inter, sans-serif",
                            }}
                          >
                            Write Manually
                          </button>
                        </div>
                      )}

                      {pe.narrativeMode === "llm" && pe.loadingLlm && (
                        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", fontStyle: "italic", fontFamily: "Inter, sans-serif" }}>
                          Generating narrative...
                        </p>
                      )}

                      {pe.narrativeMode === "llm" && !pe.loadingLlm && pe.autoNarrative && !pe.approved && (
                        <div>
                          <p style={{ ...SECTION_LABEL, marginBottom: 6 }}>LLM Draft</p>
                          <textarea
                            value={editingNarrative[pe.doc.id] ?? pe.autoNarrative}
                            onChange={(e) => setEditingNarrative((prev) => ({ ...prev, [pe.doc.id]: e.target.value }))}
                            rows={4}
                            style={{
                              width: "100%",
                              fontSize: 12,
                              padding: "8px 10px",
                              border: "1px solid var(--color-border-medium)",
                              borderRadius: 0,
                              background: "var(--color-bg-primary)",
                              color: "var(--color-text-primary)",
                              fontFamily: "Inter, sans-serif",
                              resize: "vertical",
                              boxSizing: "border-box",
                            }}
                          />
                          <button
                            onClick={() => {
                              const text = editingNarrative[pe.doc.id] ?? pe.autoNarrative ?? "";
                              updatePending(pe.doc.id, { approved: true, approvedText: text });
                            }}
                            style={{
                              marginTop: 6,
                              fontSize: 11,
                              padding: "5px 14px",
                              background: "var(--color-success)",
                              color: "#F5F2ED",
                              border: "none",
                              borderRadius: 0,
                              cursor: "pointer",
                              fontFamily: "Inter, sans-serif",
                            }}
                          >
                            ✓ Approve Narrative
                          </button>
                        </div>
                      )}

                      {pe.narrativeMode === "manual" && !pe.approved && (
                        <div>
                          <p style={{ ...SECTION_LABEL, marginBottom: 6 }}>Narrative</p>
                          <textarea
                            value={pe.manualText}
                            onChange={(e) => updatePending(pe.doc.id, { manualText: e.target.value })}
                            rows={4}
                            placeholder="Write the narrative for this event..."
                            style={{
                              width: "100%",
                              fontSize: 12,
                              padding: "8px 10px",
                              border: "1px solid var(--color-border-medium)",
                              borderRadius: 0,
                              background: "var(--color-bg-primary)",
                              color: "var(--color-text-primary)",
                              fontFamily: "Inter, sans-serif",
                              resize: "vertical",
                              boxSizing: "border-box",
                            }}
                          />
                          <button
                            onClick={() => updatePending(pe.doc.id, { approved: true, approvedText: pe.manualText })}
                            disabled={!pe.manualText.trim()}
                            style={{
                              marginTop: 6,
                              fontSize: 11,
                              padding: "5px 14px",
                              background: pe.manualText.trim() ? "var(--color-success)" : "var(--color-border-medium)",
                              color: "#F5F2ED",
                              border: "none",
                              borderRadius: 0,
                              cursor: pe.manualText.trim() ? "pointer" : "not-allowed",
                              fontFamily: "Inter, sans-serif",
                            }}
                          >
                            ✓ Approve Narrative
                          </button>
                        </div>
                      )}

                      {pe.approved && (
                        <div style={{
                          padding: "8px 12px",
                          background: "var(--color-success-bg)",
                          border: "1px solid var(--color-success)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}>
                          <p style={{ fontSize: 12, color: "var(--color-success)", margin: 0, fontFamily: "Inter, sans-serif", flex: 1 }}>
                            ✓ {pe.approvedText || "(No narrative — will be saved without narrative)"}
                          </p>
                          <button
                            onClick={() => updatePending(pe.doc.id, { approved: false, approvedText: "" })}
                            style={{ fontSize: 11, color: "var(--color-text-secondary)", background: "none", border: "none", cursor: "pointer", fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" }}
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════
            NORMAL MODE — right panel
            ════════════════════════════════════════ */}
        {!createMode && (
          <>
            {/* Empty state */}
            {!selectedId && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}>
                  Select a chronology from the list.
                </p>
              </div>
            )}

            {selectedId && loadingDetail && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}>Loading...</p>
              </div>
            )}

            {selectedId && !loadingDetail && selected && (
              <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>

                {/* Right panel header */}
                <div style={{
                  padding: "14px 20px",
                  borderBottom: "0.5px solid var(--color-border-medium)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}>
                  <div>
                    <p style={{
                      fontFamily: "Playfair Display, Georgia, serif",
                      fontSize: 16,
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      margin: 0,
                    }}>
                      {selected.title}
                    </p>
                    <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "2px 0 0", fontFamily: "Inter, sans-serif" }}>
                      {selected.events.length === 1 ? "1 event" : `${selected.events.length} events`}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowAddEvent(true)}
                    style={{
                      fontSize: 12,
                      background: ACCENT,
                      color: "#F5F2ED",
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

                {/* Add event inline form */}
                {showAddEvent && (
                  <div style={{
                    padding: "12px 20px",
                    borderBottom: "0.5px solid var(--color-border-medium)",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "var(--color-bg-secondary)",
                  }}>
                    <div>
                      <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>Date</p>
                      <input
                        type="date"
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        style={{
                          fontSize: 12,
                          padding: "5px 8px",
                          border: "0.5px solid var(--color-border-medium)",
                          borderRadius: 0,
                          background: "var(--color-bg-primary)",
                          color: "var(--color-text-primary)",
                          fontFamily: "Inter, sans-serif",
                        }}
                      />
                    </div>
                    <div>
                      <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>Type</p>
                      <select
                        value={eventType}
                        onChange={(e) => setEventType(e.target.value)}
                        style={{
                          fontSize: 12,
                          padding: "5px 8px",
                          border: "0.5px solid var(--color-border-medium)",
                          borderRadius: 0,
                          background: "var(--color-bg-primary)",
                          color: "var(--color-text-primary)",
                          fontFamily: "Inter, sans-serif",
                        }}
                      >
                        {Object.entries(MANUAL_EVENT_TYPE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif", cursor: "pointer", marginTop: 14 }}>
                      <input type="checkbox" checked={eventIsKey} onChange={(e) => setEventIsKey(e.target.checked)} />
                      Key event
                    </label>
                    <button
                      onClick={handleAddEvent}
                      disabled={submittingEvent || !eventDate}
                      style={{
                        fontSize: 12,
                        background: eventDate ? ACCENT : "var(--color-border-medium)",
                        color: "#F5F2ED",
                        border: "none",
                        borderRadius: 0,
                        padding: "5px 10px",
                        cursor: submittingEvent || !eventDate ? "not-allowed" : "pointer",
                        fontFamily: "Inter, sans-serif",
                        marginTop: 14,
                      }}
                    >
                      {submittingEvent ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => { setShowAddEvent(false); setEventDate(""); setEventType("other"); setEventIsKey(false); }}
                      style={{
                        fontSize: 12,
                        background: "none",
                        border: "1px solid var(--color-border-light)",
                        color: "var(--color-text-secondary)",
                        borderRadius: 0,
                        padding: "5px 10px",
                        cursor: "pointer",
                        fontFamily: "Inter, sans-serif",
                        marginTop: 14,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Event timeline */}
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                  {selected.events.length === 0 && (
                    <p style={{ fontSize: 13, color: "var(--color-text-secondary)", fontStyle: "italic", fontFamily: "Inter, sans-serif" }}>
                      No events yet.
                    </p>
                  )}
                  {selected.events.filter((ev) => ev.is_active).map((ev) => (
                    <div
                      key={ev.id}
                      style={{
                        display: "flex",
                        gap: 16,
                        marginBottom: 24,
                        paddingBottom: 24,
                        borderBottom: "0.5px solid var(--color-border-light)",
                      }}
                    >
                      {/* Date column */}
                      <div style={{ minWidth: 90, textAlign: "right", paddingTop: 2 }}>
                        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace", margin: 0 }}>
                          {formatDate(ev.event_date)}
                        </p>
                      </div>
                      {/* Connector */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: ev.is_key_event ? ACCENT : "var(--color-border-medium)",
                          marginTop: 4, flexShrink: 0,
                        }} />
                        <div style={{ width: 1, flex: 1, background: "var(--color-border-light)", marginTop: 4 }} />
                      </div>
                      {/* Content */}
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 500,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "var(--color-text-secondary)",
                            fontFamily: "Inter, sans-serif",
                          }}>
                            {MANUAL_EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                          </span>
                          {ev.is_key_event && (
                            <span style={{ fontSize: 10, color: ACCENT, fontFamily: "Inter, sans-serif" }}>● KEY</span>
                          )}
                          {ev.document_ref_id && ev.document_ref_type && (
                            <button
                              onClick={() => navigateToDoc(ev.document_ref_type!, ev.document_ref_id!)}
                              style={{ fontSize: 10, color: ACCENT, background: "none", border: "none", cursor: "pointer", fontFamily: "Inter, sans-serif", padding: 0 }}
                            >
                              → View
                            </button>
                          )}
                        </div>

                        {/* Approved narrative */}
                        {ev.approved_narrative && (
                          <div style={{ marginBottom: 8 }}>
                            <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>Approved Narrative</p>
                            <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6, fontFamily: "Inter, sans-serif", margin: 0 }}>
                              {ev.approved_narrative}
                            </p>
                          </div>
                        )}

                        {/* Auto narrative — CM approval needed */}
                        {!ev.approved_narrative && ev.auto_narrative && (
                          <div style={{ marginBottom: 8 }}>
                            <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>LLM Draft — Pending Approval</p>
                            <textarea
                              value={editingNarrative[ev.id] ?? ev.auto_narrative}
                              onChange={(e) => setEditingNarrative((prev) => ({ ...prev, [ev.id]: e.target.value }))}
                              rows={3}
                              style={{
                                width: "100%",
                                fontSize: 12,
                                padding: "7px 10px",
                                border: "1px solid var(--color-border-medium)",
                                borderRadius: 0,
                                background: "var(--color-bg-primary)",
                                color: "var(--color-text-primary)",
                                fontFamily: "Inter, sans-serif",
                                resize: "vertical",
                                boxSizing: "border-box",
                              }}
                            />
                            <button
                              onClick={() => handleApprove(ev)}
                              disabled={approvingId === ev.id}
                              style={{
                                marginTop: 6,
                                fontSize: 11,
                                padding: "5px 14px",
                                background: ACCENT,
                                color: "#F5F2ED",
                                border: "none",
                                borderRadius: 0,
                                cursor: approvingId === ev.id ? "wait" : "pointer",
                                fontFamily: "Inter, sans-serif",
                              }}
                            >
                              {approvingId === ev.id ? "Approving..." : "✓ Approve"}
                            </button>
                          </div>
                        )}

                        {/* No narrative yet */}
                        {!ev.approved_narrative && !ev.auto_narrative && (
                          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", fontStyle: "italic", fontFamily: "Inter, sans-serif", margin: 0 }}>
                            No narrative yet.
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
