/**
 * ChronologyDraftView — shared JSX for create + edit mode (C-01 extract)
 *
 * Receives usePendingEvents return as "pending" prop — hook owned by module.
 * Renders: header, title input, doc picker, manual entry form, event cards.
 *
 * mode="create" → "New Chronology" header, title required
 * mode="edit"   → "Edit Chronology" header, title optional
 */
import type { RefObject, MutableRefObject } from "react";
import { MANUAL_EVENT_TYPE_LABELS } from "../../types/chronology";
import HorizontalStrip from "./HorizontalStrip";
import { toPendingStripEvents } from "./mappers";
import type { PendingEvent, usePendingEvents } from "./usePendingEvents";

const ACCENT      = "var(--color-accent)";      // bg, border, stroke
const ACCENT_TEXT = "var(--color-accent-text)"; // color only — WCAG AA
const SECTION_LABEL = {
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "var(--color-text-secondary)",
  fontWeight: 500,
  marginBottom: 10,
  fontFamily: "Inter, sans-serif",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

interface Props {
  mode: "create" | "edit";
  title: string;
  onTitleChange: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  pending: ReturnType<typeof usePendingEvents>;
  scrollToEvent: (id: string) => void;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  eventRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  onRemoveEvent?: (pe: PendingEvent) => void;
}

export default function ChronologyDraftView({
  mode, title, onTitleChange,
  saving, onSave, onCancel,
  pending,
  scrollToEvent, timelineScrollRef, eventRefs,
  onRemoveEvent,
}: Props) {
  const {
    pendingEvents, addDocToTimeline, addManualEvent,
    removeFromTimeline, updatePending, requestLlmNarrative,
    showManualEntry, setShowManualEntry,
    manualDate, setManualDate, manualType, setManualType,
    manualSubject, setManualSubject, manualNarrative, setManualNarrative,
    loadingDocs, docSearch, setDocSearch,
    showDocDropdown, setShowDocDropdown, docPickerRef, filteredDocs,
  } = pending;

  const isCreate = mode === "create";
  const handleRemove = onRemoveEvent ?? ((pe: PendingEvent) => {
    removeFromTimeline(pe.doc.id);
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <HorizontalStrip
        events={toPendingStripEvents(pendingEvents)}
        onClickEvent={scrollToEvent}
      />

      <div
        ref={timelineScrollRef}
        style={{ overflowY: "auto", flex: 1, padding: "24px 32px", minHeight: 0 }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between", marginBottom: 24,
        }}>
          <h2 style={{
            fontFamily: "Playfair Display, Georgia, serif",
            fontSize: 22, fontWeight: 500,
            color: "var(--color-text-primary)", margin: 0,
          }}>
            {isCreate ? "New Chronology" : "Edit Chronology"}
          </h2>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onSave}
              disabled={saving || (isCreate && !title.trim())}
              style={{
                background: (isCreate && !title.trim())
                  ? "var(--color-border-medium)"
                  : ACCENT,
                color: "var(--color-bg-primary)",
                border: "none", padding: "8px 20px",
                fontSize: 12, fontWeight: 500, borderRadius: 0,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
                fontFamily: "Inter, sans-serif",
              }}
            >
              {saving
                ? "Saving..."
                : isCreate ? "Save Chronology" : "Save Changes"}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
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
        <div style={{ marginBottom: 20 }}>
          <p style={SECTION_LABEL}>
            CHRONOLOGY TITLE{isCreate && (
              <span style={{ color: ACCENT_TEXT }}> *</span>
            )}
          </p>
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="e.g. Cephe İşleri Claim Chronology"
            style={{
              width: "100%", padding: "10px 14px",
              border: "1px solid var(--color-border-light)",
              background: "var(--color-bg-secondary)",
              color: "var(--color-text-primary)",
              fontSize: 13, borderRadius: 0,
              boxSizing: "border-box" as const,
              fontFamily: "Inter, sans-serif",
            }}
          />
        </div>

        {/* Doc picker */}
        <div style={{ marginBottom: 16 }}>
          <p style={SECTION_LABEL}>ADD DOCUMENTS TO TIMELINE</p>
          <div ref={docPickerRef} style={{ position: "relative" }}>
            <input
              value={docSearch}
              disabled={loadingDocs}
              onChange={(e) => {
                setDocSearch(e.target.value);
                setShowDocDropdown(true);
              }}
              onFocus={() => setShowDocDropdown(true)}
              placeholder={loadingDocs
                ? "Loading documents..."
                : "Search RFI or Correspondence..."}
              style={{
                width: "100%", padding: "8px 14px",
                border: "1px solid var(--color-border-light)",
                background: "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
                fontSize: 12, borderRadius: 0,
                boxSizing: "border-box" as const,
                fontFamily: "Inter, sans-serif",
              }}
            />
            {showDocDropdown && filteredDocs.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0,
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border-light)",
                zIndex: "var(--z-dropdown)" as unknown as number, maxHeight: 220, overflowY: "auto",
              }}>
                {filteredDocs.map((doc) => {
                  const already = pendingEvents.some((e) => e.doc.id === doc.id);
                  return (
                    <button
                      key={doc.id}
                      onClick={() => !already && addDocToTimeline(doc)}
                      disabled={already}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        padding: "8px 12px", background: "none", border: "none",
                        borderBottom: "1px solid var(--color-border-light)",
                        cursor: already ? "default" : "pointer",
                        fontSize: 12,
                        color: "var(--color-text-primary)",
                        opacity: already ? 0.4 : 1,
                        fontFamily: "Inter, sans-serif",
                      }}
                    >
                      <span style={{
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: 11, color: "var(--color-text-secondary)",
                      }}>
                        {doc.ref_number}
                      </span>
                      {" "}{doc.subject}
                      {already && (
                        <span style={{ marginLeft: 8, color: "var(--color-success)" }}>
                          Added
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowManualEntry((v) => !v)}
            style={{
              marginTop: 8, fontSize: 11, background: "none",
              border: "1px solid var(--color-border-light)",
              color: "var(--color-text-secondary)", cursor: "pointer",
              padding: "4px 12px", borderRadius: 0,
              fontFamily: "Inter, sans-serif",
            }}
          >
            {showManualEntry ? "Cancel manual entry" : "+ Add entry not in system"}
          </button>
        </div>

        {/* Manual entry form */}
        {showManualEntry && (
          <div style={{
            padding: 16, marginBottom: 16,
            border: "1px solid var(--color-border-light)",
            background: "var(--color-bg-secondary)",
          }}>
            <p style={SECTION_LABEL}>MANUAL ENTRY</p>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr",
              gap: 12, marginBottom: 12,
            }}>
              <div>
                <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>DATE</p>
                <input
                  type="date" value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  style={{
                    width: "100%", padding: "8px 10px",
                    border: "1px solid var(--color-border-light)",
                    background: "var(--color-bg-primary)",
                    color: "var(--color-text-primary)",
                    fontSize: 12, borderRadius: 0,
                    boxSizing: "border-box" as const,
                    fontFamily: "Inter, sans-serif",
                  }}
                />
              </div>
              <div>
                <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>TYPE</p>
                <select
                  value={manualType}
                  onChange={(e) => setManualType(e.target.value)}
                  style={{
                    width: "100%", padding: "8px 10px",
                    border: "1px solid var(--color-border-light)",
                    background: "var(--color-bg-primary)",
                    color: "var(--color-text-primary)",
                    fontSize: 12, borderRadius: 0,
                    boxSizing: "border-box" as const,
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  {Object.entries(MANUAL_EVENT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
            <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>SUBJECT</p>
            <input
              value={manualSubject}
              onChange={(e) => setManualSubject(e.target.value)}
              placeholder="Event subject..."
              style={{
                width: "100%", padding: "8px 10px", marginBottom: 8,
                border: "1px solid var(--color-border-light)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
                fontSize: 12, borderRadius: 0,
                boxSizing: "border-box" as const,
                fontFamily: "Inter, sans-serif",
              }}
            />
            <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>
              NARRATIVE (optional)
            </p>
            <textarea
              value={manualNarrative}
              onChange={(e) => setManualNarrative(e.target.value)}
              rows={3} placeholder="Optional narrative..."
              style={{
                width: "100%", padding: "8px 10px", marginBottom: 8,
                border: "1px solid var(--color-border-light)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
                fontSize: 12, borderRadius: 0, resize: "vertical",
                boxSizing: "border-box" as const,
                fontFamily: "Inter, sans-serif",
              }}
            />
            <button
              onClick={addManualEvent}
              style={{
                fontSize: 11, padding: "6px 14px",
                background: ACCENT, color: "var(--color-bg-primary)",
                border: "none", borderRadius: 0,
                cursor: "pointer", fontWeight: 500,
                fontFamily: "Inter, sans-serif",
              }}
            >
              Add to Timeline
            </button>
          </div>
        )}

        {/* Timeline */}
        <p style={SECTION_LABEL}>
          TIMELINE — {pendingEvents.length} EVENT
          {pendingEvents.length !== 1 ? "S" : ""}
        </p>

        {pendingEvents.length === 0 && (
          <p style={{
            fontSize: 12, color: "var(--color-text-secondary)",
            fontStyle: "italic", fontFamily: "Inter, sans-serif",
          }}>
            No events yet. Search and add documents above.
          </p>
        )}

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
                background: pe.approved ? "var(--color-success)" : ACCENT,
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

            <div style={{
              flex: 1,
              marginBottom: 12, padding: 16,
              border: pe.approved
                ? "1px solid var(--color-success)"
                : "1px solid var(--color-border-light)",
              background: "var(--color-bg-secondary)",
            }}>
              {/* Event header */}
              <div style={{
                display: "flex", alignItems: "flex-start",
                justifyContent: "space-between", marginBottom: 8,
              }}>
                <div>
                  <span style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 11, color: "var(--color-text-secondary)",
                  }}>
                    {pe.doc.ref_number}
                  </span>
                  {" "}
                  <span style={{
                    fontSize: 11, textTransform: "uppercase",
                    color: "var(--color-text-secondary)",
                    fontFamily: "Inter, sans-serif",
                  }}>
                    {pe.doc.type ?? (MANUAL_EVENT_TYPE_LABELS[pe.manualEventType ?? "other"] ?? "manual")}
                  </span>
                  {pe._isExisting && (
                    <span style={{
                      marginLeft: 8, fontSize: 11,
                      color: "var(--color-text-secondary)", fontStyle: "italic",
                      fontFamily: "Inter, sans-serif",
                    }}>
                      existing
                    </span>
                  )}
                  <p style={{
                    fontSize: 13, fontWeight: 500,
                    color: "var(--color-text-primary)", margin: "3px 0 0",
                    fontFamily: "Inter, sans-serif",
                  }}>
                    {pe.doc.subject}
                  </p>
                  <p style={{
                    fontSize: 11, color: "var(--color-text-secondary)",
                    margin: "2px 0 0", fontFamily: "Inter, sans-serif",
                  }}>
                    {pe.doc.date ? formatDate(pe.doc.date) : ""}
                  </p>
                </div>

                {/* Edit mode metadata controls */}
                {!isCreate && (
                  <div style={{
                    display: "flex", flexDirection: "column",
                    gap: 6, marginRight: 8, minWidth: 200,
                  }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select
                        value={pe.editEventType ?? pe.manualEventType ?? pe.doc.type ?? "other"}
                        onChange={(e) => updatePending(pe.doc.id, {
                          editEventType: e.target.value,
                        })}
                        style={{
                          fontSize: 11, padding: "3px 6px",
                          border: "1px solid var(--color-border-medium)",
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
                      <label style={{
                        display: "flex", alignItems: "center", gap: 4,
                        fontSize: 11, color: "var(--color-text-secondary)",
                        fontFamily: "Inter, sans-serif", cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}>
                        <input
                          type="checkbox"
                          checked={pe.editIsKey ?? pe._isExisting ?? false}
                          onChange={(e) => updatePending(pe.doc.id, {
                            editIsKey: e.target.checked,
                          })}
                        />
                        Key event
                      </label>
                    </div>
                    {pe.doc.type === null && (
                      <>
                        <input
                          type="date"
                          value={pe.editDate ?? pe.doc.date}
                          onChange={(e) => updatePending(pe.doc.id, {
                            editDate: e.target.value,
                          })}
                          style={{
                            fontSize: 11, padding: "3px 6px",
                            border: "1px solid var(--color-border-medium)",
                            borderRadius: 0,
                            background: "var(--color-bg-primary)",
                            color: "var(--color-text-primary)",
                            fontFamily: "Inter, sans-serif", width: "100%",
                          }}
                        />
                        <input
                          type="text"
                          value={pe.editSubject ?? pe.doc.subject}
                          onChange={(e) => updatePending(pe.doc.id, {
                            editSubject: e.target.value,
                          })}
                          placeholder="Description..."
                          style={{
                            fontSize: 11, padding: "3px 6px",
                            border: "1px solid var(--color-border-medium)",
                            borderRadius: 0,
                            background: "var(--color-bg-primary)",
                            color: "var(--color-text-primary)",
                            fontFamily: "Inter, sans-serif",
                            width: "100%", boxSizing: "border-box",
                          }}
                        />
                      </>
                    )}
                  </div>
                )}

                <button
                  onClick={() => handleRemove(pe)}
                  style={{
                    background: "none", border: "none",
                    cursor: "pointer", fontSize: 16,
                    color: "var(--color-text-secondary)",
                  }}
                >
                  ×
                </button>
              </div>

              {/* Narrative */}
              {!pe.narrativeMode && !pe.approved && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => requestLlmNarrative(pe)}
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      fontSize: 11, padding: "8px 12px",
                      background: "var(--color-ai-bg)",
                      color: "var(--color-ai)",
                      border: "1px solid var(--color-ai)",
                      borderRadius: 6, fontWeight: 500, cursor: "pointer",
                      fontFamily: "Inter, sans-serif",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.5-1.5 4.5-3 6l-1 1H9l-1-1C6.5 13.5 5 11.5 5 9a7 7 0 0 1 7-7z"/>
                    </svg>
                    LLM Narrative
                  </button>
                  <button
                    onClick={() =>
                      updatePending(pe.doc.id, { narrativeMode: "manual" })
                    }
                    style={{
                      fontSize: 11, padding: "8px 12px",
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
                  <textarea
                    value={pe.manualText}
                    onChange={(e) =>
                      updatePending(pe.doc.id, { manualText: e.target.value })
                    }
                    rows={4} placeholder="Write narrative..."
                    style={{
                      width: "100%", fontSize: 12, padding: "8px 10px",
                      border: "1px solid var(--color-border-medium)",
                      borderRadius: 0, background: "var(--color-bg-primary)",
                      color: "var(--color-text-primary)", resize: "vertical",
                      boxSizing: "border-box" as const,
                      fontFamily: "Inter, sans-serif",
                    }}
                  />
                  <button
                    onClick={() =>
                      updatePending(pe.doc.id, {
                        approved: true, approvedText: pe.manualText,
                      })
                    }
                    disabled={!pe.manualText.trim()}
                    style={{
                      marginTop: 8, fontSize: 11, padding: "8px 14px",
                      background: pe.manualText.trim()
                        ? "var(--color-success)"
                        : "transparent",
                      color: pe.manualText.trim()
                        ? "var(--color-bg-primary)"
                        : "var(--color-border-light)",
                      border: `1px solid ${pe.manualText.trim()
                        ? "var(--color-success)"
                        : "var(--color-border-light)"}`,
                      borderRadius: 0,
                      cursor: pe.manualText.trim() ? "pointer" : "not-allowed",
                      fontWeight: 500, fontFamily: "Inter, sans-serif",
                    }}
                  >
                    Approve Narrative
                  </button>
                </div>
              )}

              {pe.approved && (
                <div style={{
                  padding: "8px 12px", marginTop: 4,
                  background: "var(--color-success-bg, var(--color-bg-secondary))",
                  border: "1px solid var(--color-success)",
                  fontSize: 12, color: "var(--color-text-primary)",
                  fontFamily: "Inter, sans-serif",
                }}>
                  ✓ {pe.approvedText || pe.autoNarrative || pe.manualText}
                  <button
                    onClick={() =>
                      updatePending(pe.doc.id, {
                        approved: false, narrativeMode: "manual",
                      })
                    }
                    style={{
                      marginLeft: 12, fontSize: 11, background: "none",
                      border: "none", cursor: "pointer",
                      color: "var(--color-text-secondary)",
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
  );
}
