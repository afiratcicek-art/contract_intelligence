/**
 * usePendingEvents — shared hook for create + edit mode (C-01 extract)
 *
 * Owns:
 *   - pendingEvents state + CRUD handlers
 *   - manual entry form state
 *   - doc picker state (linkableDocs, docSearch, showDocDropdown)
 *   - filteredDocs computed value
 *
 * Does NOT own:
 *   - handleSaveChronology / handleSaveEdit (orchestration, stays in module)
 *   - enterEditMode / exitEditMode (mode transitions, stays in module)
 *   - bridge useEffects (depend on createMode, stays in module)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { fetchLinkableDocuments, type LinkableDoc } from "../../services/api";
import type { ToastType } from "../../hooks/useToast";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PendingEvent {
  doc: LinkableDoc;
  narrativeMode: "llm" | "manual" | null;
  manualText: string;
  autoNarrative: string | null;
  loadingLlm: boolean;
  approved: boolean;
  approvedText: string;
  // Edit mode fields
  _isExisting?: boolean;
  _originalNarrative?: string;
  _originalEventType?: string;
  _originalIsKey?: boolean;
  _originalDate?: string;
  _originalSubject?: string;
  editEventType?: string;
  editIsKey?: boolean;
  editDate?: string;
  editSubject?: string;
}

type ShowToastFn = (message: string, type?: ToastType) => void;

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePendingEvents(projectId: string, showToast: ShowToastFn) {
  // ── pendingEvents ──────────────────────────────────────────────────────────
  const [pendingEvents, setPendingEvents] = useState<PendingEvent[]>([]);

  // ── manual entry form ─────────────────────────────────────────────────────
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualDate,      setManualDate]      = useState("");
  const [manualType,      setManualType]      = useState("other");
  const [manualSubject,   setManualSubject]   = useState("");
  const [manualNarrative, setManualNarrative] = useState("");

  // ── doc picker ────────────────────────────────────────────────────────────
  const [linkableDocs,   setLinkableDocs]   = useState<LinkableDoc[]>([]);
  const [loadingDocs,    setLoadingDocs]    = useState(false);
  const [docSearch,      setDocSearch]      = useState("");
  const [showDocDropdown, setShowDocDropdown] = useState(false);
  const docPickerRef = useRef<HTMLDivElement>(null);

  // ── filteredDocs (computed) ───────────────────────────────────────────────
  const filteredDocs = linkableDocs.filter((d) => {
    const q = docSearch.toLowerCase();
    return (
      !pendingEvents.some((e) => e.doc.id === d.id) &&
      (d.ref_number.toLowerCase().includes(q) ||
        d.subject.toLowerCase().includes(q))
    );
  });

  // ── Doc picker outside-click ──────────────────────────────────────────────
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

  // ── Handlers ──────────────────────────────────────────────────────────────

  const addDocToTimeline = useCallback((doc: LinkableDoc) => {
    if (pendingEvents.some((e) => e.doc.id === doc.id)) return;
    setPendingEvents((prev) =>
      [...prev, {
        doc,
        narrativeMode: null,
        manualText: "",
        autoNarrative: null,
        loadingLlm: false,
        approved: false,
        approvedText: "",
      }].sort((a, b) => (a.doc.date > b.doc.date ? 1 : -1))
    );
    setDocSearch("");
    setShowDocDropdown(false);
  }, [pendingEvents]);

  const addManualEvent = () => {
    if (!manualDate || !manualSubject.trim()) return;
    const fakeId = `manual-${Date.now()}`;
    setPendingEvents((prev) =>
      [...prev, {
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
      }].sort((a, b) => (a.doc.date > b.doc.date ? 1 : -1))
    );
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
    setPendingEvents((prev) =>
      prev.map((e) => (e.doc.id === docId ? { ...e, ...patch } : e))
    );
  };

  const requestLlmNarrative = (_pe: PendingEvent) => {
    // TB-22: implement narrative-preview endpoint
    updatePending(_pe.doc.id, { narrativeMode: "manual" });
    showToast(
      "LLM narrative preview is coming soon. Please write the narrative manually for now.",
      "info"
    );
  };

  // ── Lifecycle helpers (called by module on mode transitions) ──────────────

  /** Clear all pending events (exitCreate / exitEdit) */
  const resetPendingEvents = () => setPendingEvents([]);

  /** Load linkable docs on demand (called when entering create/edit mode) */
  const loadLinkableDocs = useCallback(() => {
    setLoadingDocs(true);
    fetchLinkableDocuments(projectId)
      .then(setLinkableDocs)
      .catch(() => setLinkableDocs([]))
      .finally(() => setLoadingDocs(false));
  }, [projectId]);

  /** Pre-fill from bridge IDs (called by bridge useEffect in module) */
  const prefillFromBridge = useCallback((ids: string[]) => {
    const toAdd = linkableDocs.filter((d) => ids.includes(d.id));
    if (!toAdd.length) return;
    setPendingEvents(
      toAdd
        .map((doc) => ({
          doc,
          narrativeMode: null as null,
          manualText: "",
          autoNarrative: null,
          loadingLlm: false,
          approved: false,
          approvedText: "",
        }))
        .sort((a, b) => (a.doc.date > b.doc.date ? 1 : -1))
    );
  }, [linkableDocs]);

  return {
    // pendingEvents
    pendingEvents,
    setPendingEvents,
    addDocToTimeline,
    addManualEvent,
    removeFromTimeline,
    updatePending,
    requestLlmNarrative,
    resetPendingEvents,
    loadLinkableDocs,
    prefillFromBridge,
    // manual entry
    showManualEntry, setShowManualEntry,
    manualDate,      setManualDate,
    manualType,      setManualType,
    manualSubject,   setManualSubject,
    manualNarrative, setManualNarrative,
    // doc picker
    linkableDocs, loadingDocs,
    docSearch,    setDocSearch,
    showDocDropdown, setShowDocDropdown,
    docPickerRef,
    filteredDocs,
  };
}
