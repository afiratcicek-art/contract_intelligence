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
  const [deadline, setDeadline] = useState<DeadlineInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const bg          = dark ? "#1F2228" : "#F5F2ED";
  const cardBg      = dark ? "#2E3340" : "#E7E3DC";
  const border      = dark ? "#3D4456" : "#E7E3DC";
  const textPrimary = dark ? "#E8E6E0" : "#1C1917";
  const textSecond  = dark ? "#C4B49C" : "#44403C";
  const gold        = dark ? "#A0714A" : "#6B5D3F";
  const alertRed    = dark ? "#E07060" : "#A93226";

  const STATUS_COLORS = dark
    ? { open: { bg: "#3D2E0A", text: "#D4956A" }, overdue: { bg: "#3D1A1A", text: "#E07060" }, closed: { bg: "#0F2D1A", text: "#4DB88A" }, responded: { bg: "#0F2D1A", text: "#4DB88A" }, draft: { bg: "#2E3340", text: "#C4B49C" } }
    : { open: { bg: "#FEF3C7", text: "#92400E" }, overdue: { bg: "#F5E6E4", text: "#A93226" }, closed: { bg: "#E6F4EE", text: "#1F6B4E" }, responded: { bg: "#E6F4EE", text: "#1F6B4E" }, draft: { bg: "#E7E3DC", text: "#44403C" } };

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
    return <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", padding: "2px 8px", backgroundColor: colors.bg, color: colors.text }}>{label}</span>;
  };

  const field = (label: string, value: string | null | undefined, mono = false) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 4 }}>{label}</div>
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
          <div style={{ width: 2, height: 20, background: `linear-gradient(to bottom, transparent, ${gold} 20%, ${gold} 80%, transparent)` }} />
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
          <button onClick={toggleLang} style={{ background: "none", border: `1px solid ${dark ? "#3D4456" : "#E7E3DC"}`, cursor: "pointer", fontSize: 11, color: textSecond, padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 600, letterSpacing: "0.5px" }}>{lang === "en" ? "TR" : "EN"}</button>
          <ThemeToggle />
          <button onClick={handleLogout} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: textSecond }}>{t("nav.signout")}</button>
        </div>
      </nav>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>

        {/* Ancestor zinciri */}
        {chain.ancestors.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 16, padding: "8px 12px", backgroundColor: cardBg, borderLeft: `2px solid ${gold}` }}>
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginRight: 4 }}>{lang === "tr" ? "Zincir:" : "Chain:"}</span>
            {chain.ancestors.map((a, idx) => (
              <span key={a.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span onClick={() => navigate(`/projects/${projectId}/workspace/rfis/${a.id}`)} style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: gold, cursor: "pointer", textDecoration: "underline" }}>{a.rfi_number}</span>
                <span style={{ fontSize: 9, color: textSecond }}>{RFI_TYPE_LABELS[a.rfi_type]?.[lang as "en" | "tr"] ?? a.rfi_type}</span>
                {idx < chain.ancestors.length - 1 && <span style={{ fontSize: 10, color: textSecond }}>→</span>}
              </span>
            ))}
            <span style={{ fontSize: 10, color: textSecond }}>→</span>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: textPrimary, fontWeight: 600 }}>{rfi.rfi_number}</span>
          </div>
        )}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: textSecond, letterSpacing: "0.05em" }}>{rfi.rfi_number}</span>
              {typeBadge(rfi.rfi_type)}
            </div>
            <h1 style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, fontWeight: 600, color: textPrimary, margin: 0, lineHeight: 1.3 }}>{rfi.subject}</h1>
          </div>
          <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "flex-end", gap: 8, flexShrink: 0, marginLeft: 24 }}>
            {rfi.rfi_type === "response"
              ? <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", backgroundColor: dark ? "#0F2D1A" : "#E6F4EE", color: dark ? "#4DB88A" : "#1F6B4E", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>RESPONSE</span>
              : statusPill(rfi.status)}
            {deadline && deadline.days_remaining !== null && (
              <div style={{ fontSize: 11, color: deadline.urgency === "CRITICAL" || deadline.urgency === "WARNING" ? alertRed : textSecond, fontFamily: "Inter, sans-serif", fontWeight: deadline.urgency !== "NORMAL" ? 600 : 400 }}>
                {deadline.days_remaining < 0 ? `${Math.abs(deadline.days_remaining)} ${lang === "tr" ? "gün geçti" : "days overdue"}` : deadline.days_remaining === 0 ? (lang === "tr" ? "Bugün" : "Today") : `${deadline.days_remaining} ${lang === "tr" ? "gün kaldı" : "days left"}`}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button onClick={() => navigate(`/projects/${projectId}/workspace/rfis/new?mode=response&parent_id=${rfi.id}&parent_number=${rfi.rfi_number}`)}
                style={{ backgroundColor: gold, color: dark ? "#E8E6E0" : "#F5F2ED", border: "none", padding: "6px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" as const }}>
                {lang === "tr" ? "↩ Yanıt Ekle" : "↩ Add Response"}
              </button>
              <button onClick={() => navigate(`/projects/${projectId}/workspace/rfis/new?mode=revision&parent_id=${rfi.id}&parent_number=${rfi.rfi_number}`)}
                style={{ backgroundColor: "transparent", color: gold, border: `1px solid ${gold}`, padding: "6px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" as const }}>
                {lang === "tr" ? "↺ Revize Ekle" : "↺ Add Revision"}
              </button>
            </div>
          </div>
        </div>

        {/* Deadline banner */}
        {deadline && deadline.deadline && deadline.days_remaining !== null && deadline.days_remaining <= 3 && (
          <div style={{ backgroundColor: dark ? "#3D1A1A" : "#F5E6E4", border: `0.5px solid ${alertRed}`, padding: "10px 16px", marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: alertRed, fontWeight: 600, fontFamily: "Inter, sans-serif" }}>
              {deadline.days_remaining < 0 ? "OVERDUE" : (lang === "tr" ? "SON TARİH YAKLAŞIYOR" : "DEADLINE APPROACHING")}
            </span>
            <span style={{ fontSize: 12, color: alertRed, fontFamily: "JetBrains Mono, monospace" }}>{deadline.deadline}</span>
            {deadline.deadline_source && <span style={{ fontSize: 11, color: textSecond }}>{lang === "tr" ? "— Kaynak:" : "— Source:"} {deadline.deadline_source}</span>}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 16, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>{lang === "tr" ? "Bilgi" : "Information"}</div>
              {field(lang === "tr" ? "Disiplin" : "Discipline", rfi.discipline)}
              {field(lang === "tr" ? "Gönderen" : "Submitted By", rfi.submitted_by)}
              {field(lang === "tr" ? "Gönderim Tarihi" : "Submission Date", rfi.submitted_date?.slice(0, 10))}
              {field(lang === "tr" ? "Harici Referans" : "External Reference", rfi.external_ref, true)}
            </div>
            {rfi.description && (
              <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>{lang === "tr" ? "Açıklama" : "Description"}</div>
                <p style={{ fontSize: 13, color: textPrimary, fontFamily: "Inter, sans-serif", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" as const }}>{rfi.description}</p>
              </div>
            )}
            {rfi.status === "closed" && (
              <div style={{ background: cardBg, padding: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>{lang === "tr" ? "Kapanış" : "Closure"}</div>
                {field(lang === "tr" ? "Kapanış Tarihi" : "Closed On", rfi.closed_at?.slice(0, 10))}
                {field(lang === "tr" ? "Kapanış Notu" : "Close Note", rfi.close_note)}
              </div>
            )}
          </div>

          <div>
            <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 16, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>Deadline</div>
              {field(lang === "tr" ? "Yanıt Beklenen" : "Response Due", rfi.response_due_date?.slice(0, 10))}
              {field(lang === "tr" ? "Deadline Kaynağı" : "Source", rfi.response_due_source)}
              {field(lang === "tr" ? "Gün Tipi" : "Day Type", rfi.response_due_day_type)}
              {field(lang === "tr" ? "Gerçek Yanıt Tarihi" : "Actual Response", rfi.actual_response_date?.slice(0, 10))}
            </div>

            {chain.children.length > 0 && (
              <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
                  {lang === "tr" ? `Yanıtlar / Revizeler (${chain.children.length})` : `Responses / Revisions (${chain.children.length})`}
                </div>
                {chain.children.map((child) => (
                  <div key={child.id} onClick={() => navigate(`/projects/${projectId}/workspace/rfis/${child.id}`)}
                    style={{ padding: "8px 10px", marginBottom: 4, borderLeft: `2px solid ${gold}`, cursor: "pointer", background: dark ? "#1F2228" : "#F5F2ED", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: gold }}>{child.rfi_number}</span>
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
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
                  {lang === "tr" ? `Bağlı Yazışmalar (${rfi.linked_correspondences.length})` : `Linked Correspondences (${rfi.linked_correspondences.length})`}
                </div>
                {rfi.linked_correspondences.map((c) => (
                  <div key={c.id} onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${c.id}`)}
                    style={{ padding: "8px 10px", marginBottom: 4, borderLeft: `2px solid ${gold}`, cursor: "pointer", background: dark ? "#1F2228" : "#F5F2ED" }}>
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
            style={{ background: "none", border: `0.5px solid ${border}`, padding: "8px 16px", fontSize: 12, color: textSecond, cursor: "pointer", fontFamily: "Inter, sans-serif" }}>
            {lang === "tr" ? "← RFI Listesine Dön" : "← Back to RFIs"}
          </button>
        </div>

      </main>
    </div>
  );
}
