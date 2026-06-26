import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDarkMode } from "../hooks/useDarkMode";
import { api } from "../services/api";
import { getAuth, clearAuth } from "../store/auth";
import ThemeToggle from "../components/ThemeToggle";
import { useLanguage } from "../context/LanguageContext";

interface ChangeDetail {
  id: string;
  change_number: string;
  title: string;
  description: string | null;
  origin: string;
  status: string;
  cost_claimed_amount: number | null;
  cost_agreed_amount: number | null;
  cost_currency: string;
  cost_impact_status: string;
  time_impact_days_claimed: number | null;
  time_impact_days_agreed: number | null;
  time_impact_status: string;
  notice_sent: boolean;
  notice_sent_date: string | null;
  notice_due_date: string | null;
  notice_due_source: string | null;
  impact_due_date: string | null;
  trigger_source: string;
  created_at: string;
  linked_correspondences: LinkedCorr[];
}

interface LinkedCorr {
  id: string;
  correspondence_id: string;
  note: string | null;
  correspondences: {
    id: string;
    corr_number: string;
    subject: string;
    type: string;
    status: string;
    direction: string;
    correspondence_date: string;
  };
}

interface EventDocument {
  id: string;
  link_type: string;
  correspondence_id: string | null;
  rfi_id: string | null;
  pdf_document_id: string | null;
  note: string | null;
  added_at: string;
  correspondences: { corr_number: string; subject: string; type: string; status: string; correspondence_date: string } | null;
  rfis: { rfi_number: string; subject: string; status: string } | null;
}

interface ChronologyEvent {
  id: string;
  event_date: string;
  event_type: string;
  is_key_event: boolean;
  auto_narrative: string | null;
  approved_narrative: string | null;
  activity_id: string | null;
  boq_ref: string | null;
  created_at: string;
  documents: EventDocument[];
}

interface Chronology {
  chronology_id: string | null;
  title: string;
  events: ChronologyEvent[];
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open:         { bg: "#FEF3C7", text: "#92400E" },
  draft:        { bg: "#E7E3DC", text: "#44403C" },
  disputed:     { bg: "#F5E6E4", text: "#A93226" },
  closed:       { bg: "#E6F4EE", text: "#1F6B4E" },
  agreed:       { bg: "#E6F4EE", text: "#1F6B4E" },
  under_review: { bg: "#FEF3C7", text: "#92400E" },
};

const STATUS_COLORS_DARK: Record<string, { bg: string; text: string }> = {
  open:         { bg: "#3D2E0A", text: "#D4956A" },
  draft:        { bg: "#2E3340", text: "#C4B49C" },
  disputed:     { bg: "#3D1A1A", text: "#E07060" },
  closed:       { bg: "#0F2D1A", text: "#4DB88A" },
  agreed:       { bg: "#0F2D1A", text: "#4DB88A" },
  under_review: { bg: "#3D2E0A", text: "#D4956A" },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  status_change:    "Status Change",
  correspondence:   "Correspondence",
  rfi:              "RFI",
  notice:           "Notice",
  submission:       "Submission",
  response:         "Response",
  meeting:          "Meeting",
  dispute_step:     "Dispute Step",
};

const ORIGIN_LABELS: Record<string, string> = {
  employer_instruction: "Employer Instruction",
  contractor_discovery: "Contractor Discovery",
  design_change:        "Design Change",
  site_condition:       "Unforeseen Site Condition",
  scope_addition:       "Scope Addition",
  regulatory:           "Regulatory / Statutory",
  other:                "Other",
};

export default function ChangeDetail() {
  const { projectId, changeId } = useParams<{ projectId: string; changeId: string }>();
  const navigate = useNavigate();
  const dark = useDarkMode();
  const auth = getAuth();
  const { lang, toggle: toggleLang, t } = useLanguage();

  const [change, setChange] = useState<ChangeDetail | null>(null);
  const [chronology, setChronology] = useState<Chronology | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const bg          = dark ? "#1F2228" : "#F5F2ED";
  const cardBg      = dark ? "#2E3340" : "#E7E3DC";
  const border      = dark ? "#3D4456" : "#E7E3DC";
  const textPrimary = dark ? "#E8E6E0" : "#1C1917";
  const textSecond  = dark ? "#C4B49C" : "#44403C";
  const alertRed    = dark ? "#E07060" : "#A93226";
  const successGrn  = dark ? "#4DB88A" : "#1F6B4E";

  useEffect(() => {
    if (!projectId || !changeId) return;
    setLoading(true);
    Promise.all([
      api.get<ChangeDetail>(`/projects/${projectId}/changes/${changeId}`),
      api.get<Chronology>(`/projects/${projectId}/changes/${changeId}/chronology`),
    ])
      .then(([changeData, chronoData]) => {
        setChange(changeData);
        setChronology(chronoData);
      })
      .catch(() => setError(lang === "tr" ? "Change yüklenemedi." : "Failed to load change."))
      .finally(() => setLoading(false));
  }, [projectId, changeId]);

  const handleLogout = () => { clearAuth(); navigate("/login"); };

  const statusPill = (status: string) => {
    const colors = dark ? STATUS_COLORS_DARK : STATUS_COLORS;
    const c = colors[status] ?? (dark ? { bg: "#2E3340", text: "#C4B49C" } : { bg: "#E7E3DC", text: "#44403C" });
    return (
      <span style={{ background: c.bg, color: c.text, fontSize: 10, fontWeight: 500, padding: "3px 8px", textTransform: "uppercase" as const, letterSpacing: "0.06em", whiteSpace: "nowrap" as const }}>
        {status.replace("_", " ")}
      </span>
    );
  };

  const field = (label: string, value: string | number | null | undefined, mono = false) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: value !== null && value !== undefined ? textPrimary : textSecond, fontFamily: mono ? "JetBrains Mono, monospace" : "Inter, sans-serif", fontStyle: value !== null && value !== undefined ? "normal" : "italic" }}>
        {value ?? "—"}
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: textSecond, fontFamily: "Inter, sans-serif" }}>
        {lang === "tr" ? "Yükleniyor..." : "Loading..."}
      </p>
    </div>
  );

  if (error || !change) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: alertRed, fontFamily: "Inter, sans-serif" }}>{error || "Change bulunamadı."}</p>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>

      {/* Nav */}
      <nav style={{ backgroundColor: bg, borderBottom: `0.5px solid ${border}`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecond }}>
          <div style={{ width: 2, height: 20, background: `linear-gradient(to bottom, transparent, ${"var(--color-accent)"} 20%, ${"var(--color-accent)"} 80%, transparent)` }} />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: textSecond }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span style={{ color: textSecond }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=changes`)}>{t("module.changes")}</span>
          <span style={{ color: textSecond }}>/</span>
          <span style={{ color: textPrimary, fontWeight: 500, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{change.change_number}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: textSecond }}>
          <span>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: `1px solid ${dark ? "#3D4456" : "#E7E3DC"}`, cursor: "pointer", fontSize: 11, color: textSecond, padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 500, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
          <ThemeToggle />
          <button onClick={handleLogout} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: textSecond }}>{t("nav.signout")}</button>
        </div>
      </nav>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: textSecond, marginBottom: 6, letterSpacing: "0.05em" }}>{change.change_number}</div>
            <h1 style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, fontWeight: 500, color: textPrimary, margin: 0, lineHeight: 1.3 }}>{change.title}</h1>
          </div>
          <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "flex-end", gap: 8, flexShrink: 0, marginLeft: 24 }}>
            {statusPill(change.status)}
            {change.notice_due_date && (
              <div style={{ fontSize: 11, color: new Date(change.notice_due_date) < new Date() ? alertRed : textSecond, fontFamily: "JetBrains Mono, monospace" }}>
                Notice: {change.notice_due_date}
              </div>
            )}
          </div>
        </div>

        {/* Künye kartı */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
          <div style={{ background: cardBg, padding: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
              {lang === "tr" ? "Genel" : "General"}
            </div>
            {field(lang === "tr" ? "Kaynak" : "Origin", ORIGIN_LABELS[change.origin] ?? change.origin)}
            {field(lang === "tr" ? "Tetikleyici" : "Trigger", change.trigger_source)}
            {field(lang === "tr" ? "Notice Gönderildi" : "Notice Sent", change.notice_sent
              ? (change.notice_sent_date ?? (lang === "tr" ? "Evet" : "Yes"))
              : (lang === "tr" ? "Hayır" : "No"))}
          </div>

          <div style={{ background: cardBg, padding: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
              {lang === "tr" ? "Maliyet Etkisi" : "Cost Impact"}
            </div>
            <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: textSecond, marginBottom: 3 }}>
              {lang === "tr" ? "Durum" : "Status"}
            </div>
            <div style={{ fontSize: 12, color: textPrimary, marginBottom: 10 }}>{change.cost_impact_status.replace("_", " ")}</div>
            {field(lang === "tr" ? "Talep Edilen" : "Claimed", change.cost_claimed_amount != null ? `${change.cost_currency} ${change.cost_claimed_amount.toLocaleString()}` : null)}
            {field(lang === "tr" ? "Anlaşılan" : "Agreed", change.cost_agreed_amount != null ? `${change.cost_currency} ${change.cost_agreed_amount.toLocaleString()}` : null)}
          </div>

          <div style={{ background: cardBg, padding: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
              {lang === "tr" ? "Süre Etkisi" : "Time Impact"}
            </div>
            <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: textSecond, marginBottom: 3 }}>
              {lang === "tr" ? "Durum" : "Status"}
            </div>
            <div style={{ fontSize: 12, color: textPrimary, marginBottom: 10 }}>{change.time_impact_status.replace("_", " ")}</div>
            {field(lang === "tr" ? "Talep Edilen" : "Claimed", change.time_impact_days_claimed != null ? `${change.time_impact_days_claimed} ${lang === "tr" ? "gün" : "days"}` : null)}
            {field(lang === "tr" ? "Anlaşılan" : "Agreed", change.time_impact_days_agreed != null ? `${change.time_impact_days_agreed} ${lang === "tr" ? "gün" : "days"}` : null)}
          </div>
        </div>

        {/* Description */}
        {change.description && (
          <div style={{ background: cardBg, padding: 16, marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 10, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>{lang === "tr" ? "Açıklama" : "Description"}</div>
            <p style={{ fontSize: 13, color: textPrimary, fontFamily: "Inter, sans-serif", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" as const }}>{change.description}</p>
          </div>
        )}

        {/* Chronology — vertical timeline */}
        {chronology && chronology.events.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 16 }}>
              {lang === "tr" ? "Olaylar Kronolojisi" : "Chronology of Events"}
            </div>

            <div style={{ position: "relative" as const, paddingLeft: 24 }}>
              {/* Dikey çizgi */}
              <div style={{ position: "absolute" as const, left: 6, top: 6, bottom: 6, width: 1, backgroundColor: "var(--color-accent)", opacity: 0.4 }} />

              {chronology.events.map((event, idx) => (
                <div key={event.id} style={{ position: "relative" as const, marginBottom: idx < chronology.events.length - 1 ? 20 : 0 }}>

                  {/* Nokta */}
                  <div style={{
                    position: "absolute" as const,
                    left: -18,
                    top: 4,
                    width: event.is_key_event ? 9 : 6,
                    height: event.is_key_event ? 9 : 6,
                    borderRadius: "50%",
                    backgroundColor: event.is_key_event ? "var(--color-accent)" : border,
                    border: event.is_key_event ? `2px solid ${"var(--color-accent)"}` : `1px solid ${textSecond}`,
                    flexShrink: 0,
                  }} />

                  {/* Event kartı */}
                  <div style={{
                    background: event.is_key_event ? cardBg : "transparent",
                    borderLeft: event.is_key_event ? `2px solid ${"var(--color-accent)"}` : "none",
                    padding: event.is_key_event ? "10px 14px" : "2px 0",
                  }}>

                    {/* Tarih + Type */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: textSecond, whiteSpace: "nowrap" as const }}>
                        {event.event_date}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: event.is_key_event ? "var(--color-accent)" : textSecond }}>
                        {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
                      </span>
                      {event.is_key_event && (
                        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-accent)", border: `0.5px solid ${"var(--color-accent)"}`, padding: "1px 5px", letterSpacing: "0.05em" }}>KEY</span>
                      )}
                    </div>

                    {/* Narrative */}
                    {(event.approved_narrative || event.auto_narrative) && (
                      <p style={{ fontSize: 12, color: event.approved_narrative ? textPrimary : textSecond, fontFamily: "Inter, sans-serif", fontStyle: event.approved_narrative ? "normal" : "italic", margin: "0 0 6px 0", lineHeight: 1.5 }}>
                        {event.approved_narrative ?? event.auto_narrative}
                      </p>
                    )}

                    {/* Bağlı belgeler */}
                    {event.documents && event.documents.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column" as const, gap: 3, marginTop: 4 }}>
                        {event.documents.map((doc) => {
                          if (doc.link_type === "correspondence" && doc.correspondences) {
                            return (
                              <div key={doc.id}
                                onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${doc.correspondence_id}`)}
                                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "3px 0" }}>
                                <span style={{ fontSize: 11, color: textSecond, fontFamily: "Inter, sans-serif" }}>└─</span>
                                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--color-accent)", textDecoration: "underline" }}>
                                  {doc.correspondences.corr_number}
                                </span>
                                <span style={{ fontSize: 11, color: textPrimary }}>{doc.correspondences.subject}</span>
                                <span style={{ fontSize: 11, color: textSecond, textTransform: "uppercase" as const }}>{doc.correspondences.type}</span>
                              </div>
                            );
                          }
                          if (doc.link_type === "rfi" && doc.rfis) {
                            return (
                              <div key={doc.id}
                                onClick={() => navigate(`/projects/${projectId}/workspace/rfis/${doc.rfi_id}`)}
                                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "3px 0" }}>
                                <span style={{ fontSize: 11, color: textSecond, fontFamily: "Inter, sans-serif" }}>└─</span>
                                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--color-accent)", textDecoration: "underline" }}>
                                  {doc.rfis.rfi_number}
                                </span>
                                <span style={{ fontSize: 11, color: textPrimary }}>{doc.rfis.subject}</span>
                              </div>
                            );
                          }
                          return null;
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Linked Correspondences */}
        {change.linked_correspondences && change.linked_correspondences.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12 }}>
              {lang === "tr" ? `Bağlı Yazışmalar (${change.linked_correspondences.length})` : `Linked Correspondences (${change.linked_correspondences.length})`}
            </div>
            {change.linked_correspondences.map((lc) => (
              <div key={lc.id}
                onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${lc.correspondences?.id}`)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: cardBg, marginBottom: 3, borderLeft: `2px solid ${"var(--color-accent)"}`, cursor: "pointer" }}>
                <div>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: textSecond }}>{lc.correspondences?.corr_number}</span>
                  <p style={{ fontSize: 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>{lc.correspondences?.subject}</p>
                  <p style={{ fontSize: 10, color: textSecond, marginTop: 1 }}>{lc.correspondences?.correspondence_date?.slice(0, 10)}</p>
                </div>
                {statusPill(lc.correspondences?.status ?? "")}
              </div>
            ))}
          </div>
        )}

        {/* Geri */}
        <div style={{ paddingTop: 16, borderTop: `0.5px solid ${border}` }}>
          <button onClick={() => navigate(`/projects/${projectId}/workspace?module=changes`)}
            style={{ background: "none", border: `1px solid ${"var(--color-accent)"}`, padding: "8px 16px", fontSize: 12, color: "var(--color-accent)", cursor: "pointer", fontFamily: "Inter, sans-serif", fontWeight: 500 }}>
            {lang === "tr" ? "← Changes Listesine Dön" : "← Back to Changes"}
          </button>
        </div>

      </main>
    </div>
  );
}
