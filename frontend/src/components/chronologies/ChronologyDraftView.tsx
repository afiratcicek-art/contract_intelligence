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
import { MANUAL_EVENT_TYPES } from "../../types/chronology";
import { useLanguage } from "../../context/LanguageContext";
import { formatDate } from "../../utils/format";
import AiActionButton from "../AiActionButton";
import Button from "../Button";
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
  fontFamily: "var(--font-ui)",
};

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
  const { t, lang } = useLanguage();

  const eventCountLabel = (n: number) =>
    n === 1
      ? t("chrono.eventcount_one")
      : t("chrono.eventcount_other").replace("{n}", String(n));

  // Backend may send a type outside MANUAL_EVENT_TYPES — show it raw
  // rather than the unresolved key.
  const eventTypeLabel = (type: string) => {
    const key = `chrono.evt.${type}`;
    const label = t(key);
    return label === key ? type : label;
  };

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
            fontFamily: "var(--font-brand)",
            fontSize: "var(--type-h1)", fontWeight: 500,
            color: "var(--color-text-primary)", margin: 0,
          }}>
            {isCreate ? t("chrono.newchronology") : t("chrono.editchronology")}
          </h2>
          <div style={{ display: "flex", gap: 10 }}>
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={saving || (isCreate && !title.trim())}
              loading={saving}
              loadingText={t("state.saving")}
            >
              {isCreate ? t("chrono.savechronology") : t("chrono.savechanges")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onCancel}
              disabled={saving}
            >
              {t("action.cancel")}
            </Button>
          </div>
        </div>

        {/* Title input */}
        <div style={{ marginBottom: 20 }}>
          <p style={SECTION_LABEL}>
            {t("col.title")}{isCreate && (
              <span style={{ color: ACCENT_TEXT }}> *</span>
            )}
          </p>
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={t("chrono.ph.title")}
            style={{
              width: "100%", padding: "10px 14px",
              border: "1px solid var(--color-border-light)",
              background: "var(--color-bg-secondary)",
              color: "var(--color-text-primary)",
              fontSize: 13, borderRadius: 0,
              boxSizing: "border-box" as const,
              fontFamily: "var(--font-ui)",
            }}
          />
        </div>

        {/* Doc picker */}
        <div style={{ marginBottom: 16 }}>
          <p style={SECTION_LABEL}>{t("chrono.adddocuments")}</p>
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
                ? t("state.loading")
                : t("chrono.ph.search")}
              style={{
                width: "100%", padding: "8px 14px",
                border: "1px solid var(--color-border-light)",
                background: "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
                fontSize: 12, borderRadius: 0,
                boxSizing: "border-box" as const,
                fontFamily: "var(--font-ui)",
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
                        fontFamily: "var(--font-ui)",
                      }}
                    >
                      <span style={{
                        fontFamily: "var(--font-meta)",
                        fontSize: 11, color: "var(--color-text-secondary)",
                      }}>
                        {doc.ref_number}
                      </span>
                      {" "}{doc.subject}
                      {already && (
                        <span style={{ marginLeft: 8, color: "var(--color-success)" }}>
                          {t("chrono.added")}
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
              fontFamily: "var(--font-ui)",
            }}
          >
            {showManualEntry ? t("chrono.cancelmanual") : t("chrono.addmanual")}
          </button>
        </div>

        {/* Manual entry form */}
        {showManualEntry && (
          <div style={{
            padding: 16, marginBottom: 16,
            border: "1px solid var(--color-border-light)",
            background: "var(--color-bg-secondary)",
          }}>
            <p style={SECTION_LABEL}>{t("chrono.manualentry")}</p>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr",
              gap: 12, marginBottom: 12,
            }}>
              <div>
                <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>{t("col.date")}</p>
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
                    fontFamily: "var(--font-ui)",
                  }}
                />
              </div>
              <div>
                <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>{t("col.type")}</p>
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
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  {MANUAL_EVENT_TYPES.map((k) => (
                    <option key={k} value={k}>{eventTypeLabel(k)}</option>
                  ))}
                </select>
              </div>
            </div>
            <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>{t("col.subject")}</p>
            <input
              value={manualSubject}
              onChange={(e) => setManualSubject(e.target.value)}
              placeholder={t("chrono.ph.eventsubject")}
              style={{
                width: "100%", padding: "8px 10px", marginBottom: 8,
                border: "1px solid var(--color-border-light)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
                fontSize: 12, borderRadius: 0,
                boxSizing: "border-box" as const,
                fontFamily: "var(--font-ui)",
              }}
            />
            <p style={{ ...SECTION_LABEL, marginBottom: 4 }}>
              {t("chrono.narrative")} {t("common.optional")}
            </p>
            <textarea
              value={manualNarrative}
              onChange={(e) => setManualNarrative(e.target.value)}
              rows={3} placeholder={t("chrono.ph.optionalnarrative")}
              style={{
                width: "100%", padding: "8px 10px", marginBottom: 8,
                border: "1px solid var(--color-border-light)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
                fontSize: 12, borderRadius: 0, resize: "vertical",
                boxSizing: "border-box" as const,
                fontFamily: "var(--font-ui)",
              }}
            />
            <Button type="button" size="sm" onClick={addManualEvent}>
              {t("chrono.addtotimeline")}
            </Button>
          </div>
        )}

        {/* Timeline */}
        <p style={SECTION_LABEL}>
          {`${t("chrono.timeline")} — ${eventCountLabel(pendingEvents.length)}`}
        </p>

        {pendingEvents.length === 0 && (
          <p style={{
            fontSize: 12, color: "var(--color-text-secondary)",
            fontStyle: "italic", fontFamily: "var(--font-ui)",
          }}>
            {t("chrono.noevents")} {t("chrono.searchadddocs")}
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
                    fontFamily: "var(--font-meta)",
                    fontSize: 11, color: "var(--color-text-secondary)",
                  }}>
                    {pe.doc.ref_number}
                  </span>
                  {" "}
                  <span style={{
                    fontSize: 11, textTransform: "uppercase",
                    color: "var(--color-text-secondary)",
                    fontFamily: "var(--font-ui)",
                  }}>
                    {pe.doc.type ?? eventTypeLabel(pe.manualEventType ?? "other")}
                  </span>
                  {pe._isExisting && (
                    <span style={{
                      marginLeft: 8, fontSize: 11,
                      color: "var(--color-text-secondary)", fontStyle: "italic",
                      fontFamily: "var(--font-ui)",
                    }}>
                      {t("chrono.existing")}
                    </span>
                  )}
                  <p style={{
                    fontSize: 13, fontWeight: 500,
                    color: "var(--color-text-primary)", margin: "3px 0 0",
                    fontFamily: "var(--font-ui)",
                  }}>
                    {pe.doc.subject}
                  </p>
                  <p style={{
                    fontSize: 11, color: "var(--color-text-secondary)",
                    margin: "2px 0 0", fontFamily: "var(--font-ui)",
                  }}>
                    {pe.doc.date ? formatDate(pe.doc.date, lang) : ""}
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
                          fontFamily: "var(--font-ui)",
                        }}
                      >
                        {MANUAL_EVENT_TYPES.map((k) => (
                          <option key={k} value={k}>{eventTypeLabel(k)}</option>
                        ))}
                      </select>
                      <label style={{
                        display: "flex", alignItems: "center", gap: 4,
                        fontSize: 11, color: "var(--color-text-secondary)",
                        fontFamily: "var(--font-ui)", cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}>
                        <input
                          type="checkbox"
                          checked={pe.editIsKey ?? pe._isExisting ?? false}
                          onChange={(e) => updatePending(pe.doc.id, {
                            editIsKey: e.target.checked,
                          })}
                        />
                        {t("chrono.keyevent")}
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
                            fontFamily: "var(--font-ui)", width: "100%",
                          }}
                        />
                        <input
                          type="text"
                          value={pe.editSubject ?? pe.doc.subject}
                          onChange={(e) => updatePending(pe.doc.id, {
                            editSubject: e.target.value,
                          })}
                          placeholder={t("chrono.ph.description")}
                          style={{
                            fontSize: 11, padding: "3px 6px",
                            border: "1px solid var(--color-border-medium)",
                            borderRadius: 0,
                            background: "var(--color-bg-primary)",
                            color: "var(--color-text-primary)",
                            fontFamily: "var(--font-ui)",
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
                  <AiActionButton
                    disabled={pe.loadingLlm}
                    onClick={() => requestLlmNarrative(pe)}
                  >
                    {pe.loadingLlm ? t("state.generating") : t("chrono.generate")}
                  </AiActionButton>
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
                      fontFamily: "var(--font-ui)",
                    }}
                  >
                    {t("chrono.writemanually")}
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
                    rows={4} placeholder={t("chrono.ph.narrative")}
                    style={{
                      width: "100%", fontSize: 12, padding: "8px 10px",
                      border: "1px solid var(--color-border-medium)",
                      borderRadius: 0, background: "var(--color-bg-primary)",
                      color: "var(--color-text-primary)", resize: "vertical",
                      boxSizing: "border-box" as const,
                      fontFamily: "var(--font-ui)",
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
                      fontWeight: 500, fontFamily: "var(--font-ui)",
                    }}
                  >
                    {t("action.approve")}
                  </button>
                </div>
              )}

              {pe.approved && (
                <div style={{
                  padding: "8px 12px", marginTop: 4,
                  background: "var(--color-success-bg, var(--color-bg-secondary))",
                  border: "1px solid var(--color-success)",
                  fontSize: 12, color: "var(--color-text-primary)",
                  fontFamily: "var(--font-ui)",
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
                    {t("action.edit")}
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
