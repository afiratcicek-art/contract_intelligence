/**
 * mappers.ts — chronology data transform helpers (C-01 extract)
 * Pure functions, zero side effects, fully testable.
 */
import type { ChronologyEvent } from "../../types/chronology";
import type { PendingEvent } from "./usePendingEvents";
import type { StripEvent } from "./HorizontalStrip";

/** pendingEvents → HorizontalStrip events (create + edit mode) */
export function toPendingStripEvents(events: PendingEvent[]): StripEvent[] {
  return events.map((pe) => ({
    id: pe.doc.id,
    date: pe.doc.date
      ? new Date(pe.doc.date).toLocaleDateString("en-GB", {
          day: "2-digit", month: "short",
        })
      : "",
    label:
      pe.doc.ref_number !== "MANUAL"
        ? pe.doc.ref_number
        : pe.doc.subject.slice(0, 12),
    approved: pe.approved,
    isKey: false,
  }));
}

/** saved ChronologyEvent[] → HorizontalStrip events (normal view) */
export function toSavedStripEvents(events: ChronologyEvent[]): StripEvent[] {
  return events
    .filter((ev) => ev.is_active)
    .sort((a, b) => a.event_date.localeCompare(b.event_date))
    .map((ev) => ({
      id: ev.id,
      date: new Date(ev.event_date).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short",
      }),
      label: ev.event_type.toUpperCase(),
      approved: !!ev.approved_narrative,
      isKey: ev.is_key_event,
      narrative: ev.approved_narrative ?? ev.auto_narrative ?? null,
      subject: ev.subject ?? null,
    }));
}

/** saved ChronologyEvent[] → PendingEvent[] (enterEditMode pre-fill) */
export function chronologyEventsToPending(
  events: ChronologyEvent[]
): PendingEvent[] {
  return events
    .filter((ev) => ev.is_active)
    .sort((a, b) => a.event_date.localeCompare(b.event_date))
    .map((ev) => ({
      doc: {
        id: ev.id,
        type: ev.document_ref_type === "rfi" || ev.document_ref_type === "correspondence"
          ? ev.document_ref_type
          : null,
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
      manualEventType: ev.document_ref_type ? undefined : ev.event_type,
      narrativeMode: ev.approved_narrative ? ("manual" as const) : null,
      manualText: ev.approved_narrative ?? "",
      autoNarrative: ev.auto_narrative,
      loadingLlm: false,
      approved: !!ev.approved_narrative,
      approvedText: ev.approved_narrative ?? "",
      _isExisting: true,
      _originalNarrative: ev.approved_narrative ?? "",
      _originalEventType: ev.event_type,
      _originalIsKey: ev.is_key_event,
      _originalDate: ev.event_date,
      _originalSubject: ev.subject ?? "",
      editEventType: ev.event_type,
      editIsKey: ev.is_key_event,
      editDate: ev.event_date,
      editSubject: ev.subject ?? "",
    }));
}

/** Single PendingEvent → addChronologyEvent payload (create + edit new events) */
export function buildEventPayload(pe: PendingEvent) {
  const docType = pe.doc.type;
  const isManual = docType === null;
  return {
    event_date: pe.doc.date,
    event_type: docType === null ? (pe.manualEventType ?? "other") : docType,
    document_ref_id:  isManual ? undefined : pe.doc.id,
    document_ref_type: docType === null ? undefined : docType,
    manual_narrative: pe.approved
      ? pe.approvedText || pe.autoNarrative || pe.manualText || undefined
      : undefined,
    subject: isManual ? pe.doc.subject : undefined,
  };
}
