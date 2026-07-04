/**
 * DocumentStatsPanel — Documents modülü istatistik paneli (migration 026)
 *
 * Gösterir: toplam kayıt, CORR alt tipleri, RFI disiplinleri,
 *           top 5 keyword, top 5 lokasyon.
 * Her chip tıklanabilir → onFilter(type, value) callback ile
 * DocumentsModule arama/filtre state'ini tetikler.
 *
 * Design: borderRadius 0, var(--color-accent-text), 8px grid.
 * AI elementleri yok — stats deterministic veri.
 */
import type { DocumentStats } from "../services/api";

const CORR_TYPE_LABELS: Record<string, string> = {
  notice:             "Notice",
  instruction:        "Instruction",
  letter:             "Letter",
  claim:              "Claim",
  vo:                 "Variation Order",
  email_instruction:  "Email Instruction",
  response:           "Response",
  other:              "Other",
};

const RFI_DISCIPLINE_LABELS: Record<string, string> = {
  Structural:    "Structural",
  MEP:           "MEP",
  Architectural: "Architectural",
  Civil:         "Civil",
  Other:         "Other",
};

interface Props {
  stats: DocumentStats;
  onFilter: (filterType: "corrType" | "rfiDiscipline" | "keyword" | "location", value: string) => void;
  activeFilter: { type: string; value: string } | null;
}

export default function DocumentStatsPanel({ stats, onFilter, activeFilter }: Props) {
  const isActive = (type: string, value: string) =>
    activeFilter?.type === type && activeFilter?.value === value;

  const chipStyle = (type: string, value: string) => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "6px 12px",
    border: isActive(type, value)
      ? "1px solid var(--color-accent)"
      : "1px solid var(--color-border-light)",
    background: isActive(type, value)
      ? "var(--color-accent)"
      : "var(--color-bg-secondary)",
    color: isActive(type, value)
      ? "var(--color-bg-primary)"
      : "var(--color-accent-text)",
    fontSize: 11, fontWeight: 500,
    fontFamily: "Inter, sans-serif",
    cursor: "pointer",
    borderRadius: 0,
    transition: "all 150ms ease-out",
  } as const);

  const countBadge = (n: number) => (
    <span style={{
      fontSize: 10, fontWeight: 500,
      color: "var(--color-text-secondary)",
      fontFamily: "JetBrains Mono, monospace",
    }}>
      {n}
    </span>
  );

  const sectionLabel = {
    fontSize: 11, fontWeight: 500,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "var(--color-text-secondary)",
    fontFamily: "Inter, sans-serif",
    marginBottom: 8,
  };

  return (
    <div style={{ padding: "24px 32px" }}>

      {/* ── Toplam sayaçlar ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 16, marginBottom: 32,
      }}>
        {[
          { label: "Toplam Kayıt",  value: stats.total_count },
          { label: "Yazışmalar",    value: stats.corr_count  },
          { label: "RFI'lar",       value: stats.rfi_count   },
          { label: "Belgeler",      value: stats.pdf_count   },
        ].map(({ label, value }) => (
          <div key={label} style={{
            padding: "16px 20px",
            border: "1px solid var(--color-border-light)",
            borderLeft: "3px solid var(--color-accent)",
            background: "var(--color-bg-secondary)",
          }}>
            <p style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 28, fontWeight: 500,
              color: "var(--color-accent-text)",
              margin: "0 0 4px",
            }}>
              {value}
            </p>
            <p style={{
              fontSize: 11, fontWeight: 500,
              textTransform: "uppercase", letterSpacing: "0.08em",
              color: "var(--color-text-secondary)",
              fontFamily: "Inter, sans-serif", margin: 0,
            }}>
              {label}
            </p>
          </div>
        ))}
      </div>

      {/* ── Filtre bölümleri ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>

        {/* Sol: CORR tipleri + RFI disiplinleri */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* CORR alt tipleri */}
          {Object.keys(stats.by_corr_type).length > 0 && (
            <div>
              <p style={sectionLabel}>Yazışma Tipi</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(stats.by_corr_type)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <button
                      key={type}
                      onClick={() => onFilter("corrType", type)}
                      style={chipStyle("corrType", type)}
                    >
                      {CORR_TYPE_LABELS[type] ?? type}
                      {" "}{countBadge(count)}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* RFI disiplinleri */}
          {Object.keys(stats.by_rfi_discipline).length > 0 && (
            <div>
              <p style={sectionLabel}>RFI Disiplini</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(stats.by_rfi_discipline)
                  .sort(([, a], [, b]) => b - a)
                  .map(([disc, count]) => (
                    <button
                      key={disc}
                      onClick={() => onFilter("rfiDiscipline", disc)}
                      style={chipStyle("rfiDiscipline", disc)}
                    >
                      {RFI_DISCIPLINE_LABELS[disc] ?? disc}
                      {" "}{countBadge(count)}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Sağ: Keywords + Lokasyonlar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Top 5 keywords */}
          {stats.top_keywords.length > 0 && (
            <div>
              <p style={sectionLabel}>Sık Kullanılan Anahtar Kelimeler</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {stats.top_keywords.map((kw) => (
                  <button
                    key={kw}
                    onClick={() => onFilter("keyword", kw)}
                    style={chipStyle("keyword", kw)}
                  >
                    {kw}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Top 5 lokasyonlar */}
          {stats.top_locations.length > 0 && (
            <div>
              <p style={sectionLabel}>Lokasyonlar</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {stats.top_locations.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => onFilter("location", loc)}
                    style={chipStyle("location", loc)}
                  >
                    {loc}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Veri yok durumu */}
          {stats.top_keywords.length === 0 && stats.top_locations.length === 0 && (
            <p style={{
              fontSize: 12, fontStyle: "italic",
              color: "var(--color-text-secondary)",
              fontFamily: "Inter, sans-serif",
            }}>
              Anahtar kelime ve lokasyon verisi henüz mevcut değil.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
