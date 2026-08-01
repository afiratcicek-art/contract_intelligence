import { useState, useEffect, useRef, type CSSProperties } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { Chronology, ChronologyEvent } from "../types/chronology";
import { MANUAL_EVENT_TYPE_LABELS } from "../types/chronology";
import {
  fetchChronologies,
  fetchChronology,
  createChronology,
  updateChronology,
  addChronologyEvent,
  updateChronologyEvent,
  approveNarrative,
  inactivateChronologyEvent,
} from "../services/api";
import { useToastContext } from "../context/ToastContext";
import ConfirmModal from "./ConfirmModal";
import HorizontalStrip from "./chronologies/HorizontalStrip";
import ChronologyDraftView from "./chronologies/ChronologyDraftView";
import {
  chronologyEventsToPending,
  buildEventPayload,
  toSavedStripEvents,
} from "./chronologies/mappers";
import { usePendingEvents, type PendingEvent } from "./chronologies/usePendingEvents";

interface ChronologiesModuleProps {
  projectId: string;
}

const ACCENT      = "var(--color-accent)";      // bg, border, stroke
const ACCENT_TEXT = "var(--color-accent-text)"; // color only — WCAG AA

const SECTION_LABEL: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-secondary)",
  fontWeight: 500,
  marginBottom: 10,
  fontFamily: "var(--font-ui)",
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function ChronologiesModule({ projectId }: ChronologiesModuleProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToastContext();
  const pendingHook = usePendingEvents(projectId, showToast);
  const {
    pendingEvents,
    setPendingEvents,
    removeFromTimeline,
    resetPendingEvents,
    loadLinkableDocs,
    prefillFromBridge,
    linkableDocs,
    loadingDocs,
    setDocSearch,
    setShowDocDropdown,
  } = pendingHook;
  const bridgeModeOpenedRef = useRef(false);
  const bridgeFilledRef     = useRef(false);

  // ── Confirm modal state (TB-21) ──────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const confirmCallbackRef = useRef<(() => void) | null>(null);
  const openConfirm = (msg: string, onOk: () => void) => {
    setConfirmMessage(msg);
    confirmCallbackRef.current = onOk;
    setConfirmOpen(true);
  };
  const handleConfirmOk = () => {
    setConfirmOpen(false);
    confirmCallbackRef.current?.();
    confirmCallbackRef.current = null;
  };
  const handleConfirmCancel = () => {
    setConfirmOpen(false);
    confirmCallbackRef.current = null;
  };

  // ── List & selection state ──────────────────────────────────
  const [chronologies, setChronologies] = useState<Chronology[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Chronology | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ── Narrative editing (existing chronology) ─────────────────
  const [editingNarrative, setEditingNarrative] = useState<Record<string, string>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [editingApprovedId, setEditingApprovedId] = useState<string | null>(null);
  const [editingApprovedText, setEditingApprovedText] = useState<Record<string, string>>({});

  // Normal mode — inactivating
  const [inactivatingId, setInactivatingId] = useState<string | null>(null);
  const [expandedNarrativeId, setExpandedNarrativeId] = useState<string | null>(null);

  // ── CREATE MODE ─────────────────────────────────────────────
  const [createMode, setCreateMode] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [savingChronology, setSavingChronology] = useState(false);

  // ── EDIT MODE ───────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const eventRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const timelineScrollRef = useRef<HTMLDivElement>(null);

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

  // ── Bridge: open create mode when arriving from relation views ──
  useEffect(() => {
    if (bridgeModeOpenedRef.current) return;
    const s = location.state as { bridgeIds?: string[] } | null;
    if (!s?.bridgeIds?.length) return;
    bridgeModeOpenedRef.current = true;
    setCreateMode(true);
  }, [location.state]);

  // ── Bridge: pre-fill pendingEvents once linkableDocs loaded ──
  useEffect(() => {
    const s = location.state as { bridgeIds?: string[] } | null;
    const ids = s?.bridgeIds;
    if (!ids?.length || bridgeFilledRef.current) return;
    if (!createMode || loadingDocs || linkableDocs.length === 0) return;
    bridgeFilledRef.current = true;
    prefillFromBridge(ids);
  }, [createMode, loadingDocs, linkableDocs, location.state, prefillFromBridge]);

  // ── Load linkable docs when entering create mode ─────────────
  useEffect(() => {
    if (!createMode) return;
    loadLinkableDocs();
  }, [createMode, projectId, loadLinkableDocs]);

  // ── Handlers: existing chronology ───────────────────────────
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
      .catch((err) => showToast(err.message, "error"))
      .finally(() => setApprovingId(null));
  };

  const navigateToDoc = (refType: string, refId: string) => {
    if (refType === "rfi") navigate(`/projects/${projectId}/workspace/rfis/${refId}`);
    else if (refType === "correspondence") navigate(`/projects/${projectId}/workspace/correspondence/${refId}`);
  };

  const handleSaveChronology = async () => {
    if (!createTitle.trim()) { showToast("Please enter a title.", "warning"); return; }
    setSavingChronology(true);
    try {
      const created = await createChronology(projectId, {
        title: createTitle.trim(),
        entity_type: "general",
      });
      for (const pe of pendingEvents) {
        await addChronologyEvent(projectId, created.id, buildEventPayload(pe));
      }
      const updated = await fetchChronologies(projectId);
      setChronologies(updated);
      setSelectedId(created.id);
      setCreateMode(false);
      setCreateTitle("");
      resetPendingEvents();
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "detail" in err
        ? String((err as Record<string, unknown>).detail)
        : "Save failed. Please try again.";
      showToast(msg, "error");
    } finally {
      setSavingChronology(false);
    }
  };

  const exitCreateMode = () => {
    setCreateMode(false);
    setCreateTitle("");
    resetPendingEvents();
    setDocSearch("");
    setShowDocDropdown(false);
  };

  const enterEditMode = () => {
    if (!selected) return;
    setEditTitle(selected.title);
    // Load existing active events into pendingEvents
    // preserving their narrative state and marking as existing
    setPendingEvents(chronologyEventsToPending(selected.events));
    setEditMode(true);
    if (linkableDocs.length === 0) {
      loadLinkableDocs();
    }
  };

  const exitEditMode = () => {
    setEditMode(false);
    setEditTitle("");
    resetPendingEvents();
    setDocSearch("");
    setShowDocDropdown(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedId || !selected) return;
    setSavingEdit(true);
    try {
      // 1. Update title if changed
      if (editTitle.trim() && editTitle.trim() !== selected.title) {
        await updateChronology(projectId, selectedId, editTitle.trim());
      }

      // 2. Handle existing events — update metadata + narrative
      const existingPending = pendingEvents.filter((pe) => pe._isExisting);
      for (const pe of existingPending) {
        // 2a. Update event metadata if changed
        const metaUpdate: {
          event_type?: string;
          is_key_event?: boolean;
          event_date?: string;
          subject?: string;
        } = {};
        if (pe.editEventType && pe.editEventType !== pe._originalEventType) {
          metaUpdate.event_type = pe.editEventType;
        }
        if (pe.editIsKey !== undefined && pe.editIsKey !== pe._originalIsKey) {
          metaUpdate.is_key_event = pe.editIsKey;
        }
        // event_date only for manual entries
        const isManualEntry = pe.doc.type === null;
        if (isManualEntry) {
          if (pe.editDate && pe.editDate !== pe._originalDate) {
            metaUpdate.event_date = pe.editDate;
          }
          if (
            pe.editSubject !== undefined &&
            pe.editSubject !== (pe._originalSubject ?? "")
          ) {
            metaUpdate.subject = pe.editSubject;
          }
        }
        if (Object.keys(metaUpdate).length > 0) {
          await updateChronologyEvent(
            projectId, selectedId, pe.doc.id, metaUpdate
          );
        }
        // 2b. Approve modified narrative
        const narrativeChanged =
          pe.approved &&
          pe.approvedText.trim() !== (pe._originalNarrative ?? "").trim();
        if (narrativeChanged) {
          await approveNarrative(
            projectId, selectedId, pe.doc.id, pe.approvedText.trim()
          );
        }
      }

      // 3. Add new events (not existing)
      const existingIds = new Set(
        selected.events.map((ev) => ev.id)
      );
      const newPending = pendingEvents.filter(
        (pe) => !pe._isExisting && !existingIds.has(pe.doc.id)
      );
      for (const pe of newPending) {
        await addChronologyEvent(projectId, selectedId, buildEventPayload(pe));
      }

      // 4. Refresh
      const refreshed = await fetchChronology(projectId, selectedId);
      setSelected(refreshed);
      const updatedList = await fetchChronologies(projectId);
      setChronologies(updatedList);
      exitEditMode();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Save failed.";
      showToast(msg, "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRemovePendingEvent = (pe: PendingEvent) => {
    if (pe._isExisting && selectedId) {
      openConfirm(
        "Remove this event? This action is logged.",
        () => {
          inactivateChronologyEvent(
            projectId,
            selectedId,
            pe.doc.id,
            "Removed via chronology editor"
          )
            .then(() => removeFromTimeline(pe.doc.id))
            .catch((err: unknown) => {
              showToast(
                err instanceof Error ? err.message : "Failed.",
                "error"
              );
            });
        }
      );
    } else {
      removeFromTimeline(pe.doc.id);
    }
  };

  const scrollToEvent = (id: string) => {
    const el = eventRefs.current[id];
    if (el && timelineScrollRef.current) {
      timelineScrollRef.current.scrollTo({
        top: el.offsetTop - 16,
        behavior: "smooth",
      });
    }
  };

  const enterEditModeForEvent = (eventId: string) => {
    enterEditMode();
    // After edit mode mounts, scroll to event and
    // open narrative editor for that specific event
    setTimeout(() => {
      scrollToEvent(eventId);
      setPendingEvents((prev) =>
        prev.map((pe) =>
          pe.doc.id === eventId
            ? {
                ...pe,
                narrativeMode: "manual" as const,
                manualText: pe.approvedText || pe.manualText || "",
              }
            : pe
        )
      );
    }, 150);
  };

  // Inactivate event (soft delete with audit)
  const handleInactivate = (eventId: string) => {
    if (!selectedId) return;
    openConfirm("Remove this event from the chronology? This action is logged.", async () => {
      setInactivatingId(eventId);
      try {
        await inactivateChronologyEvent(
          projectId, selectedId, eventId,
          "Removed by user via chronology editor"
        );
        await fetchChronology(projectId, selectedId).then(setSelected);
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : "Failed to remove event.", "error");
      } finally {
        setInactivatingId(null);
      }
    });
  };

  // Approve modified narrative (edit existing approved narrative)
  const handleApproveModified = async (ev: ChronologyEvent) => {
    if (!selectedId) return;
    const text = editingApprovedText[ev.id] ?? ev.approved_narrative ?? "";
    if (!text.trim()) return;
    setApprovingId(ev.id);
    try {
      await approveNarrative(projectId, selectedId, ev.id, text);
      await fetchChronology(projectId, selectedId).then(setSelected);
      setEditingApprovedId(null);
      setEditingApprovedText((prev) => {
        const n = { ...prev }; delete n[ev.id]; return n;
      });
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to update narrative.", "error");
    } finally {
      setApprovingId(null);
    }
  };

  // ── RENDER ───────────────────────────────────────────────────
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: (createMode || editMode) ? "1fr" : "260px 1fr",
      height: "100%",
      flex: 1,
      minHeight: 0,
      transition: "grid-template-columns 200ms ease",
    }}>

      {/* ── LEFT PANEL ── */}
      {!createMode && !editMode && (
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
              fontFamily: "var(--font-ui)",
            }}>
              Chronologies
            </span>
            <button
              onClick={() => setCreateMode(true)}
              style={{
                fontSize: 11,
                color: ACCENT_TEXT,
                background: "none",
                border: `0.5px solid ${ACCENT}`,
                borderRadius: 0,
                padding: "4px 10px",
                cursor: "pointer",
                fontFamily: "var(--font-ui)",
              }}
            >
              + New
            </button>
          </div>

          {/* Chronology list */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {loading && (
              <p style={{ padding: "12px 16px", fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}>
                Loading...
              </p>
            )}
            {!loading && chronologies.length === 0 && (
              <p style={{ padding: "12px 16px", fontSize: 12, color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}>
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
                    fontFamily: "var(--font-ui)",
                    lineHeight: 1.4,
                  }}>
                    {c.title}
                  </p>
                  <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}>
                    <span>
                      {(() => {
                        const count = c.event_count ?? (c.events ?? []).length;
                        return count === 1 ? "1 event" : `${count} events`;
                      })()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── RIGHT PANEL ── */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, height: "100%" }}>
        {/* ════════════════════════════════════════
            EDIT MODE
            ════════════════════════════════════════ */}
        {editMode && selected && (
          <ChronologyDraftView
            mode="edit"
            title={editTitle}
            onTitleChange={setEditTitle}
            saving={savingEdit}
            onSave={handleSaveEdit}
            onCancel={exitEditMode}
            pending={pendingHook}
            scrollToEvent={scrollToEvent}
            timelineScrollRef={timelineScrollRef}
            eventRefs={eventRefs}
            onRemoveEvent={handleRemovePendingEvent}
          />
        )}

        {/* ════════════════════════════════════════
            CREATE MODE
            ════════════════════════════════════════ */}
        {createMode && (
          <ChronologyDraftView
            mode="create"
            title={createTitle}
            onTitleChange={setCreateTitle}
            saving={savingChronology}
            onSave={handleSaveChronology}
            onCancel={exitCreateMode}
            pending={pendingHook}
            scrollToEvent={scrollToEvent}
            timelineScrollRef={timelineScrollRef}
            eventRefs={eventRefs}
          />
        )}

        {/* ════════════════════════════════════════
            NORMAL MODE — right panel
            ════════════════════════════════════════ */}
        {!createMode && !editMode && (
          <>
            {/* Empty state */}
            {!selectedId && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}>
                  Select a chronology from the list.
                </p>
              </div>
            )}

            {selectedId && loadingDetail && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}>Loading...</p>
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
                      fontFamily: "var(--font-brand)",
                      fontSize: 16,
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      margin: 0,
                    }}>
                      {selected.title}
                    </p>
                    <p style={{
                      fontSize: 11,
                      color: "var(--color-text-secondary)",
                      margin: "2px 0 0",
                      fontFamily: "var(--font-ui)",
                    }}>
                      {selected.events.length === 1
                        ? "1 event"
                        : `${selected.events.length} events`}
                    </p>
                  </div>
                  <button
                    onClick={enterEditMode}
                    style={{
                      fontSize: 12,
                      background: ACCENT,
                      color: "var(--color-bg-primary)",
                      border: "none",
                      borderRadius: 0,
                      padding: "8px 16px",
                      cursor: "pointer",
                      fontFamily: "var(--font-ui)",
                      flexShrink: 0,
                    }}
                  >
                    Edit Chronology
                  </button>
                </div>

                {/* Horizontal strip — normal mode */}
                <HorizontalStrip
                  events={toSavedStripEvents(selected.events)}
                  onClickEvent={scrollToEvent}
                />

                {/* Event timeline */}
                <div ref={timelineScrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                  {selected.events.length === 0 && (
                    <p style={{ fontSize: 13, color: "var(--color-text-secondary)", fontStyle: "italic", fontFamily: "var(--font-ui)" }}>
                      No events yet.
                    </p>
                  )}
                  {selected.events.filter((ev) => ev.is_active).map((ev) => (
                    <div
                      key={ev.id}
                      ref={(el) => { eventRefs.current[ev.id] = el; }}
                      style={{
                        display: "flex",
                        gap: 16,
                        marginBottom: 24,
                        paddingBottom: 24,
                        borderBottom: "0.5px solid var(--color-border-light)",
                        opacity: inactivatingId === ev.id ? 0.4 : 1,
                        transition: "opacity 150ms",
                      }}
                    >
                      {/* Date column */}
                      <div style={{ minWidth: 90, textAlign: "right", paddingTop: 2 }}>
                        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "var(--font-meta)", margin: 0 }}>
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
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 500,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "var(--color-text-secondary)",
                            fontFamily: "var(--font-ui)",
                          }}>
                            {MANUAL_EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                          </span>
                          {ev.is_key_event && (
                            <span style={{ fontSize: 11, color: ACCENT_TEXT, fontFamily: "var(--font-ui)" }}>● KEY</span>
                          )}
                          {ev.document_ref_id && ev.document_ref_type && (
                            <button
                              onClick={() => navigateToDoc(ev.document_ref_type!, ev.document_ref_id!)}
                              style={{ fontSize: 11, color: ACCENT_TEXT, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-ui)", padding: 0 }}
                            >
                              → View
                            </button>
                          )}
                          <button
                            onClick={() => setExpandedNarrativeId(
                              expandedNarrativeId === ev.id ? null : ev.id
                            )}
                            title={expandedNarrativeId === ev.id ? "Hide narrative" : "Show narrative"}
                            style={{
                              fontSize: 11,
                              color: "var(--color-accent-text)",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontFamily: "var(--font-ui)",
                              padding: "0 4px",
                              marginLeft: "auto",
                            }}
                          >
                            {expandedNarrativeId === ev.id ? "▼ Narrative" : "▶ Narrative"}
                          </button>
                          <button
                            onClick={() => handleInactivate(ev.id)}
                            disabled={inactivatingId === ev.id}
                            title="Remove event"
                            style={{
                              fontSize: 12, color: "var(--color-text-secondary)",
                              background: "none", border: "none",
                              cursor: inactivatingId === ev.id ? "wait" : "pointer",
                              fontFamily: "var(--font-ui)", padding: "0 4px",
                            }}
                          >
                            ×
                          </button>
                        </div>

                        {/* Subject — manual entry only, always visible */}
                        {ev.subject && (
                          <p style={{
                            fontSize: 12,
                            color: "var(--color-text-secondary)",
                            fontFamily: "var(--font-ui)",
                            fontStyle: "italic",
                            margin: "0 0 6px",
                          }}>
                            {ev.subject}
                          </p>
                        )}

                        {/* Expandable narrative panel */}
                        {expandedNarrativeId === ev.id && (
                          <div style={{
                            marginTop: 8,
                            resize: "vertical",
                            overflow: "auto",
                            minHeight: 80,
                            maxHeight: 400,
                            border: "1px solid var(--color-border-medium)",
                            background: "var(--color-bg-primary)",
                            padding: "10px 12px",
                          }}>
                            {ev.approved_narrative && editingApprovedId !== ev.id && (
                              <div>
                                <div style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  marginBottom: 8,
                                }}>
                                  <p style={SECTION_LABEL}>Approved Narrative</p>
                                  <button
                                    onClick={() => {
                                      setEditingApprovedId(ev.id);
                                      setEditingApprovedText((prev) => ({
                                        ...prev,
                                        [ev.id]: ev.approved_narrative ?? "",
                                      }));
                                    }}
                                    style={{
                                      fontSize: 11,
                                      color: "var(--color-text-secondary)",
                                      background: "none", border: "none",
                                      cursor: "pointer",
                                      fontFamily: "var(--font-ui)",
                                      textDecoration: "underline",
                                    }}
                                  >
                                    Edit
                                  </button>
                                </div>
                                <p style={{
                                  fontSize: 13,
                                  color: "var(--color-text-primary)",
                                  lineHeight: 1.6,
                                  fontFamily: "var(--font-ui)",
                                  margin: 0,
                                }}>
                                  {ev.approved_narrative}
                                </p>
                              </div>
                            )}

                            {ev.approved_narrative && editingApprovedId === ev.id && (
                              <div>
                                <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>Edit Narrative</p>
                                <textarea
                                  value={editingApprovedText[ev.id] ?? ev.approved_narrative}
                                  onChange={(e) => setEditingApprovedText((prev) => ({
                                    ...prev, [ev.id]: e.target.value,
                                  }))}
                                  rows={4}
                                  style={{
                                    width: "100%", fontSize: 12, padding: "8px 10px",
                                    border: "1px solid var(--color-border-medium)",
                                    borderRadius: 0, background: "var(--color-bg-primary)",
                                    color: "var(--color-text-primary)",
                                    fontFamily: "var(--font-ui)", resize: "vertical",
                                    boxSizing: "border-box",
                                  }}
                                />
                                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                  <button
                                    onClick={() => handleApproveModified(ev)}
                                    disabled={approvingId === ev.id}
                                    style={{
                                      fontSize: 11, padding: "8px 14px",
                                      background: ACCENT, color: "var(--color-bg-primary)",
                                      border: "none", borderRadius: 0,
                                      cursor: approvingId === ev.id ? "wait" : "pointer",
                                      fontFamily: "var(--font-ui)",
                                    }}
                                  >
                                    {approvingId === ev.id ? "Saving..." : "✓ Save Changes"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingApprovedId(null);
                                      setEditingApprovedText((prev) => {
                                        const n = { ...prev };
                                        delete n[ev.id];
                                        return n;
                                      });
                                    }}
                                    style={{
                                      fontSize: 11, padding: "8px 12px",
                                      background: "none",
                                      color: "var(--color-text-secondary)",
                                      border: "1px solid var(--color-border-light)",
                                      borderRadius: 0, cursor: "pointer",
                                      fontFamily: "var(--font-ui)",
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}

                            {!ev.approved_narrative && ev.auto_narrative && (
                              <div>
                                <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>
                                  LLM Draft — Pending Approval
                                </p>
                                <textarea
                                  value={editingNarrative[ev.id] ?? ev.auto_narrative}
                                  onChange={(e) => setEditingNarrative((prev) => ({
                                    ...prev, [ev.id]: e.target.value,
                                  }))}
                                  rows={3}
                                  style={{
                                    width: "100%", fontSize: 12, padding: "8px 10px",
                                    border: "1px solid var(--color-border-medium)",
                                    borderRadius: 0, background: "var(--color-bg-primary)",
                                    color: "var(--color-text-primary)",
                                    fontFamily: "var(--font-ui)", resize: "vertical",
                                    boxSizing: "border-box",
                                  }}
                                />
                                <button
                                  onClick={() => handleApprove(ev)}
                                  disabled={approvingId === ev.id}
                                  style={{
                                    marginTop: 8, fontSize: 11, padding: "8px 14px",
                                    background: ACCENT, color: "var(--color-bg-primary)",
                                    border: "none", borderRadius: 0,
                                    cursor: approvingId === ev.id ? "wait" : "pointer",
                                    fontFamily: "var(--font-ui)",
                                  }}
                                >
                                  {approvingId === ev.id ? "Approving..." : "✓ Approve"}
                                </button>
                              </div>
                            )}

                            {!ev.approved_narrative && !ev.auto_narrative && (
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <p style={{
                                  fontSize: 12,
                                  color: "var(--color-text-secondary)",
                                  fontStyle: "italic",
                                  fontFamily: "var(--font-ui)",
                                  margin: 0,
                                }}>
                                  No narrative yet.
                                </p>
                                <button
                                  onClick={() => enterEditModeForEvent(ev.id)}
                                  style={{
                                    fontSize: 11,
                                    color: ACCENT_TEXT,
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontFamily: "var(--font-ui)",
                                    textDecoration: "underline",
                                    padding: 0,
                                  }}
                                >
                                  Write narrative →
                                </button>
                              </div>
                            )}
                          </div>
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
      <ConfirmModal
        open={confirmOpen}
        message={confirmMessage}
        onConfirm={handleConfirmOk}
        onCancel={handleConfirmCancel}
      />
    </div>
  );
}
