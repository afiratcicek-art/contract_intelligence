/**
 * ContractInForcePanel — Contract & Amendments "in-force" görünümü (B3).
 *
 * Salt sunum (DocumentStatsPanel gibi): tek prop `resolution`, fetch YOK.
 * Veriyi ContractInForceView getirir. Kaynak: GET .../contract/resolution.
 *
 * İlke: sistem yürürlüğü ÇIKARSAMAZ — yalnızca CM tarafından onaylanmış
 * gerçekler (kayıtlı amendment'lar + status='confirmed' override'lar) grafiği
 * sürer. change_orders[].status, StatsPanel ile hizalı GÖRÜNEN etiketlerle
 * gösterilir (agreed→Approved, closed→Closed); tam status-vocab birleştirmesi
 * §6'ya ertelendi.
 *
 * Design: inline style + var(--color-*), Inter / JetBrains Mono,
 *         borderRadius 0, 3px sol-accent, DocumentsModule chip stili.
 */
import type { CSSProperties } from "react";
import type {
  AmendmentRef,
  ChangeOrderResolution,
  ClauseResolution,
  ResolutionResponse,
} from "../services/api";

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  resolution: ResolutionResponse;
}

// ── Styles ────────────────────────────────────────────────────────────────

const SECTION_LABEL: CSSProperties = {
  fontSize: 11, fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-secondary)",
  fontFamily: "Inter, sans-serif",
  marginBottom: 8,
};

const EMPTY_STATE: CSSProperties = {
  fontSize: 12, fontStyle: "italic",
  color: "var(--color-text-secondary)",
  fontFamily: "Inter, sans-serif",
  padding: "8px 0",
};

const ROW: CSSProperties = {
  display: "flex", alignItems: "center",
  justifyContent: "space-between", gap: 12,
  padding: "8px 12px",
  background: "var(--color-bg-secondary)",
  marginBottom: 2,
  borderLeft: "3px solid var(--color-accent)",
};

const MONO: CSSProperties = {
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 11,
  color: "var(--color-text-secondary)",
};

// A neutral chip base (mirrors DocumentsModule.tsx:277-295 status chip shape).
const chipBase: CSSProperties = {
  fontSize: 11, fontWeight: 500, padding: "2px 8px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontFamily: "Inter, sans-serif",
  whiteSpace: "nowrap",
};

// Status → house colour tokens (COLOUR only; the displayed TEXT comes from
// STATUS_LABELS below). Unknown statuses fall back to neutral.
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  identified:        { bg: "var(--color-bg-secondary)", color: "var(--color-text-secondary)" },
  notified:          { bg: "var(--color-warning-bg)",   color: "var(--color-warning)" },
  impact_submitted:  { bg: "var(--color-warning-bg)",   color: "var(--color-warning)" },
  under_negotiation: { bg: "var(--color-warning-bg)",   color: "var(--color-warning)" },
  agreed:            { bg: "var(--color-success-bg)",   color: "var(--color-success)" },
  disputed:          { bg: "var(--color-alert-red-bg)", color: "var(--color-alert-red)" },
  closed:            { bg: "var(--color-success-bg)",   color: "var(--color-success)" },
};

// Small frontend display map mirroring the StatsPanel vocab (documents.py:833-837).
// Only agreed/closed reach the In-Force view; anything else falls back to its raw
// value (defensive). The full status-vocab unification is §6 (deferred,
// single-source-of-truth later).
const STATUS_LABELS: Record<string, string> = {
  agreed: "Approved",
  closed: "Closed",
};

// ── Component ─────────────────────────────────────────────────────────────

export default function ContractInForcePanel({ resolution }: Props) {
  const { clauses, change_orders } = resolution;

  // Status chip — StatsPanel-aligned display label (agreed→Approved, closed→Closed);
  // raw value as defensive fallback. §6 will unify the vocab at a single source.
  const statusChip = (status: string) => {
    const c = STATUS_COLORS[status] ?? {
      bg: "var(--color-bg-secondary)", color: "var(--color-text-secondary)",
    };
    return (
      <span style={{ ...chipBase, background: c.bg, color: c.color }}>
        {STATUS_LABELS[status] ?? status}
      </span>
    );
  };

  const instrumentChip = (instrument: "contract" | "amendment") => {
    const isAmendment = instrument === "amendment";
    return (
      <span style={{
        ...chipBase,
        background: isAmendment ? "var(--color-accent)" : "var(--color-bg-secondary)",
        color: isAmendment ? "var(--color-bg-primary)" : "var(--color-text-secondary)",
        border: isAmendment ? "none" : "0.5px solid var(--color-border-light)",
      }}>
        {instrument}
      </span>
    );
  };

  // Provenance line for a winning amendment (number · date · arrival_path).
  const provenance = (a: AmendmentRef) => (
    <span style={{ ...MONO, display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ color: "var(--color-accent-text)" }}>{a.amendment_number}</span>
      <span>·</span>
      <span>{a.amendment_date ?? "—"}</span>
      <span>·</span>
      <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{a.arrival_path}</span>
    </span>
  );

  // ── Section A: Clauses ────────────────────────────────────────────────
  const clauseRow = (c: ClauseResolution) => (
    <div key={c.override_id ?? c.subject_key} style={ROW}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{
          fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)",
          fontFamily: "Inter, sans-serif",
        }}>
          {c.subject_key}
        </span>
        {c.governing_instrument === "amendment" && c.amendment && provenance(c.amendment)}
      </div>
      {instrumentChip(c.governing_instrument)}
    </div>
  );

  // ── Section B: Change Orders ──────────────────────────────────────────
  const changeRow = (c: ChangeOrderResolution) => (
    <div key={c.change_id} style={{ ...ROW, alignItems: "flex-start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={MONO}>{c.change_number}</span>
        <span style={{
          fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)",
          fontFamily: "Inter, sans-serif",
        }}>
          {c.title}
        </span>
        {c.superseded_by_amendment && (
          <span style={{
            ...chipBase,
            textTransform: "none",
            alignSelf: "flex-start",
            background: "var(--color-ai-bg)", color: "var(--color-ai)",
            border: "0.5px solid var(--color-ai)",
          }}>
            Amendment ile yönetiliyor: {c.superseded_by_amendment.amendment_number}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {c.amendment_pending && (
          <span style={{
            ...chipBase,
            textTransform: "none",
            background: "var(--color-warning-bg)", color: "var(--color-warning)",
          }}>
            kabul edildi, amendment bekliyor
          </span>
        )}
        {statusChip(c.status)}
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

      {/* ── Section A — Clauses ── */}
      <div>
        <p style={SECTION_LABEL}>Yürürlükteki Maddeler</p>
        {clauses.length === 0 ? (
          <p style={EMPTY_STATE}>Yürürlükte madde-seviyesi override yok</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {clauses.map(clauseRow)}
          </div>
        )}
      </div>

      {/* ── Section B — Change Orders ── */}
      <div>
        <p style={SECTION_LABEL}>Değişiklik Emirleri</p>
        {change_orders.length === 0 ? (
          <p style={EMPTY_STATE}>Yürürlükte değişiklik emri yok</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {change_orders.map(changeRow)}
          </div>
        )}
      </div>

    </div>
  );
}
