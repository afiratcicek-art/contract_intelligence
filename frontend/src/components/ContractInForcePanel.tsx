/**
 * ContractInForcePanel — Contract & Amendments "in-force" görünümü (ADR-014).
 *
 * BELGE-MERKEZLİ hiyerarşi (Ali'nin kararı 2026-07-20: "madde madde değil,
 * belge belge"): kökte SÖZLEŞME (base, yürürlükte), altında onu değiştiren
 * amendment'lar, altında yürürlükteki change order'lar — hepsi belge kartı.
 * clauses[] payload'da DURUYOR (altta yatan motor; drill-down / ileride RAG)
 * ama dashboard'da düz madde listesi olarak ARTIK render edilmiyor.
 *
 * Salt sunum (DocumentStatsPanel gibi): fetch YOK, veriyi ContractInForceView
 * getirir (GET .../contract/resolution). contract === null iken kök slotunu
 * View'ın mount ettiği ContractSetupForm doldurur (HITL kayıt) — bu panel o
 * durumda kök kartı çizmez.
 *
 * İlke: sistem yürürlüğü ÇIKARSAMAZ — yalnızca CM tarafından kaydedilmiş /
 * onaylanmış gerçekler görünür. change_orders[].status, StatsPanel ile hizalı
 * GÖRÜNEN etiketlerle gösterilir (agreed→Approved, closed→Closed); tam
 * status-vocab birleştirmesi §6'ya ertelendi.
 *
 * Design: inline style + var(--color-*), Inter / JetBrains Mono,
 *         borderRadius 0, 3px sol-accent, DocumentsModule chip stili.
 */
import type { CSSProperties } from "react";
import type {
  ChangeOrderResolution,
  ContractRoot,
  InForceAmendment,
  ResolutionResponse,
} from "../services/api";
import ContractDocumentsSection from "./ContractDocumentsSection";
import DocumentLink from "./DocumentLink";

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  resolution: ResolutionResponse;
  projectId: string; // belge kartlarının PDF click-through'u için (DocumentLink)
  onDocumentsChanged?: () => void; // kök kartta belge/ek eklendikten sonra View reload
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

// Kök kartı: kalın accent kenar + accent-bg — sözleşme sıradan bir liste öğesi
// değil, projenin çıpası (ADR-014). Görsel ağırlık bunu söylemeli.
const ROOT_CARD: CSSProperties = {
  padding: "14px 16px",
  background: "var(--color-bg-secondary)",
  borderLeft: "5px solid var(--color-accent)",
  display: "flex", flexDirection: "column", gap: 10,
};

// Hiyerarşi girintisi: kök altındaki katmanlar sola bağlı bir kılavuz çizgiyle.
const NESTED: CSSProperties = {
  marginLeft: 14,
  paddingLeft: 14,
  borderLeft: "1px solid var(--color-border-light)",
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
// value (defensive). The full status-vocab unification is §6 (deferred).
const STATUS_LABELS: Record<string, string> = {
  agreed: "Approved",
  closed: "Closed",
};

// Taraf rolleri — migration 039 CHECK vocab'ının görünen karşılığı.
const ROLE_LABELS: Record<string, string> = {
  employer:   "İşveren",
  contractor: "Yüklenici",
  engineer:   "Mühendis",
  other:      "Diğer",
};

// Mirrors ProjectDetail.tsx CONTRACT_LABEL / ContractType enum.
const CONTRACT_TYPE_LABELS: Record<string, string> = {
  lump_sum: "Lump Sum",
  remeasure: "Remeasure",
  cost_plus: "Cost Plus",
  target_cost: "Target Cost",
  epc: "EPC",
  epcm: "EPCM",
  framework: "Framework",
  other: "Other",
};

// ── Component ─────────────────────────────────────────────────────────────

export default function ContractInForcePanel({ resolution, projectId, onDocumentsChanged }: Props) {
  // clauses[] bilinçli olarak destructure edilmiyor: madde-seviyesi motor
  // payload'da kalır (drill-down / RAG), dashboard'da render edilmez (ADR-014).
  const { contract, amendments, change_orders } = resolution;

  // Status chip — StatsPanel-aligned display label (agreed→Approved,
  // closed→Closed); raw value as defensive fallback. §6 unifies later.
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

  const pdfLink = (docId: string, text: string) => (
    <DocumentLink
      projectId={projectId}
      docId={docId}
      style={{
        ...MONO,
        color: "var(--color-accent-text)",
        textDecoration: "underline",
        textUnderlineOffset: 2,
      }}
      title="Belgeyi aç"
    >
      {text}
    </DocumentLink>
  );

  // ── Kök: SÖZLEŞME kartı ───────────────────────────────────────────────
  const infoCell = (label: string, value: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 120 }}>
      <span style={{ ...MONO, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: "var(--color-text-primary)", fontFamily: "Inter, sans-serif" }}>
        {value}
      </span>
    </div>
  );

  const rootCard = (c: ContractRoot) => (
    <div style={ROOT_CARD}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          {c.contract_number && <span style={MONO}>{c.contract_number}</span>}
          <span style={{
            fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)",
            fontFamily: "Inter, sans-serif",
          }}>
            {c.title}
          </span>
        </div>
        <span style={{
          ...chipBase,
          background: "var(--color-accent)",
          color: "var(--color-bg-primary)",
        }}>
          Sözleşme · Yürürlükte
        </span>
      </div>

      {c.parties.length > 0 && (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          {c.parties.map((p) => (
            <div key={`${p.role}-${p.name}`}>
              {infoCell(ROLE_LABELS[p.role] ?? p.role, p.name)}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {infoCell("Commencement", c.commencement_date ?? "—")}
        {infoCell("Süre", c.duration_days != null ? `${c.duration_days} gün` : "—")}
        {/* DLP uzunluk olarak saklanır; penceresi FİİLİ tamamlanmadan türetilir
            (ADR-014) — sabit bitiş tarihi göstermek yanlış olurdu. */}
        {infoCell("DLP", c.dlp_days != null ? `${c.dlp_days} gün (fiili tamamlanmadan türetilir)` : "—")}
        {infoCell(
          "Tip",
          c.contract_type
            ? (CONTRACT_TYPE_LABELS[c.contract_type] ?? c.contract_type)
            : "—",
        )}
      </div>

      {/* Belge listesi + Dosya Seç + satır satır ekler (CM-only yazma yolu). */}
      <ContractDocumentsSection
        projectId={projectId}
        contract={c}
        onChanged={onDocumentsChanged ?? (() => {})}
      />
    </div>
  );

  // ── Katman 2: Amendment belge kartları ───────────────────────────────
  const amendmentRow = (a: InForceAmendment) => (
    <div key={a.id} style={ROW}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ ...MONO, color: "var(--color-accent-text)" }}>{a.amendment_number}</span>
        <span style={{
          fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)",
          fontFamily: "Inter, sans-serif",
        }}>
          {a.title}
        </span>
        <span style={{ ...MONO, display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span>{a.amendment_date ?? "—"}</span>
          <span>·</span>
          <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{a.arrival_path}</span>
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {a.source_pdf_id && pdfLink(a.source_pdf_id, "PDF")}
        <span style={{
          ...chipBase,
          background: "var(--color-ai-bg)", color: "var(--color-ai)",
          border: "0.5px solid var(--color-ai)",
        }}>
          Amendment
        </span>
      </div>
    </div>
  );

  // ── Katman 3: Change order kartları ──────────────────────────────────
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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Kök — Sözleşme (contract === null iken kök slotu View'daki
             ContractSetupForm'a aittir; burada kart çizilmez) ── */}
      {contract && rootCard(contract)}

      {/* ── Katman 2 — Amendments ── */}
      <div style={contract ? NESTED : undefined}>
        <p style={SECTION_LABEL}>Amendments</p>
        {amendments.length === 0 ? (
          <p style={EMPTY_STATE}>Kayıtlı amendment yok — sözleşme değişmemiş halde yürürlükte</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {amendments.map(amendmentRow)}
          </div>
        )}
      </div>

      {/* ── Katman 3 — Change Orders ── */}
      <div style={contract ? NESTED : undefined}>
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
