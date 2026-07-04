import { useState, useEffect, useRef } from "react";

export interface StripEvent {
  id: string;
  date: string;
  label: string;
  approved: boolean;
  isKey?: boolean;
  narrative?: string | null;
  subject?: string | null;
}

function HorizontalStrip({
  events,
  onClickEvent,
}: {
  events: StripEvent[];
  onClickEvent: (id: string) => void;
}) {
  const [popupId, setPopupId] = useState<string | null>(null);
  const [popupLeft, setPopupLeft] = useState<number>(20);
  const popupRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popupId) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node)
      ) {
        setPopupId(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [popupId]);

  if (events.length === 0) return null;

  const activeEvent = events.find((e) => e.id === popupId) ?? null;

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      {/* Narrative popup */}
      {popupId && activeEvent && (
        <div
          ref={popupRef}
          style={{
            position: "absolute",
            top: 76,
            left: popupLeft,
            zIndex: "var(--z-dropdown)" as unknown as number,
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-medium)",
            padding: "12px 14px",
            minWidth: 240,
            maxWidth: 380,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            resize: "both",
            overflow: "auto",
            minHeight: 80,
            maxHeight: 300,
          }}
        >
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}>
            <p style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-text-secondary)",
              fontFamily: "Inter, sans-serif",
              margin: 0,
            }}>
              {activeEvent.label} · {activeEvent.date}
            </p>
            <button
              onClick={() => setPopupId(null)}
              style={{
                fontSize: 14,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-secondary)",
                padding: "0 2px",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          {activeEvent.subject && (
            <p style={{
              fontSize: 11,
              color: "var(--color-text-secondary)",
              fontStyle: "italic",
              fontFamily: "Inter, sans-serif",
              margin: "0 0 6px",
            }}>
              {activeEvent.subject}
            </p>
          )}
          {activeEvent.narrative ? (
            <p style={{
              fontSize: 12,
              color: "var(--color-text-primary)",
              lineHeight: 1.6,
              fontFamily: "Inter, sans-serif",
              margin: 0,
            }}>
              {activeEvent.narrative}
            </p>
          ) : (
            <p style={{
              fontSize: 12,
              color: "var(--color-text-secondary)",
              fontStyle: "italic",
              fontFamily: "Inter, sans-serif",
              margin: 0,
            }}>
              No narrative yet.
            </p>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          overflowX: "auto",
          borderBottom: "0.5px solid var(--color-border-medium)",
          background: "var(--color-bg-secondary)",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          gap: 0,
          minHeight: 72,
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
      {events.map((ev, idx) => (
        <div
          key={ev.id}
          style={{ display: "flex", alignItems: "center" }}
        >
          {/* Node */}
          <div
            onClick={(e) => {
              if (popupId === ev.id) {
                setPopupId(null);
              } else {
                const rect = (e.currentTarget as HTMLElement)
                  .getBoundingClientRect();
                const containerRect = containerRef.current
                  ?.getBoundingClientRect();
                const relativeLeft = containerRect
                  ? rect.left - containerRect.left
                  : 20;
                const containerWidth = containerRect?.width ?? 600;
                const popupWidth = 280;
                const clampedLeft = Math.min(
                  Math.max(0, relativeLeft - popupWidth / 2),
                  containerWidth - popupWidth - 8
                );
                setPopupLeft(clampedLeft);
                setPopupId(ev.id);
                onClickEvent(ev.id);
              }
            }}
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
              fontSize: 11,
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
              fontSize: 11,
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
    </div>
  );
}

export default HorizontalStrip;
