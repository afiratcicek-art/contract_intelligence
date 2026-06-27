import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { Chronology, ChronologyEvent } from "../types/chronology";
import { MANUAL_EVENT_TYPE_LABELS } from "../types/chronology";
import {
  fetchChronologies,
  fetchChronology,
  createChronology,
  updateChronology,
  addChronologyEvent,
  approveNarrative,
  inactivateChronologyEvent,
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
  // Edit mode only
  _isExisting?: boolean;       // true = loaded from saved chronology
  _originalNarrative?: string; // original approved_narrative for diff
}


interface StripEvent {
  id: string;
  date: string;
  label: string;
  approved: boolean;
  isKey?: boolean;
}

function HorizontalStrip({
  events,
  onClickEvent,
}: {
  events: StripEvent[];
  onClickEvent: (id: string) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div style={{
      overflowX: "auto",
      borderBottom: "0.5px solid var(--color-border-medium)",
      background: "var(--color-bg-secondary)",
      padding: "12px 20px",
      display: "flex",
      alignItems: "center",
      gap: 0,
      minHeight: 72,
      flexShrink: 0,
    }}>
      {events.map((ev, idx) => (
        <div
          key={ev.id}
          style={{ display: "flex", alignItems: "center" }}
        >
          {/* Node */}
          <div
            onClick={() => onClickEvent(ev.id)}
            title={ev.label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              cursor: "pointer",
              minWidth: 80,
              maxWidth: 120,
            }}
          >
            <div style={{
              width: ev.isKey ? 12 : 8,
              height: ev.isKey ? 12 : 8,
              borderRadius: "50%",
              background: ev.approved
                ? "var(--color-success)"
                : "var(--color-accent)",
              flexShrink: 0,
              border: ev.isKey
                ? "2px solid var(--color-accent)"
                : "none",
            }} />
            <p style={{
              fontSize: 9,
              fontFamily: "JetBrains Mono, monospace",
              color: "var(--color-text-secondary)",
              margin: "3px 0 1px",
              textAlign: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 90,
            }}>
              {ev.label}
            </p>
            <p style={{
              fontSize: 9,
              fontFamily: "Inter, sans-serif",
              color: "var(--color-text-secondary)",
              margin: 0,
              textAlign: "center",
              whiteSpace: "nowrap",
            }}>
              {ev.date}
            </p>
          </div>
          {/* Connector line between nodes */}
          {idx < events.length - 1 && (
            <div style={{
              height: 1,
              width: 32,
              background: "var(--color-border-medium)",
              flexShrink: 0,
            }} />
          )}
        </div>
      ))}
    </div>
  );
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

  // Normal mode — add event with doc picker
  const [normalShowDocPicker, setNormalShowDocPicker] = useState(false);
  const [normalDocSearch, setNormalDocSearch] = useState("");
  const [normalShowDocDropdown, setNormalShowDocDropdown] = useState(false);
  const [normalShowManualEntry, setNormalShowManualEntry] = useState(false);
  const [normalManualDate, setNormalManualDate] = useState("");
  const [normalManualType, setNormalManualType] = useState("other");
  const [normalManualSubject, setNormalManualSubject] = useState("");
  const [normalManualNarrative, setNormalManualNarrative] = useState("");
  const normalDocPickerRef = useRef<HTMLDivElement>(null);

  // Normal mode — narrative editing
  const [editingApprovedId, setEditingApprovedId] = useState<string | null>(null);
  const [editingApprovedText, setEditingApprovedText] = useState<Record<string, string>>({});

  // Normal mode — inactivating
  const [inactivatingId, setInactivatingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  // ── CREATE MODE ─────────────────────────────────────────────
  const [createMode, setCreateMode] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [linkableDocs, setLinkableDocs] = useState<LinkableDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [pendingEvents, setPendingEvents] = useState<PendingEvent[]>([]);
  const [savingChronology, setSavingChronology] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [showDocDropdown, setShowDocDropdown] = useState(false);
  const docPickerRef = useRef<HTMLDivElement>(null);

  // ── EDIT MODE ───────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const eventRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualDate, setManualDate] = useState("");
  const [manualType, setManualType] = useState("other");
  const [manualSubject, setManualSubject] = useState("");
  const [manualNarrative, setManualNarrative] = useState("");

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

  // Load linkable docs when normal mode doc picker opens
  useEffect(() => {
    if (!normalShowDocPicker) return;
    if (linkableDocs.length > 0) return; // already loaded
    setLoadingDocs(true);
    fetchLinkableDocuments(projectId)
      .then(setLinkableDocs)
      .catch(() => setLinkableDocs([]))
      .finally(() => setLoadingDocs(false));
  }, [normalShowDocPicker, projectId, linkableDocs.length]);

  // Close normal mode dropdown on outside click
  useEffect(() => {
    if (!normalShowDocDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (
        normalDocPickerRef.current &&
        !normalDocPickerRef.current.contains(e.target as Node)
      ) {
        setNormalShowDocDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [normalShowDocDropdown]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDocDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (
        docPickerRef.current &&
        !docPickerRef.current.contains(e.target as Node)
      ) {
        setShowDocDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDocDropdown]);

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

  const addManualEvent = () => {
    if (!manualDate || !manualSubject.trim()) return;
    const fakeId = `manual-${Date.now()}`;
    // Add to timeline
    setPendingEvents((prev) => {
      const next = [...prev, {
        doc: {
          id: fakeId,
          type: manualType as "rfi" | "correspondence",
          ref_number: "MANUAL",
          subject: manualSubject.trim(),
          date: manualDate,
          status: "manual",
          parent_id: null,
        },
        narrativeMode: manualNarrative.trim() ? "manual" as const : null,
        manualText: manualNarrative.trim(),
        autoNarrative: null,
        loadingLlm: false,
        approved: manualNarrative.trim().length > 0,
        approvedText: manualNarrative.trim(),
      }];
      return next.sort((a, b) => (a.doc.date > b.doc.date ? 1 : -1));
    });
    setManualDate("");
    setManualType("other");
    setManualSubject("");
    setManualNarrative("");
    setShowManualEntry(false);
  };

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
        const isManual = pe.doc.id.startsWith("manual-");
        const eventType = isManual
          ? (pe.doc.type || "other")
          : (pe.doc.type === "rfi" ? "rfi" : "correspondence");
        await addChronologyEvent(projectId, created.id, {
          event_date: pe.doc.date,
          event_type: eventType,
          document_ref_id: isManual ? undefined : pe.doc.id,
          document_ref_type: isManual ? undefined : pe.doc.type,
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
      const msg = err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "detail" in err
        ? String((err as Record<string, unknown>).detail)
        : "Save failed. Please try again.";
      window.alert(msg);
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

  const enterEditMode = () => {
    if (!selected) return;
    setEditTitle(selected.title);
    // Load existing active events into pendingEvents
    // preserving their narrative state and marking as existing
    const existing: PendingEvent[] = selected.events
      .filter((ev) => ev.is_active)
      .sort((a, b) => (a.event_date > b.event_date ? 1 : -1))
      .map((ev) => ({
        doc: {
          id: ev.id,
          type: (ev.document_ref_type ?? "other") as "rfi" | "correspondence",
          ref_number: ev.document_ref_type
            ? ev.event_type.toUpperCase()
            : "MANUAL",
          subject: ev.document_ref_type
            ? `${ev.event_type.toUpperCase()} — ${ev.event_date}`
            : `${ev.event_type} — ${ev.event_date}`,
          date: ev.event_date,
          status: "existing",
          parent_id: null,
        },
        narrativeMode: ev.approved_narrative ? ("manual" as const) : null,
        manualText: ev.approved_narrative ?? "",
        autoNarrative: ev.auto_narrative,
        loadingLlm: false,
        approved: !!ev.approved_narrative,
        approvedText: ev.approved_narrative ?? "",
        _isExisting: true,
        _originalNarrative: ev.approved_narrative ?? "",
      }));
    setPendingEvents(existing);
    setEditMode(true);
    if (linkableDocs.length === 0) {
      setLoadingDocs(true);
      fetchLinkableDocuments(projectId)
        .then(setLinkableDocs)
        .catch(() => setLinkableDocs([]))
        .finally(() => setLoadingDocs(false));
    }
  };

  const exitEditMode = () => {
    setEditMode(false);
    setEditTitle("");
    setPendingEvents([]);
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

      // 2. Handle existing events — approve modified narratives
      const existingPending = pendingEvents.filter((pe) => pe._isExisting);
      for (const pe of existingPending) {
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
        const isManual = pe.doc.id.startsWith("manual-");
        const manualNarrative =
          pe.approved
            ? pe.approvedText || pe.manualText || undefined
            : undefined;
        await addChronologyEvent(projectId, selectedId, {
          event_date: pe.doc.date,
          event_type: isManual
            ? pe.doc.type || "other"
            : pe.doc.type === "rfi"
            ? "rfi"
            : "correspondence",
          document_ref_id: isManual ? undefined : pe.doc.id,
          document_ref_type: isManual ? undefined : pe.doc.type,
          manual_narrative: manualNarrative,
        });
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
      window.alert(msg);
    } finally {
      setSavingEdit(false);
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

  // Add doc-linked event to existing chronology
  const handleAddDocEvent = async (doc: LinkableDoc) => {
    if (!selectedId) return;
    setNormalDocSearch("");
    setNormalShowDocDropdown(false);
    setNormalShowDocPicker(false);
    try {
      await addChronologyEvent(projectId, selectedId, {
        event_date: doc.date,
        event_type: doc.type === "rfi" ? "rfi" : "correspondence",
        document_ref_id: doc.id,
        document_ref_type: doc.type,
      });
      await fetchChronology(projectId, selectedId).then(setSelected);
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : "Failed to add event.");
    }
  };

  // Add manual event to existing chronology
  const handleAddNormalManualEvent = async () => {
    if (!selectedId || !normalManualDate || !normalManualSubject.trim()) return;
    try {
      await addChronologyEvent(projectId, selectedId, {
        event_date: normalManualDate,
        event_type: normalManualType,
        manual_narrative: normalManualNarrative.trim() || undefined,
      });
      await fetchChronology(projectId, selectedId).then(setSelected);
      setNormalManualDate("");
      setNormalManualType("other");
      setNormalManualSubject("");
      setNormalManualNarrative("");
      setNormalShowManualEntry(false);
      setNormalShowDocPicker(false);
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : "Failed to add event.");
    }
  };

  // Inactivate event (soft delete with audit)
  const handleInactivate = async (eventId: string) => {
    if (!selectedId) return;
    if (!window.confirm("Remove this event from the chronology? This action is logged.")) return;
    setInactivatingId(eventId);
    try {
      await inactivateChronologyEvent(
        projectId, selectedId, eventId,
        "Removed by user via chronology editor"
      );
      await fetchChronology(projectId, selectedId).then(setSelected);
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : "Failed to remove event.");
    } finally {
      setInactivatingId(null);
    }
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
      window.alert(err instanceof Error ? err.message : "Failed to update narrative.");
    } finally {
      setApprovingId(null);
    }
  };

  const handleSaveTitle = async () => {
    if (!selectedId || !titleDraft.trim()) return;
    setSavingTitle(true);
    try {
      const updated = await updateChronology(
        projectId, selectedId, titleDraft.trim()
      );
      setSelected(updated);
      setChronologies((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? { ...c, title: updated.title }
            : c
        )
      );
      setEditingTitle(false);
    } catch (err: unknown) {
      window.alert(
        err instanceof Error ? err.message : "Failed to update title."
      );
    } finally {
      setSavingTitle(false);
    }
  };

  // Normal mode filtered docs
  const normalFilteredDocs = linkableDocs.filter((d) => {
    const q = normalDocSearch.toLowerCase();
    return (
      d.ref_number.toLowerCase().includes(q) ||
      d.subject.toLowerCase().includes(q)
    );
  });

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
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <HorizontalStrip
              events={pendingEvents.map((pe) => ({
                id: pe.doc.id,
                date: pe.doc.date
                  ? new Date(pe.doc.date).toLocaleDateString("en-GB", {
                      day: "2-digit", month: "short",
                    })
                  : "",
                label: pe.doc.ref_number !== "MANUAL"
                  ? pe.doc.ref_number
                  : pe.doc.subject.slice(0, 12),
                approved: pe.approved,
                isKey: false,
              }))}
              onClickEvent={scrollToEvent}
            />
            <div
              ref={timelineScrollRef}
              style={{ flex: 1, overflowY: "auto", padding: 24, minHeight: 0 }}
            >
              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center",
                justifyContent: "space-between", marginBottom: 24,
              }}>
                <p style={{
                  fontFamily: "Playfair Display, Georgia, serif",
                  fontSize: 20, fontWeight: 500,
                  color: "var(--color-text-primary)", margin: 0,
                }}>
                  Edit Chronology
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleSaveEdit}
                    disabled={savingEdit}
                    style={{
                      background: ACCENT, color: "#F5F2ED",
                      border: "none", padding: "8px 20px",
                      fontSize: 12, fontWeight: 500,
                      cursor: savingEdit ? "not-allowed" : "pointer",
                      borderRadius: 0, fontFamily: "Inter, sans-serif",
                      opacity: savingEdit ? 0.6 : 1,
                    }}
                  >
                    {savingEdit ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    onClick={exitEditMode}
                    disabled={savingEdit}
                    style={{
                      background: "none",
                      border: "1px solid var(--color-border-light)",
                      color: "var(--color-text-secondary)",
                      padding: "8px 16px", fontSize: 12,
                      cursor: "pointer", borderRadius: 0,
                      fontFamily: "Inter, sans-serif",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>

              {/* Title input */}
              <div style={{ marginBottom: 24 }}>
                <label style={SECTION_LABEL}>Chronology Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  style={{
                    width: "100%", fontSize: 14, padding: "10px 12px",
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
                <div ref={docPickerRef} style={{ position: "relative" }}>
                  <input
                    type="text"
                    placeholder={loadingDocs
                      ? "Loading documents..."
                      : "Search RFI or Correspondence..."}
                    value={docSearch}
                    disabled={loadingDocs}
                    onChange={(e) => {
                      setDocSearch(e.target.value);
                      setShowDocDropdown(true);
                    }}
                    onFocus={() => setShowDocDropdown(true)}
                    style={{
                      width: "100%", fontSize: 13, padding: "9px 12px",
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
                      position: "absolute", top: "100%", left: 0, right: 0,
                      zIndex: 200, background: "var(--color-bg-primary)",
                      border: "1px solid var(--color-border-medium)",
                      maxHeight: 260, overflowY: "auto",
                    }}>
                      {filteredDocs.map((doc) => {
                        const already = pendingEvents.some(
                          (e) => e.doc.id === doc.id
                        );
                        return (
                          <div
                            key={doc.id}
                            onClick={() => !already && addDocToTimeline(doc)}
                            style={{
                              padding: "10px 14px",
                              borderBottom: "0.5px solid var(--color-border-light)",
                              cursor: already ? "default" : "pointer",
                              opacity: already ? 0.4 : 1,
                              display: "flex", gap: 10,
                            }}
                          >
                            <span style={{
                              fontSize: 10, fontWeight: 500,
                              textTransform: "uppercase",
                              color: "var(--color-text-secondary)",
                              fontFamily: "JetBrains Mono, monospace",
                              minWidth: 80, paddingTop: 1,
                            }}>
                              {doc.ref_number}
                            </span>
                            <div style={{ flex: 1 }}>
                              <p style={{
                                fontSize: 12,
                                color: "var(--color-text-primary)",
                                margin: 0, fontFamily: "Inter, sans-serif",
                              }}>
                                {doc.subject}
                              </p>
                              <p style={{
                                fontSize: 11,
                                color: "var(--color-text-secondary)",
                                margin: "2px 0 0",
                                fontFamily: "Inter, sans-serif",
                              }}>
                                {formatDate(doc.date)} · {doc.type.toUpperCase()}
                              </p>
                            </div>
                            {already && (
                              <span style={{
                                fontSize: 10,
                                color: "var(--color-success)",
                                fontFamily: "Inter, sans-serif",
                              }}>
                                Added
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Timeline */}
              {pendingEvents.length === 0 && (
                <div style={{
                  padding: "32px 0", textAlign: "center",
                  color: "var(--color-text-secondary)",
                  fontSize: 13, fontFamily: "Inter, sans-serif",
                  fontStyle: "italic",
                }}>
                  No events yet.
                </div>
              )}
              {pendingEvents.length > 0 && (
                <div>
                  <p style={SECTION_LABEL}>
                    Timeline — {pendingEvents.length} event
                    {pendingEvents.length !== 1 ? "s" : ""}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {pendingEvents.map((pe, idx) => (
                      <div
                        key={pe.doc.id}
                        ref={(el) => { eventRefs.current[pe.doc.id] = el; }}
                        style={{ display: "flex", gap: 0 }}
                      >
                        {/* Spine */}
                        <div style={{
                          display: "flex", flexDirection: "column",
                          alignItems: "center", width: 32,
                          flexShrink: 0, paddingTop: 18,
                        }}>
                          <div style={{
                            width: 10, height: 10, borderRadius: "50%",
                            background: pe.approved
                              ? "var(--color-success)" : ACCENT,
                            flexShrink: 0, zIndex: 1,
                          }} />
                          {idx < pendingEvents.length - 1 && (
                            <div style={{
                              width: 1, flex: 1, minHeight: 24,
                              background: "var(--color-border-medium)",
                              marginTop: 4,
                            }} />
                          )}
                        </div>
                        {/* Card */}
                        <div style={{
                          flex: 1,
                          border: `1px solid ${pe.approved
                            ? "var(--color-success)"
                            : "var(--color-border-medium)"}`,
                          padding: 16,
                          background: "var(--color-bg-secondary)",
                          position: "relative",
                          marginBottom: idx < pendingEvents.length - 1 ? 0 : 16,
                        }}>
                          {/* Card header */}
                          <div style={{
                            display: "flex", alignItems: "flex-start",
                            justifyContent: "space-between", marginBottom: 12,
                          }}>
                            <div>
                              <span style={{
                                fontSize: 10,
                                fontFamily: "JetBrains Mono, monospace",
                                color: "var(--color-text-secondary)",
                                marginRight: 8,
                              }}>
                                {pe.doc.ref_number}
                              </span>
                              {pe._isExisting && (
                                <span style={{
                                  fontSize: 9, color: "var(--color-text-secondary)",
                                  fontFamily: "Inter, sans-serif",
                                  background: "var(--color-bg-primary)",
                                  padding: "1px 5px",
                                }}>
                                  existing
                                </span>
                              )}
                              <p style={{
                                fontSize: 13, fontWeight: 500,
                                color: "var(--color-text-primary)",
                                margin: "4px 0 2px",
                                fontFamily: "Inter, sans-serif",
                              }}>
                                {pe.doc.subject}
                              </p>
                              <p style={{
                                fontSize: 11,
                                color: "var(--color-text-secondary)",
                                margin: 0, fontFamily: "Inter, sans-serif",
                              }}>
                                {formatDate(pe.doc.date)}
                              </p>
                            </div>
                            {/* × button — inactivate for existing, remove for new */}
                            <button
                              onClick={() => {
                                if (pe._isExisting) {
                                  if (window.confirm(
                                    "Remove this event? This action is logged."
                                  )) {
                                    inactivateChronologyEvent(
                                      projectId,
                                      selectedId!,
                                      pe.doc.id,
                                      "Removed via chronology editor"
                                    )
                                      .then(() => removeFromTimeline(pe.doc.id))
                                      .catch((err: unknown) => {
                                        window.alert(
                                          err instanceof Error
                                            ? err.message
                                            : "Failed."
                                        );
                                      });
                                  }
                                } else {
                                  removeFromTimeline(pe.doc.id);
                                }
                              }}
                              style={{
                                background: "none", border: "none",
                                cursor: "pointer", fontSize: 16,
                                color: "var(--color-text-secondary)",
                                padding: 0, lineHeight: 1,
                              }}
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
                                  fontSize: 11, padding: "5px 12px",
                                  background: ACCENT, color: "#F5F2ED",
                                  border: "none", borderRadius: 0,
                                  cursor: "pointer",
                                  fontFamily: "Inter, sans-serif",
                                }}
                              >
                                ✦ Request LLM Narrative
                              </button>
                              <button
                                onClick={() => updatePending(pe.doc.id, {
                                  narrativeMode: "manual",
                                })}
                                style={{
                                  fontSize: 11, padding: "5px 12px",
                                  background: "none",
                                  color: "var(--color-text-secondary)",
                                  border: "1px solid var(--color-border-light)",
                                  borderRadius: 0, cursor: "pointer",
                                  fontFamily: "Inter, sans-serif",
                                }}
                              >
                                Write Manually
                              </button>
                            </div>
                          )}

                          {pe.narrativeMode === "manual" && !pe.approved && (
                            <div>
                              <p style={{ ...SECTION_LABEL, marginBottom: 6 }}>
                                Narrative
                              </p>
                              <textarea
                                value={pe.manualText}
                                onChange={(e) => updatePending(pe.doc.id, {
                                  manualText: e.target.value,
                                })}
                                rows={4}
                                placeholder="Write the narrative for this event..."
                                style={{
                                  width: "100%", fontSize: 12,
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
                                onClick={() => updatePending(pe.doc.id, {
                                  approved: true,
                                  approvedText: pe.manualText,
                                })}
                                disabled={!pe.manualText.trim()}
                                style={{
                                  marginTop: 6, fontSize: 11,
                                  padding: "5px 14px",
                                  background: pe.manualText.trim()
                                    ? "var(--color-success)"
                                    : "var(--color-border-medium)",
                                  color: "#F5F2ED", border: "none",
                                  borderRadius: 0,
                                  cursor: pe.manualText.trim()
                                    ? "pointer" : "not-allowed",
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
                              display: "flex", alignItems: "center",
                              justifyContent: "space-between", gap: 12,
                            }}>
                              <p style={{
                                fontSize: 12, color: "var(--color-success)",
                                margin: 0, fontFamily: "Inter, sans-serif",
                                flex: 1,
                              }}>
                                ✓ {pe.approvedText || "(No narrative)"}
                              </p>
                              <button
                                onClick={() => updatePending(pe.doc.id, {
                                  approved: false,
                                  approvedText: "",
                                  narrativeMode: "manual",
                                  manualText: pe.approvedText,
                                })}
                                style={{
                                  fontSize: 11,
                                  color: "var(--color-text-secondary)",
                                  background: "none", border: "none",
                                  cursor: "pointer",
                                  fontFamily: "Inter, sans-serif",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                Edit
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════
            CREATE MODE
            ════════════════════════════════════════ */}
        {createMode && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Horizontal strip — create mode */}
            <HorizontalStrip
              events={pendingEvents.map((pe) => ({
                id: pe.doc.id,
                date: pe.doc.date
                  ? new Date(pe.doc.date).toLocaleDateString("en-GB", {
                      day: "2-digit", month: "short",
                    })
                  : "",
                label: pe.doc.ref_number !== "MANUAL"
                  ? pe.doc.ref_number
                  : pe.doc.subject.slice(0, 12),
                approved: pe.approved,
                isKey: false,
              }))}
              onClickEvent={scrollToEvent}
            />
            <div
              ref={timelineScrollRef}
              style={{ flex: 1, overflowY: "auto", padding: 24, minHeight: 0 }}
            >

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
              <div ref={docPickerRef} style={{ position: "relative" }}>
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
              {/* Manual entry toggle */}
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => setShowManualEntry((v) => !v)}
                  style={{
                    fontSize: 11,
                    color: "var(--color-text-secondary)",
                    background: "none",
                    border: "1px solid var(--color-border-light)",
                    borderRadius: 0,
                    padding: "4px 12px",
                    cursor: "pointer",
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  {showManualEntry ? "Cancel manual entry" : "+ Add entry not in system"}
                </button>
              </div>

              {showManualEntry && (
                <div style={{
                  marginTop: 10,
                  padding: 14,
                  background: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border-light)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}>
                  <p style={{ ...SECTION_LABEL, marginBottom: 0 }}>
                    Manual Entry
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ ...SECTION_LABEL, marginBottom: 4 }}>Date *</label>
                      <input
                        type="date"
                        value={manualDate}
                        onChange={(e) => setManualDate(e.target.value)}
                        style={{
                          width: "100%",
                          fontSize: 12,
                          padding: "6px 8px",
                          border: "1px solid var(--color-border-medium)",
                          borderRadius: 0,
                          background: "var(--color-bg-primary)",
                          color: "var(--color-text-primary)",
                          fontFamily: "Inter, sans-serif",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ ...SECTION_LABEL, marginBottom: 4 }}>Type</label>
                      <select
                        value={manualType}
                        onChange={(e) => setManualType(e.target.value)}
                        style={{
                          width: "100%",
                          fontSize: 12,
                          padding: "6px 8px",
                          border: "1px solid var(--color-border-medium)",
                          borderRadius: 0,
                          background: "var(--color-bg-primary)",
                          color: "var(--color-text-primary)",
                          fontFamily: "Inter, sans-serif",
                          boxSizing: "border-box",
                        }}
                      >
                        {Object.entries(MANUAL_EVENT_TYPE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={{ ...SECTION_LABEL, marginBottom: 4 }}>Description *</label>
                    <input
                      type="text"
                      value={manualSubject}
                      onChange={(e) => setManualSubject(e.target.value)}
                      placeholder="Brief description of the event..."
                      style={{
                        width: "100%",
                        fontSize: 12,
                        padding: "6px 8px",
                        border: "1px solid var(--color-border-medium)",
                        borderRadius: 0,
                        background: "var(--color-bg-primary)",
                        color: "var(--color-text-primary)",
                        fontFamily: "Inter, sans-serif",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ ...SECTION_LABEL, marginBottom: 4 }}>
                      Narrative (optional)
                    </label>
                    <textarea
                      value={manualNarrative}
                      onChange={(e) => setManualNarrative(e.target.value)}
                      rows={3}
                      placeholder="Describe what happened on this date..."
                      style={{
                        width: "100%",
                        fontSize: 12,
                        padding: "6px 8px",
                        border: "1px solid var(--color-border-medium)",
                        borderRadius: 0,
                        background: "var(--color-bg-primary)",
                        color: "var(--color-text-primary)",
                        fontFamily: "Inter, sans-serif",
                        resize: "vertical",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <button
                    onClick={addManualEvent}
                    disabled={!manualDate || !manualSubject.trim()}
                    style={{
                      alignSelf: "flex-start",
                      fontSize: 11,
                      padding: "6px 16px",
                      background: manualDate && manualSubject.trim()
                        ? ACCENT : "var(--color-border-medium)",
                      color: "#F5F2ED",
                      border: "none",
                      borderRadius: 0,
                      cursor: manualDate && manualSubject.trim()
                        ? "pointer" : "not-allowed",
                      fontFamily: "Inter, sans-serif",
                    }}
                  >
                    Add to Timeline
                  </button>
                </div>
              )}
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
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {pendingEvents.map((pe, idx) => (
                    <div
                      key={pe.doc.id}
                      ref={(el) => { eventRefs.current[pe.doc.id] = el; }}
                      style={{ display: "flex", gap: 0 }}
                    >
                      {/* Timeline spine */}
                      <div style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        width: 32,
                        flexShrink: 0,
                        paddingTop: 18,
                      }}>
                        <div style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: pe.approved ? "var(--color-success)" : ACCENT,
                          flexShrink: 0,
                          zIndex: 1,
                        }} />
                        {idx < pendingEvents.length - 1 && (
                          <div style={{
                            width: 1,
                            flex: 1,
                            minHeight: 24,
                            background: "var(--color-border-medium)",
                            marginTop: 4,
                          }} />
                        )}
                      </div>
                      {/* Event card */}
                      <div
                        style={{
                          flex: 1,
                          border: `1px solid ${pe.approved ? "var(--color-success)" : "var(--color-border-medium)"}`,
                          padding: 16,
                          background: "var(--color-bg-secondary)",
                          position: "relative",
                          marginBottom: idx < pendingEvents.length - 1 ? 0 : 16,
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
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════
            NORMAL MODE — right panel
            ════════════════════════════════════════ */}
        {!createMode && !editMode && (
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
                    {editingTitle ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="text"
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveTitle();
                            if (e.key === "Escape") setEditingTitle(false);
                          }}
                          autoFocus
                          style={{
                            fontFamily: "Playfair Display, Georgia, serif",
                            fontSize: 16,
                            fontWeight: 500,
                            color: "var(--color-text-primary)",
                            background: "var(--color-bg-secondary)",
                            border: "1px solid var(--color-accent)",
                            borderRadius: 0,
                            padding: "3px 8px",
                            outline: "none",
                            minWidth: 200,
                          }}
                        />
                        <button
                          onClick={handleSaveTitle}
                          disabled={savingTitle || !titleDraft.trim()}
                          style={{
                            fontSize: 11, padding: "4px 12px",
                            background: titleDraft.trim() ? "var(--color-accent)" : "var(--color-border-medium)",
                            color: "#F5F2ED", border: "none", borderRadius: 0,
                            cursor: savingTitle || !titleDraft.trim() ? "not-allowed" : "pointer",
                            fontFamily: "Inter, sans-serif",
                          }}
                        >
                          {savingTitle ? "..." : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingTitle(false)}
                          style={{
                            fontSize: 11, padding: "4px 10px",
                            background: "none",
                            color: "var(--color-text-secondary)",
                            border: "1px solid var(--color-border-light)",
                            borderRadius: 0, cursor: "pointer",
                            fontFamily: "Inter, sans-serif",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <p style={{
                            fontFamily: "Playfair Display, Georgia, serif",
                            fontSize: 16,
                            fontWeight: 500,
                            color: "var(--color-text-primary)",
                            margin: 0,
                          }}>
                            {selected.title}
                          </p>
                          <button
                            onClick={() => {
                              setTitleDraft(selected.title);
                              setEditingTitle(true);
                            }}
                            title="Edit title"
                            style={{
                              fontSize: 10,
                              color: "var(--color-text-secondary)",
                              background: "none", border: "none",
                              cursor: "pointer",
                              fontFamily: "Inter, sans-serif",
                              textDecoration: "underline",
                              padding: 0,
                            }}
                          >
                            Edit
                          </button>
                        </div>
                        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "2px 0 0", fontFamily: "Inter, sans-serif" }}>
                          {selected.events.length === 1 ? "1 event" : `${selected.events.length} events`}
                        </p>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={enterEditMode}
                    style={{
                      fontSize: 12,
                      background: "none",
                      border: `1px solid ${ACCENT}`,
                      color: ACCENT,
                      borderRadius: 0,
                      padding: "8px 16px",
                      cursor: "pointer",
                      fontFamily: "Inter, sans-serif",
                      flexShrink: 0,
                    }}
                  >
                    Edit Chronology
                  </button>
                  <button
                    onClick={() => {
                      setNormalShowDocPicker((v) => !v);
                      setShowAddEvent(false);
                    }}
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

                {/* Horizontal strip — normal mode */}
                <HorizontalStrip
                  events={selected.events
                    .filter((ev) => ev.is_active)
                    .sort((a, b) => a.event_date > b.event_date ? 1 : -1)
                    .map((ev) => ({
                      id: ev.id,
                      date: new Date(ev.event_date).toLocaleDateString("en-GB", {
                        day: "2-digit", month: "short",
                      }),
                      label: ev.document_ref_id
                        ? ev.event_type.toUpperCase()
                        : ev.event_type.toUpperCase(),
                      approved: !!ev.approved_narrative,
                      isKey: ev.is_key_event,
                    }))}
                  onClickEvent={scrollToEvent}
                />

                {/* Add event doc picker */}
                {normalShowDocPicker && (
                  <div style={{
                    padding: "14px 20px",
                    borderBottom: "0.5px solid var(--color-border-medium)",
                    background: "var(--color-bg-secondary)",
                  }}>
                    {/* Doc search */}
                    <div ref={normalDocPickerRef} style={{ position: "relative", marginBottom: 8 }}>
                      <input
                        type="text"
                        placeholder={loadingDocs ? "Loading..." : "Search RFI or Correspondence..."}
                        value={normalDocSearch}
                        disabled={loadingDocs}
                        onChange={(e) => { setNormalDocSearch(e.target.value); setNormalShowDocDropdown(true); }}
                        onFocus={() => setNormalShowDocDropdown(true)}
                        style={{
                          width: "100%",
                          fontSize: 12,
                          padding: "7px 10px",
                          border: "1px solid var(--color-border-medium)",
                          borderRadius: 0,
                          background: "var(--color-bg-primary)",
                          color: "var(--color-text-primary)",
                          fontFamily: "Inter, sans-serif",
                          boxSizing: "border-box",
                        }}
                      />
                      {normalShowDocDropdown && normalFilteredDocs.length > 0 && (
                        <div style={{
                          position: "absolute",
                          top: "100%", left: 0, right: 0,
                          zIndex: 200,
                          background: "var(--color-bg-primary)",
                          border: "1px solid var(--color-border-medium)",
                          maxHeight: 200,
                          overflowY: "auto",
                        }}>
                          {normalFilteredDocs.map((doc) => (
                            <div
                              key={doc.id}
                              onClick={() => handleAddDocEvent(doc)}
                              style={{
                                padding: "8px 12px",
                                borderBottom: "0.5px solid var(--color-border-light)",
                                cursor: "pointer",
                                display: "flex",
                                gap: 8,
                              }}
                            >
                              <span style={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-secondary)", minWidth: 70 }}>
                                {doc.ref_number}
                              </span>
                              <div>
                                <p style={{ fontSize: 12, color: "var(--color-text-primary)", margin: 0, fontFamily: "Inter, sans-serif" }}>{doc.subject}</p>
                                <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "1px 0 0", fontFamily: "Inter, sans-serif" }}>
                                  {doc.date} · {doc.type.toUpperCase()}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Manual entry toggle */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        onClick={() => setNormalShowManualEntry((v) => !v)}
                        style={{
                          fontSize: 11, color: "var(--color-text-secondary)",
                          background: "none", border: "1px solid var(--color-border-light)",
                          borderRadius: 0, padding: "3px 10px", cursor: "pointer",
                          fontFamily: "Inter, sans-serif",
                        }}
                      >
                        {normalShowManualEntry ? "Cancel manual" : "+ Manual entry"}
                      </button>
                      <button
                        onClick={() => {
                          setNormalShowDocPicker(false);
                          setNormalShowManualEntry(false);
                          setNormalDocSearch("");
                        }}
                        style={{
                          fontSize: 11, color: "var(--color-text-secondary)",
                          background: "none", border: "none",
                          cursor: "pointer", fontFamily: "Inter, sans-serif",
                        }}
                      >
                        Close
                      </button>
                    </div>
                    {/* Manual entry form */}
                    {normalShowManualEntry && (
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div>
                            <label style={{ ...SECTION_LABEL, marginBottom: 3 }}>Date *</label>
                            <input
                              type="date"
                              value={normalManualDate}
                              onChange={(e) => setNormalManualDate(e.target.value)}
                              style={{
                                width: "100%", fontSize: 12, padding: "5px 8px",
                                border: "1px solid var(--color-border-medium)",
                                borderRadius: 0, background: "var(--color-bg-primary)",
                                color: "var(--color-text-primary)",
                                fontFamily: "Inter, sans-serif", boxSizing: "border-box",
                              }}
                            />
                          </div>
                          <div>
                            <label style={{ ...SECTION_LABEL, marginBottom: 3 }}>Type</label>
                            <select
                              value={normalManualType}
                              onChange={(e) => setNormalManualType(e.target.value)}
                              style={{
                                width: "100%", fontSize: 12, padding: "5px 8px",
                                border: "1px solid var(--color-border-medium)",
                                borderRadius: 0, background: "var(--color-bg-primary)",
                                color: "var(--color-text-primary)",
                                fontFamily: "Inter, sans-serif", boxSizing: "border-box",
                              }}
                            >
                              {Object.entries(MANUAL_EVENT_TYPE_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <input
                          type="text"
                          value={normalManualSubject}
                          onChange={(e) => setNormalManualSubject(e.target.value)}
                          placeholder="Description *"
                          style={{
                            fontSize: 12, padding: "5px 8px",
                            border: "1px solid var(--color-border-medium)",
                            borderRadius: 0, background: "var(--color-bg-primary)",
                            color: "var(--color-text-primary)",
                            fontFamily: "Inter, sans-serif", boxSizing: "border-box",
                            width: "100%",
                          }}
                        />
                        <textarea
                          value={normalManualNarrative}
                          onChange={(e) => setNormalManualNarrative(e.target.value)}
                          rows={2}
                          placeholder="Narrative (optional)"
                          style={{
                            fontSize: 12, padding: "5px 8px",
                            border: "1px solid var(--color-border-medium)",
                            borderRadius: 0, background: "var(--color-bg-primary)",
                            color: "var(--color-text-primary)",
                            fontFamily: "Inter, sans-serif",
                            resize: "vertical", boxSizing: "border-box", width: "100%",
                          }}
                        />
                        <button
                          onClick={handleAddNormalManualEvent}
                          disabled={!normalManualDate || !normalManualSubject.trim()}
                          style={{
                            alignSelf: "flex-start", fontSize: 11, padding: "5px 14px",
                            background: normalManualDate && normalManualSubject.trim()
                              ? ACCENT : "var(--color-border-medium)",
                            color: "#F5F2ED", border: "none", borderRadius: 0,
                            cursor: normalManualDate && normalManualSubject.trim()
                              ? "pointer" : "not-allowed",
                            fontFamily: "Inter, sans-serif",
                          }}
                        >
                          Add to Timeline
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Event timeline */}
                <div ref={timelineScrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                  {selected.events.length === 0 && (
                    <p style={{ fontSize: 13, color: "var(--color-text-secondary)", fontStyle: "italic", fontFamily: "Inter, sans-serif" }}>
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
                          <button
                            onClick={() => handleInactivate(ev.id)}
                            disabled={inactivatingId === ev.id}
                            title="Remove event"
                            style={{
                              fontSize: 12, color: "var(--color-text-secondary)",
                              background: "none", border: "none",
                              cursor: inactivatingId === ev.id ? "wait" : "pointer",
                              fontFamily: "Inter, sans-serif", padding: "0 4px",
                              marginLeft: "auto",
                            }}
                          >
                            ×
                          </button>
                        </div>

                        {/* Approved narrative */}
                        {ev.approved_narrative && editingApprovedId !== ev.id && (
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                              <p style={SECTION_LABEL}>Approved Narrative</p>
                              <button
                                onClick={() => {
                                  setEditingApprovedId(ev.id);
                                  setEditingApprovedText((prev) => ({ ...prev, [ev.id]: ev.approved_narrative ?? "" }));
                                }}
                                style={{
                                  fontSize: 10, color: "var(--color-text-secondary)",
                                  background: "none", border: "none",
                                  cursor: "pointer", fontFamily: "Inter, sans-serif",
                                  textDecoration: "underline",
                                }}
                              >
                                Edit
                              </button>
                            </div>
                            <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6, fontFamily: "Inter, sans-serif", margin: 0 }}>
                              {ev.approved_narrative}
                            </p>
                          </div>
                        )}

                        {ev.approved_narrative && editingApprovedId === ev.id && (
                          <div style={{ marginBottom: 8 }}>
                            <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>Edit Narrative</p>
                            <textarea
                              value={editingApprovedText[ev.id] ?? ev.approved_narrative}
                              onChange={(e) => setEditingApprovedText((prev) => ({ ...prev, [ev.id]: e.target.value }))}
                              rows={4}
                              style={{
                                width: "100%", fontSize: 12, padding: "7px 10px",
                                border: "1px solid var(--color-border-medium)",
                                borderRadius: 0, background: "var(--color-bg-primary)",
                                color: "var(--color-text-primary)",
                                fontFamily: "Inter, sans-serif", resize: "vertical",
                                boxSizing: "border-box",
                              }}
                            />
                            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                              <button
                                onClick={() => handleApproveModified(ev)}
                                disabled={approvingId === ev.id}
                                style={{
                                  fontSize: 11, padding: "5px 14px",
                                  background: ACCENT, color: "#F5F2ED",
                                  border: "none", borderRadius: 0,
                                  cursor: approvingId === ev.id ? "wait" : "pointer",
                                  fontFamily: "Inter, sans-serif",
                                }}
                              >
                                {approvingId === ev.id ? "Saving..." : "✓ Save Changes"}
                              </button>
                              <button
                                onClick={() => {
                                  setEditingApprovedId(null);
                                  setEditingApprovedText((prev) => { const n = { ...prev }; delete n[ev.id]; return n; });
                                }}
                                style={{
                                  fontSize: 11, padding: "5px 12px",
                                  background: "none", color: "var(--color-text-secondary)",
                                  border: "1px solid var(--color-border-light)",
                                  borderRadius: 0, cursor: "pointer",
                                  fontFamily: "Inter, sans-serif",
                                }}
                              >
                                Cancel
                              </button>
                            </div>
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
                          editingApprovedId === ev.id ? (
                            <div>
                              <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>Write Narrative</p>
                              <textarea
                                value={editingApprovedText[ev.id] ?? ""}
                                onChange={(e) => setEditingApprovedText((prev) => ({ ...prev, [ev.id]: e.target.value }))}
                                rows={4}
                                placeholder="Write the narrative for this event..."
                                style={{
                                  width: "100%", fontSize: 12, padding: "7px 10px",
                                  border: "1px solid var(--color-border-medium)",
                                  borderRadius: 0, background: "var(--color-bg-primary)",
                                  color: "var(--color-text-primary)",
                                  fontFamily: "Inter, sans-serif", resize: "vertical",
                                  boxSizing: "border-box",
                                }}
                              />
                              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                                <button
                                  onClick={() => handleApproveModified(ev)}
                                  disabled={approvingId === ev.id || !(editingApprovedText[ev.id] ?? "").trim()}
                                  style={{
                                    fontSize: 11, padding: "5px 14px",
                                    background: (editingApprovedText[ev.id] ?? "").trim()
                                      ? "var(--color-success)" : "var(--color-border-medium)",
                                    color: "#F5F2ED", border: "none", borderRadius: 0,
                                    cursor: (editingApprovedText[ev.id] ?? "").trim()
                                      ? "pointer" : "not-allowed",
                                    fontFamily: "Inter, sans-serif",
                                  }}
                                >
                                  {approvingId === ev.id ? "Saving..." : "✓ Approve Narrative"}
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingApprovedId(null);
                                    setEditingApprovedText((prev) => { const n = { ...prev }; delete n[ev.id]; return n; });
                                  }}
                                  style={{
                                    fontSize: 11, padding: "5px 12px",
                                    background: "none", color: "var(--color-text-secondary)",
                                    border: "1px solid var(--color-border-light)",
                                    borderRadius: 0, cursor: "pointer",
                                    fontFamily: "Inter, sans-serif",
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <p style={{ fontSize: 12, color: "var(--color-text-secondary)", fontStyle: "italic", fontFamily: "Inter, sans-serif", margin: 0 }}>
                                No narrative yet.
                              </p>
                              <button
                                onClick={() => {
                                  setEditingApprovedId(ev.id);
                                  setEditingApprovedText((prev) => ({ ...prev, [ev.id]: "" }));
                                }}
                                style={{
                                  fontSize: 10, color: ACCENT,
                                  background: "none", border: "none",
                                  cursor: "pointer", fontFamily: "Inter, sans-serif",
                                  textDecoration: "underline",
                                }}
                              >
                                Write
                              </button>
                            </div>
                          )
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
