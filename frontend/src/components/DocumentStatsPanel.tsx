/**
 * DocumentStatsPanel — Documents modülü istatistik paneli.
 *
 * 4 ana kategori:
 *   YAZIŞMALAR   — CORR alt tipleri (tıklanabilir filtre)
 *   RFI LAR      — disiplinler (tıklanabilir filtre)
 *   CONTRACT &
 *   AMENDMENTS   — contract_doc + changes (approved/under_review/disputed)
 *                  + Other Amendments (amendments entity, migration 037)
 *   DİĞER        — kronoloji bağımsız kayıtlar
 *   BELGELER       (rfi/correspondence hariç manual event'ler)
 *
 * Keyword + lokasyon chip'leri altta gösterilir.
 *
 * TB-24: Yeni belge kaynakları eklendiğinde migration 026 +
 *        GET /documents/stats güncellenmeli.
 * Other Amendments — amendments tablosunun gerçek sayısı (migration 037;
 *        backend documents.py other_amendments_count).
 *
 * Design: borderRadius 0, var(--color-accent-text), 8px grid.
 */
import type { CSSProperties } from "react";
import type { DocumentStats } from "../services/api";

// ── Sabit alt tip listeleri ────────────────────────────────────────────────

const CORR_TYPES: Array<{ key: string; label: string }> = [
  { key: "letter",           label: "Letter"           },
  { key: "email",            label: "Email"            },
  { key: "notice",           label: "Notice"           },
  { key: "instruction",      label: "Instruction"      },
  { key: "certificate",      label: "Certificate"      },
  { key: "report",           label: "Report"           },
  { key: "request",          label: "Request"          },
  { key: "other",            label: "Other"            },
];

const RFI_DISCIPLINES: Array<{ key: string; label: string }> = [
  { key: "Civil",         label: "Civil"         },
  { key: "Architectural", label: "Architectural" },
  { key: "Structural",    label: "Structural"    },
  { key: "Mechanical",    label: "Mechanical"    },
  { key: "Electrical",    label: "Electrical"    },
  { key: "Plumbing",      label: "Plumbing"      },
  { key: "Other",         label: "Other"         },
];

// Kronoloji bağımsız kayıtlar — tip→görünen-etiket sözlüğü (satır otoritesi değil;
// satırlar Object.entries(stats.by_chronology_type) ile histogramdan sürülür).
const CHRONOLOGY_INDEPENDENT_TYPES: Record<string, string> = {
  notice:        "Notice",
  submission:    "Submission",
  response:      "Response",
  meeting:       "Meeting / MOM",
  inspection:    "Inspection (WIR/MIR)",
  work_permit:   "Work Permit",
  status_change: "Status Change",
  other:         "Diğer",
  drawing:       "Drawing",
  spec:          "Spec",
  specialist:    "Specialist",
  dispute_step:  "Dispute Step",
};

function chronologyTypeLabel(eventType: string): string {
  return CHRONOLOGY_INDEPENDENT_TYPES[eventType]
    ?? eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export { chronologyTypeLabel };

// ── Props ─────────────────────────────────────────────────────────────────

type StatsFilterType =
  | "corrType"
  | "rfiDiscipline"
  | "keyword"
  | "location"
  | "changeStatus"
  | "amendment"
  | "contractDoc"
  | "chronologyType";

interface Props {
  stats: DocumentStats;
  onFilter: (filterType: StatsFilterType, value: string) => void;
  activeFilter: { type: string; value: string } | null;
}

// ── Styles ────────────────────────────────────────────────────────────────

const SECTION_LABEL: CSSProperties = {
  fontSize: 11, fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-ui)",
  marginBottom: 6,
};

const SUB_SECTION_LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-ui)",
  marginTop: 10,
  marginBottom: 4,
};

// ── Component ─────────────────────────────────────────────────────────────

export default function DocumentStatsPanel({ stats, onFilter, activeFilter }: Props) {
  const isActive = (type: string, value: string) =>
    activeFilter?.type === type && activeFilter?.value === value;

  // Tıklanabilir alt satır (CORR/RFI + Contract & Amendments + Diğer Belgeler)
  const filterRow = (
    label: string,
    count: number,
    filterType: "corrType" | "rfiDiscipline" | "changeStatus" | "amendment" | "contractDoc" | "chronologyType",
    key: string,
    italic = false,
  ) => {
    const active = isActive(filterType, key);
    return (
      <button
        key={`${filterType}:${key}`}
        onClick={() => onFilter(filterType, key)}
        style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "center", width: "100%",
          padding: "4px 0", background: "none", border: "none",
          borderBottom: "1px solid var(--color-border-light)",
          cursor: "pointer", textAlign: "left",
          fontFamily: "var(--font-ui)",
        }}
      >
        <span style={{
          fontSize: 11,
          fontStyle: italic ? "italic" : "normal",
          color: active ? "var(--color-accent)" : count > 0
            ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          fontWeight: active ? 500 : 400,
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 11,
          fontFamily: "var(--font-meta)",
          color: active ? "var(--color-accent)" : count > 0
            ? "var(--color-accent-text)" : "var(--color-text-secondary)",
          fontWeight: active ? 500 : 400,
          minWidth: 20, textAlign: "right",
        }}>
          {count}
        </span>
      </button>
    );
  };

  // Ana kart
  const card = (
    label: string,
    count: number,
    accentLeft: boolean,
    children: React.ReactNode
  ) => (
    <div style={{
      padding: "16px 20px",
      border: "1px solid var(--color-border-light)",
      borderLeft: `3px solid ${accentLeft
        ? "var(--color-accent)"
        : "var(--color-border-medium)"}`,
      background: "var(--color-bg-secondary)",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div>
        <p style={{
          fontFamily: "var(--font-meta)",
          fontSize: 28, fontWeight: 500,
          color: "var(--color-accent-text)", margin: "0 0 4px",
        }}>
          {count}
        </p>
        <p style={{
          ...SECTION_LABEL, margin: 0,
        }}>
          {label}
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );

  // Contract & Amendments toplam
  const contractTotal =
    (stats.contract_doc_count ?? 0) +
    (stats.changes_approved ?? 0) +
    (stats.changes_under_review ?? 0) +
    (stats.changes_disputed ?? 0) +
    (stats.other_amendments_count ?? 0);

  // Diğer Belgeler toplam — locked: manual_count, NOT sum of histogram rows
  const otherTotal = stats.manual_count;

  // Histogram-driven rows (count desc). Label from CHRONOLOGY_INDEPENDENT_TYPES
  // dictionary; unknown keys humanized — never show a bare snake_case key.
  const chronologyRows = Object.entries(stats.by_chronology_type ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return (
    <div style={{ padding: "24px 32px" }}>

      {/* ── Toplam sayaç ── */}
      <div style={{
        padding: "12px 20px", marginBottom: 24,
        border: "1px solid var(--color-border-light)",
        borderLeft: "3px solid var(--color-accent)",
        background: "var(--color-bg-secondary)",
        display: "inline-flex", alignItems: "baseline", gap: 8,
      }}>
        <span style={{
          fontFamily: "var(--font-meta)",
          fontSize: 32, fontWeight: 500,
          color: "var(--color-accent-text)",
        }}>
          {stats.total_count}
        </span>
        <span style={{ ...SECTION_LABEL, margin: 0 }}>
          Toplam Kayıt
        </span>
      </div>

      {/* ── 4 Ana kart ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 16, marginBottom: 32,
      }}>

        {/* YAZIŞMALAR */}
        {card("Yazışmalar", stats.corr_count, true,
          CORR_TYPES.map(({ key, label }) =>
            filterRow(label, stats.by_corr_type[key] ?? 0, "corrType", key)
          )
        )}

        {/* RFI'LAR */}
        {card("RFI'lar", stats.rfi_count, true,
          RFI_DISCIPLINES.map(({ key, label }) =>
            filterRow(label, stats.by_rfi_discipline[key] ?? 0, "rfiDiscipline", key)
          )
        )}

        {/* CONTRACT & AMENDMENTS — govern-record (tıklanabilir).
            §6 vocab bridge lives HERE only: UI bucket label → DB status value(s).
            DocumentsModule/doSearch pass the value through; do not re-map there. */}
        {card("Contract & Amendments", contractTotal, true, <>
          {filterRow("Sözleşmeler", stats.contract_doc_count ?? 0, "contractDoc", "all")}
          <p style={SUB_SECTION_LABEL}>Değişiklikler</p>
          {filterRow("Approved",     stats.changes_approved     ?? 0, "changeStatus", "agreed")}
          {filterRow("Under Review", stats.changes_under_review ?? 0, "changeStatus", "impact_submitted,under_negotiation")}
          {filterRow("Disputed",     stats.changes_disputed     ?? 0, "changeStatus", "disputed")}
          {/* Other Amendments — amendments entity'sinin gerçek sayısı (migration 037) */}
          {filterRow("Other Amendments", stats.other_amendments_count ?? 0, "amendment", "all", true)}
        </>)}

        {/* DİĞER BELGELER — data-driven from by_chronology_type histogram */}
        {card("Diğer Belgeler", otherTotal, true,
          chronologyRows.map(([eventType, count]) =>
            filterRow(
              chronologyTypeLabel(eventType),
              count,
              "chronologyType",
              eventType,
            )
          )
        )}
      </div>

      {/* ── Keyword + Lokasyon chip'leri ── */}
      {(stats.top_keywords.length > 0 || stats.top_locations.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
          {stats.top_keywords.length > 0 && (
            <div>
              <p style={SECTION_LABEL}>Sık Kullanılan Anahtar Kelimeler</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {stats.top_keywords.map((kw) => (
                  <button key={kw} onClick={() => onFilter("keyword", kw)}
                    style={{
                      padding: "6px 12px", borderRadius: 0,
                      border: isActive("keyword", kw)
                        ? "1px solid var(--color-accent)"
                        : "1px solid var(--color-border-light)",
                      background: isActive("keyword", kw)
                        ? "var(--color-accent)" : "var(--color-bg-secondary)",
                      color: isActive("keyword", kw)
                        ? "var(--color-bg-primary)" : "var(--color-accent-text)",
                      fontSize: 11, fontWeight: 500,
                      fontFamily: "var(--font-ui)", cursor: "pointer",
                    }}>
                    {kw}
                  </button>
                ))}
              </div>
            </div>
          )}
          {stats.top_locations.length > 0 && (
            <div>
              <p style={SECTION_LABEL}>Lokasyonlar</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {stats.top_locations.map((loc) => (
                  <button key={loc} onClick={() => onFilter("location", loc)}
                    style={{
                      padding: "6px 12px", borderRadius: 0,
                      border: isActive("location", loc)
                        ? "1px solid var(--color-accent)"
                        : "1px solid var(--color-border-light)",
                      background: isActive("location", loc)
                        ? "var(--color-accent)" : "var(--color-bg-secondary)",
                      color: isActive("location", loc)
                        ? "var(--color-bg-primary)" : "var(--color-accent-text)",
                      fontSize: 11, fontWeight: 500,
                      fontFamily: "var(--font-ui)", cursor: "pointer",
                    }}>
                    {loc}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
