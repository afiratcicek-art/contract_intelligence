import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDarkMode } from "../hooks/useDarkMode";
import { api } from "../services/api";
import { getAuth, clearAuth } from "../store/auth";
import ThemeToggle from "../components/ThemeToggle";
import { useLanguage } from "../context/LanguageContext";

interface ChainItem {
  id: string;
  rfi_number: string;
  subject: string;
  rfi_type: string;
  status: string;
  submitted_date: string;
}

interface RFIChain {
  ancestors: ChainItem[];
  children: ChainItem[];
  is_latest: boolean;
}

interface LinkedCorr {
  id: string;
  corr_number: string;
  subject: string;
  type: string;
  status: string;
  correspondence_date: string;
}

interface RFIDetail {
  id: string;
  rfi_number: string;
  subject: string;
  description: string | null;
  discipline: string | null;
  submitted_by: string | null;
  submitted_date: string;
  response_due_date: string | null;
  response_due_source: string | null;
  response_due_day_type: string | null;
  actual_response_date: string | null;
  status: string;
  parent_id: string | null;
  rfi_type: string;
  closed_by: string | null;
  closed_at: string | null;
  close_note: string | null;
  assigned_to: string | null;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
  linked_correspondences: LinkedCorr[];
  chain: RFIChain;
}

interface DeadlineInfo {
  deadline: string | null;
  deadline_source: string | null;
  days_remaining: number | null;
  urgency: string;
}

const RFI_TYPE_LABELS: Record<string, { en: string; tr: string }> = {
  original: { en: "Original", tr: "Orijinal" },
  response: { en: "Response", tr: "Yanıt" },
  revision: { en: "Revision", tr: "Revize" },
};

export default function RFIDetail() {
  const { projectId, rfiId } = useParams<{ projectId: string; rfiId: string }>();
  const navigate = useNavigate();
  const dark = useDarkMode();
  const auth = getAuth();
  const { lang, toggle: toggleLang, t } = useLanguage();

  const [rfi, setRfi] = useState<RFIDetail | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const [noticeConfigs, setNoticeConfigs] = useState<{ id: string; label: string; notice_period_days: number }[]>([]);
  const [members, setMembers] = useState<{ user_id: string; full_name: string; project_role: string }[]>([]);
  const [flagForm, setFlagForm] = useState<{
    narrative: string;
    notice_config_id: string;
    assigned_to_user: string;
    document_references: string[];
    newFile: File | null;
  }>({
    narrative: "",
    notice_config_id: "",
    assigned_to_user: "",
    document_references: [],
    newFile: null,
  });
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const [docs, setDocs] = useState<{ id: string; original_filename: string; parse_status: string }[]>([]);
  const [deadline, setDeadline] = useState<DeadlineInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const bg          = dark ? "#1F2228" : "#F5F2ED";
  const cardBg      = dark ? "#2E3340" : "#E7E3DC";
  const border      = dark ? "#3D4456" : "#E7E3DC";
  const textPrimary = dark ? "#E8E6E0" : "#1C1917";
  const textSecond  = dark ? "#C4B49C" : "#44403C";
  const alertRed    = dark ? "#E07060" : "#A93226";

  const STATUS_COLORS = dark
    ? { open: { bg: "#3D2E0A", text: "#D4956A" }, overdue: { bg: "#3D1A1A", text: "#E07060" }, closed: { bg: "#0F2D1A", text: "#4DB88A" }, responded: { bg: "#0F2D1A", text: "#4DB88A" }, draft: { bg: "#2E3340", text: "#C4B49C" } }
    : { open: { bg: "#FEF3C7", text: "#92400E" }, overdue: { bg: "#F5E6E4", text: "#A93226" }, closed: { bg: "#E6F4EE", text: "#1F6B4E" }, responded: { bg: "#E6F4EE", text: "#1F6B4E" }, draft: { bg: "#E7E3DC", text: "#44403C" } };

  useEffect(() => {
    if (!projectId) return;
    api.get<{ id: string; label: string; notice_period_days: number }[]>(
      `/projects/${projectId}/notice-config`
    ).then(setNoticeConfigs).catch(() => {});
    api.get<{ user_id: string; full_name: string; project_role: string }[]>(
      `/projects/${projectId}/members`
    ).then(setMembers).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !rfiId) return;
    api.get<{ id: string; original_filename: string; parse_status: string }[]>(
      `/projects/${projectId}/documents/?entity_type=rfi&entity_id=${rfiId}`
    ).then(setDocs).catch(() => {});
  }, [projectId, rfiId]);

  useEffect(() => {
    if (!projectId || !rfiId) return;
    setLoading(true);
    Promise.all([
      api.get<RFIDetail>(`/projects/${projectId}/rfis/${rfiId}`),
      api.get<DeadlineInfo>(`/projects/${projectId}/rfis/${rfiId}/deadline`),
    ])
      .then(([rfiData, deadlineData]) => { setRfi(rfiData); setDeadline(deadlineData); })
      .catch(() => setError(lang === "tr" ? "RFI yüklenemedi." : "Failed to load RFI."))
      .finally(() => setLoading(false));
  }, [projectId, rfiId]);

  const handleLogout = () => { clearAuth(); navigate("/login"); };

  const statusPill = (status: string) => {
    const c = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? (dark ? { bg: "#2E3340", text: "#C4B49C" } : { bg: "#E7E3DC", text: "#44403C" });
    return <span style={{ background: c.bg, color: c.text, fontSize: 10, fontWeight: 500, padding: "2px 8px", textTransform: "uppercase" as const, letterSpacing: "0.05em", whiteSpace: "nowrap" as const }}>{status.replace("_", " ")}</span>;
  };

  const typeBadge = (rfiType: string) => {
    const label = RFI_TYPE_LABELS[rfiType]?.[lang as "en" | "tr"] ?? rfiType;
    const colors = rfiType === "original"
      ? { bg: dark ? "#2E3340" : "#E7E3DC", text: textSecond }
      : rfiType === "response"
      ? { bg: dark ? "#0F2D1A" : "#E6F4EE", text: dark ? "#4DB88A" : "#1F6B4E" }
      : { bg: dark ? "#1F2A3A" : "#E8F0FE", text: dark ? "#7BA7D4" : "#1A56A4" };
    return <span style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.05em", padding: "2px 8px", backgroundColor: colors.bg, color: colors.text }}>{label}</span>;
  };

  const field = (label: string, value: string | null | undefined, mono = false) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? textPrimary : textSecond, fontFamily: mono ? "JetBrains Mono, monospace" : "Inter, sans-serif", fontStyle: value ? "normal" : "italic" }}>{value ?? "—"}</div>
    </div>
  );

  if (loading) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: textSecond, fontFamily: "Inter, sans-serif" }}>{t("state.loading")}</p>
    </div>
  );

  if (error || !rfi) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: alertRed, fontFamily: "Inter, sans-serif" }}>{error || (lang === "tr" ? "RFI bulunamadı." : "RFI not found.")}</p>
    </div>
  );

  const chain = rfi.chain ?? { ancestors: [], children: [], is_latest: true };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>
      <nav style={{ backgroundColor: bg, borderBottom: `0.5px solid ${border}`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecond }}>
          <div style={{ width: 2, height: 20, background: `linear-gradient(to bottom, transparent, ${"var(--color-accent)"} 20%, ${"var(--color-accent)"} 80%, transparent)` }} />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=rfis`)}>{t("module.rfis")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ color: textPrimary, fontWeight: 500, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{rfi.rfi_number}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: textSecond }}>
          <span>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: `1px solid ${dark ? "#3D4456" : "#E7E3DC"}`, cursor: "pointer", fontSize: 11, color: textSecond, padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 500, letterSpacing: "0.5px" }}>{lang === "en" ? "TR" : "EN"}</button>
          <ThemeToggle />
          <button onClick={handleLogout} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: textSecond }}>{t("nav.signout")}</button>
        </div>
      </nav>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>

        {/* Ancestor zinciri */}
        {chain.ancestors.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 16, padding: "8px 12px", backgroundColor: cardBg, borderLeft: `2px solid ${"var(--color-accent)"}` }}>
            <span style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginRight: 4 }}>{lang === "tr" ? "Zincir:" : "Chain:"}</span>
            {chain.ancestors.map((a, idx) => (
              <span key={a.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span onClick={() => navigate(`/projects/${projectId}/workspace/rfis/${a.id}`)} style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--color-accent)", cursor: "pointer", textDecoration: "underline" }}>{a.rfi_number}</span>
                <span style={{ fontSize: 11, color: textSecond }}>{RFI_TYPE_LABELS[a.rfi_type]?.[lang as "en" | "tr"] ?? a.rfi_type}</span>
                {idx < chain.ancestors.length - 1 && <span style={{ fontSize: 10, color: textSecond }}>→</span>}
              </span>
            ))}
            <span style={{ fontSize: 10, color: textSecond }}>→</span>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: textPrimary, fontWeight: 500 }}>{rfi.rfi_number}</span>
          </div>
        )}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: textSecond, letterSpacing: "0.05em" }}>{rfi.rfi_number}</span>
              {typeBadge(rfi.rfi_type)}
            </div>
            <h1 style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, fontWeight: 500, color: textPrimary, margin: 0, lineHeight: 1.3 }}>{rfi.subject}</h1>
          </div>
          <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "flex-end", gap: 8, flexShrink: 0, marginLeft: 24 }}>
            {rfi.rfi_type === "response"
              ? <span style={{ fontSize: 10, fontWeight: 500, padding: "2px 8px", backgroundColor: dark ? "#0F2D1A" : "#E6F4EE", color: dark ? "#4DB88A" : "#1F6B4E", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>RESPONSE</span>
              : statusPill(rfi.status)}
            {deadline && deadline.days_remaining !== null && (
              <div style={{ fontSize: 11, color: deadline.urgency === "CRITICAL" || deadline.urgency === "WARNING" ? alertRed : textSecond, fontFamily: "Inter, sans-serif", fontWeight: deadline.urgency !== "NORMAL" ? 500 : 400 }}>
                {deadline.days_remaining < 0 ? `${Math.abs(deadline.days_remaining)} ${lang === "tr" ? "gün geçti" : "days overdue"}` : deadline.days_remaining === 0 ? (lang === "tr" ? "Bugün" : "Today") : `${deadline.days_remaining} ${lang === "tr" ? "gün kaldı" : "days left"}`}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button onClick={() => navigate(`/projects/${projectId}/workspace/rfis/new?mode=response&parent_id=${rfi.id}&parent_number=${rfi.rfi_number}`)}
                style={{ backgroundColor: "var(--color-accent)", color: dark ? "#E8E6E0" : "#F5F2ED", border: "none", padding: "6px 12px", fontSize: 11, fontWeight: 500, cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" as const }}>
                {lang === "tr" ? "↩ Yanıt Ekle" : "↩ Add Response"}
              </button>
              {rfi.rfi_type === "response" && (
                <button
                  onClick={() => setFlagOpen(true)}
                  style={{ backgroundColor: "transparent", color: dark ? "#D4956A" : "#92400E", border: `1px solid ${dark ? "#D4956A" : "#92400E"}`, padding: "6px 12px", fontSize: 11, fontWeight: 500, cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" as const }}>
                  ⚠ {lang === "tr" ? "Potansiyel Etki" : "Potential Impact"}
                </button>
              )}
              <button onClick={() => navigate(`/projects/${projectId}/workspace/rfis/new?mode=revision&parent_id=${rfi.id}&parent_number=${rfi.rfi_number}`)}
                style={{ backgroundColor: "transparent", color: "var(--color-accent)", border: `1px solid ${"var(--color-accent)"}`, padding: "6px 12px", fontSize: 11, fontWeight: 500, cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" as const }}>
                {lang === "tr" ? "↺ Revize Ekle" : "↺ Add Revision"}
              </button>
            </div>
          </div>
        </div>

        {/* Deadline banner */}
        {deadline && deadline.deadline && deadline.days_remaining !== null && deadline.days_remaining <= 3 && (
          <div style={{ backgroundColor: dark ? "#3D1A1A" : "#F5E6E4", border: `0.5px solid ${alertRed}`, padding: "10px 16px", marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: alertRed, fontWeight: 500, fontFamily: "Inter, sans-serif" }}>
              {deadline.days_remaining < 0 ? "OVERDUE" : (lang === "tr" ? "SON TARİH YAKLAŞIYOR" : "DEADLINE APPROACHING")}
            </span>
            <span style={{ fontSize: 12, color: alertRed, fontFamily: "JetBrains Mono, monospace" }}>{deadline.deadline}</span>
            {deadline.deadline_source && <span style={{ fontSize: 11, color: textSecond }}>{lang === "tr" ? "— Kaynak:" : "— Source:"} {deadline.deadline_source}</span>}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 16, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>{lang === "tr" ? "Bilgi" : "Information"}</div>
              {field(lang === "tr" ? "Disiplin" : "Discipline", rfi.discipline)}
              {field(lang === "tr" ? "Gönderen" : "Submitted By", rfi.submitted_by)}
              {field(lang === "tr" ? "Gönderim Tarihi" : "Submission Date", rfi.submitted_date?.slice(0, 10))}
              {field(lang === "tr" ? "Harici Referans" : "External Reference", rfi.external_ref, true)}
            </div>
            {rfi.description && (
              <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>{lang === "tr" ? "Açıklama" : "Description"}</div>
                <p style={{ fontSize: 13, color: textPrimary, fontFamily: "Inter, sans-serif", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" as const }}>{rfi.description}</p>
              </div>
            )}
            {rfi.status === "closed" && (
              <div style={{ background: cardBg, padding: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>{lang === "tr" ? "Kapanış" : "Closure"}</div>
                {field(lang === "tr" ? "Kapanış Tarihi" : "Closed On", rfi.closed_at?.slice(0, 10))}
                {field(lang === "tr" ? "Kapanış Notu" : "Close Note", rfi.close_note)}
              </div>
            )}
          </div>

          <div>
            <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 16, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>Deadline</div>
              {field(lang === "tr" ? "Yanıt Beklenen" : "Response Due", rfi.response_due_date?.slice(0, 10))}
              {field(lang === "tr" ? "Deadline Kaynağı" : "Source", rfi.response_due_source)}
              {field(lang === "tr" ? "Gün Tipi" : "Day Type", rfi.response_due_day_type)}
              {field(lang === "tr" ? "Gerçek Yanıt Tarihi" : "Actual Response", rfi.actual_response_date?.slice(0, 10))}
            </div>

            {chain.children.length > 0 && (
              <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
                  {lang === "tr" ? `Yanıtlar / Revizeler (${chain.children.length})` : `Responses / Revisions (${chain.children.length})`}
                </div>
                {chain.children.map((child) => (
                  <div key={child.id} onClick={() => navigate(`/projects/${projectId}/workspace/rfis/${child.id}`)}
                    style={{ padding: "8px 10px", marginBottom: 4, borderLeft: `2px solid ${"var(--color-accent)"}`, cursor: "pointer", background: dark ? "#1F2228" : "#F5F2ED", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--color-accent)" }}>{child.rfi_number}</span>
                        {typeBadge(child.rfi_type)}
                      </div>
                      <div style={{ fontSize: 12, color: textPrimary, fontWeight: 500 }}>{child.subject}</div>
                    </div>
                    <div style={{ fontSize: 10, color: textSecond, flexShrink: 0, marginLeft: 8 }}>{child.submitted_date?.slice(0, 10)}</div>
                  </div>
                ))}
              </div>
            )}

            {rfi.linked_correspondences && rfi.linked_correspondences.length > 0 && (
              <div style={{ background: cardBg, padding: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
                  {lang === "tr" ? `Bağlı Yazışmalar (${rfi.linked_correspondences.length})` : `Linked Correspondences (${rfi.linked_correspondences.length})`}
                </div>
                {rfi.linked_correspondences.map((c) => (
                  <div key={c.id} onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${c.id}`)}
                    style={{ padding: "8px 10px", marginBottom: 4, borderLeft: `2px solid ${"var(--color-accent)"}`, cursor: "pointer", background: dark ? "#1F2228" : "#F5F2ED" }}>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: textSecond }}>{c.corr_number}</div>
                    <div style={{ fontSize: 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>{c.subject}</div>
                    <div style={{ fontSize: 10, color: textSecond, marginTop: 2 }}>{c.correspondence_date?.slice(0, 10)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 32, paddingTop: 16, borderTop: `0.5px solid ${border}` }}>
          <button onClick={() => navigate(`/projects/${projectId}/workspace?module=rfis`)}
            style={{ background: "none", border: `1px solid ${"var(--color-accent)"}`, padding: "8px 16px", fontSize: 12, color: "var(--color-accent)", cursor: "pointer", fontFamily: "Inter, sans-serif", fontWeight: 500 }}>
            {lang === "tr" ? "← RFI Listesine Dön" : "← Back to RFIs"}
          </button>
        </div>

        {flagOpen && (
          <div
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 24 }}
            onClick={() => !flagSubmitting && setFlagOpen(false)}
          >
            <div
              style={{ backgroundColor: cardBg, padding: 24, width: "100%", maxWidth: 520, border: `1px solid ${border}`, maxHeight: "90vh", overflowY: "auto" as const }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 18, fontWeight: 500, color: textPrimary, margin: "0 0 8px" }}>
                {lang === "tr" ? "Potansiyel Etki Bildir" : "Flag Potential Impact"}
              </h2>
              <p style={{ fontSize: 12, color: textSecond, margin: "0 0 20px", lineHeight: 1.5 }}>
                {lang === "tr"
                  ? "İç aksiyon alerti oluşturulur. Seçilen kişi bilgilendirilir."
                  : "Creates an internal action alert. The assigned person will be notified."}
              </p>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 6 }}>
                  {lang === "tr" ? "Açıklama *" : "Narrative *"}
                </label>
                <textarea
                  value={flagForm.narrative}
                  onChange={(e) => setFlagForm({ ...flagForm, narrative: e.target.value })}
                  rows={4}
                  placeholder={lang === "tr" ? "Potansiyel etkiyi açıklayın..." : "Describe the potential impact..."}
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13, color: textPrimary, backgroundColor: dark ? "#1F2228" : "#F5F2ED", border: `1px solid ${border}`, fontFamily: "Inter, sans-serif", resize: "vertical" as const, boxSizing: "border-box" as const }}
                />
              </div>

              {noticeConfigs.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 6 }}>
                    {lang === "tr" ? "Potansiyel Sözleşme Maddesi (Opsiyonel)" : "Potential Contractual Trigger (Optional)"}
                  </label>
                  <select
                    value={flagForm.notice_config_id}
                    onChange={(e) => setFlagForm({ ...flagForm, notice_config_id: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", fontSize: 13, color: textPrimary, backgroundColor: dark ? "#1F2228" : "#F5F2ED", border: `1px solid ${border}`, fontFamily: "Inter, sans-serif" }}
                  >
                    <option value="">{lang === "tr" ? "— Seçiniz —" : "— Select —"}</option>
                    {noticeConfigs.map((c) => (
                      <option key={c.id} value={c.id}>{c.label} ({c.notice_period_days}d)</option>
                    ))}
                  </select>
                </div>
              )}

              {docs.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 6 }}>
                    {lang === "tr" ? "İlgili Belgeler (Opsiyonel)" : "Related Documents (Optional)"}
                  </label>
                  <div style={{ border: `1px solid ${border}`, padding: "8px 10px", backgroundColor: dark ? "#1F2228" : "#F5F2ED" }}>
                    {docs.map((d) => (
                      <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={flagForm.document_references.includes(d.id)}
                          onChange={(e) => {
                            const refs = e.target.checked
                              ? [...flagForm.document_references, d.id]
                              : flagForm.document_references.filter((id) => id !== d.id);
                            setFlagForm({ ...flagForm, document_references: refs });
                          }}
                        />
                        <span style={{ fontSize: 12, color: textPrimary, fontFamily: "Inter, sans-serif" }}>{d.original_filename}</span>
                        <span style={{ fontSize: 10, color: textSecond, marginLeft: "auto" }}>{d.parse_status}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 6 }}>
                  {lang === "tr" ? "Yeni Dosya Ekle (Opsiyonel)" : "Add New File (Optional)"}
                </label>
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.png,.jpg,.jpeg,.dwg,.dxf"
                  onChange={(e) => setFlagForm({ ...flagForm, newFile: e.target.files?.[0] || null })}
                  style={{ fontSize: 12, color: textPrimary, fontFamily: "Inter, sans-serif" }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 6 }}>
                  {lang === "tr" ? "Bildir" : "Notify"}
                </label>
                <select
                  value={flagForm.assigned_to_user}
                  onChange={(e) => setFlagForm({ ...flagForm, assigned_to_user: e.target.value })}
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13, color: textPrimary, backgroundColor: dark ? "#1F2228" : "#F5F2ED", border: `1px solid ${border}`, fontFamily: "Inter, sans-serif" }}
                >
                  <option value="">{lang === "tr" ? "— Tüm Ekip —" : "— Entire Team —"}</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.full_name} ({m.project_role})</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => { setFlagOpen(false); setFlagForm({ narrative: "", notice_config_id: "", assigned_to_user: "", document_references: [], newFile: null }); }}
                  disabled={flagSubmitting}
                  style={{ background: "none", border: `1px solid ${border}`, padding: "8px 16px", fontSize: 12, color: textSecond, cursor: "pointer", fontFamily: "Inter, sans-serif" }}
                >
                  {lang === "tr" ? "İptal" : "Cancel"}
                </button>
                <button
                  disabled={flagSubmitting || !flagForm.narrative.trim()}
                  onClick={async () => {
                    if (!projectId || !rfi) return;
                    setFlagSubmitting(true);
                    try {
                      const res = await api.post<{ id: string }>(`/projects/${projectId}/alerts`, {
                        alert_type: "potential_impact",
                        source_entity_type: "rfi",
                        source_entity_id: rfi.id,
                        narrative: flagForm.narrative,
                        notice_config_id: flagForm.notice_config_id || undefined,
                        assigned_to_user: flagForm.assigned_to_user || undefined,
                        document_references: flagForm.document_references.length > 0
                          ? flagForm.document_references : undefined,
                      });
                      if (flagForm.newFile && res?.id) {
                        const fd = new FormData();
                        fd.append("file", flagForm.newFile);
                        await api.postForm(
                          `/projects/${projectId}/documents/upload?entity_type=internal_alert&entity_id=${res.id}`,
                          fd
                        );
                      }
                      setFlagOpen(false);
                      setFlagForm({ narrative: "", notice_config_id: "", assigned_to_user: "", document_references: [], newFile: null });
                    } catch {
                      /* silent */
                    } finally {
                      setFlagSubmitting(false);
                    }
                  }}
                  style={{ backgroundColor: flagForm.narrative.trim() ? "var(--color-accent)" : (dark ? "#3D4456" : "#D4CFC8"), color: flagForm.narrative.trim() ? (dark ? "#E8E6E0" : "#F5F2ED") : textSecond, border: "none", padding: "8px 16px", fontSize: 12, fontWeight: 500, cursor: flagSubmitting ? "wait" : "pointer", fontFamily: "Inter, sans-serif", opacity: flagSubmitting ? 0.6 : 1 }}
                >
                  {flagSubmitting
                    ? (lang === "tr" ? "Gönderiliyor…" : "Submitting…")
                    : (lang === "tr" ? "Flag Olarak İşaretle" : "Flag as Potential Impact")}
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
