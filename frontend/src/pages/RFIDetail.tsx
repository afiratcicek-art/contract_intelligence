import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDarkMode } from "../hooks/useDarkMode";
import { api } from "../services/api";
import { getAuth, clearAuth } from "../store/auth";
import ThemeToggle from "../components/ThemeToggle";
import { useLanguage } from "../context/LanguageContext";

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
  closed_by: string | null;
  closed_at: string | null;
  close_note: string | null;
  assigned_to: string | null;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
  linked_correspondences: LinkedCorr[];
}

interface LinkedCorr {
  id: string;
  corr_number: string;
  subject: string;
  type: string;
  status: string;
  correspondence_date: string;
}

interface DeadlineInfo {
  deadline: string | null;
  deadline_source: string | null;
  days_remaining: number | null;
  urgency: string;
}

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

  const bg = dark ? "#1F2228" : "#F5F2ED";
  const cardBg = dark ? "#2E3340" : "#E7E3DC";
  const border = dark ? "#3D4456" : "#E7E3DC";
  const textPrimary = dark ? "#E8E6E0" : "#1C1917";
  const textSecondary = dark ? "#C4B49C" : "#44403C";
  const gold = dark ? "#A0714A" : "#6B5D3F";
  const alertRed = dark ? "#E07060" : "#A93226";

  const STATUS_COLORS = dark
    ? {
        open: { bg: "#3D2E0A", text: "#D4956A" },
        overdue: { bg: "#3D1A1A", text: "#E07060" },
        closed: { bg: "#0F2D1A", text: "#4DB88A" },
        responded: { bg: "#0F2D1A", text: "#4DB88A" },
        draft: { bg: "#2E3340", text: "#C4B49C" },
      }
    : {
        open: { bg: "#FEF3C7", text: "#92400E" },
        overdue: { bg: "#F5E6E4", text: "#A93226" },
        closed: { bg: "#E6F4EE", text: "#1F6B4E" },
        responded: { bg: "#E6F4EE", text: "#1F6B4E" },
        draft: { bg: "#E7E3DC", text: "#44403C" },
      };

  useEffect(() => {
    if (!projectId || !rfiId) return;
    setLoading(true);
    Promise.all([
      api.get<RFIDetail>(`/projects/${projectId}/rfis/${rfiId}`),
      api.get<DeadlineInfo>(`/projects/${projectId}/rfis/${rfiId}/deadline`),
    ])
      .then(([rfiData, deadlineData]) => {
        setRfi(rfiData);
        setDeadline(deadlineData);
      })
      .catch(() => setError("RFI yüklenemedi."))
      .finally(() => setLoading(false));
  }, [projectId, rfiId]);

  const handleLogout = () => { clearAuth(); navigate("/login"); };

  const statusPill = (status: string) => {
    const c = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? (dark ? { bg: "#2E3340", text: "#C4B49C" } : { bg: "#E7E3DC", text: "#44403C" });
    return (
      <span style={{ background: c.bg, color: c.text, fontSize: 10, fontWeight: 500, padding: "2px 8px", textTransform: "uppercase" as const, letterSpacing: "0.05em", whiteSpace: "nowrap" as const }}>
        {status.replace("_", " ")}
      </span>
    );
  };

  const field = (label: string, value: string | null | undefined, mono = false) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecondary, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? textPrimary : textSecondary, fontFamily: mono ? "JetBrains Mono, monospace" : "Inter, sans-serif", fontStyle: value ? "normal" : "italic" }}>
        {value ?? "—"}
      </div>
    </div>
  );

  const today = new Date().toISOString().slice(0, 10);

  if (loading) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: textSecondary, fontFamily: "Inter, sans-serif" }}>Yükleniyor...</p>
    </div>
  );

  if (error || !rfi) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: alertRed, fontFamily: "Inter, sans-serif" }}>{error || "RFI bulunamadı."}</p>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>
      {/* Nav */}
      <nav style={{ backgroundColor: bg, borderBottom: `0.5px solid ${border}`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecondary }}>
          <div style={{ width: 2, height: 20, background: `linear-gradient(to bottom, transparent, ${gold} 20%, ${gold} 80%, transparent)` }} />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=rfis`)}>{t("module.rfis")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ color: textPrimary, fontWeight: 500, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{rfi.rfi_number}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: textSecondary }}>
          <span>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: `1px solid ${dark ? "#3D4456" : "#E7E3DC"}`, cursor: "pointer", fontSize: 11, color: textSecondary, padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 600, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
          <ThemeToggle />
          <button onClick={handleLogout} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: textSecondary }}>{t("nav.signout")}</button>
        </div>
      </nav>

      {/* Content */}
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: textSecondary, marginBottom: 6, letterSpacing: "0.05em" }}>{rfi.rfi_number}</div>
            <h1 style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, fontWeight: 600, color: textPrimary, margin: 0, lineHeight: 1.3 }}>{rfi.subject}</h1>
          </div>
          <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "flex-end", gap: 8, flexShrink: 0, marginLeft: 24 }}>
            {statusPill(rfi.status)}
            {deadline && deadline.days_remaining !== null && (
              <div style={{ fontSize: 11, color: deadline.urgency === "CRITICAL" || deadline.urgency === "WARNING" ? alertRed : textSecondary, fontFamily: "Inter, sans-serif", fontWeight: deadline.urgency !== "NORMAL" ? 600 : 400 }}>
                {deadline.days_remaining < 0
                  ? `${Math.abs(deadline.days_remaining)} gün geçti`
                  : deadline.days_remaining === 0
                  ? "Bugün"
                  : `${deadline.days_remaining} gün kaldı`}
              </div>
            )}
          </div>
        </div>

        {/* Deadline banner — sadece overdue veya yakın ise */}
        {deadline && deadline.deadline && deadline.days_remaining !== null && deadline.days_remaining <= 3 && (
          <div style={{ backgroundColor: dark ? "#3D1A1A" : "#F5E6E4", border: `0.5px solid ${alertRed}`, padding: "10px 16px", marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: alertRed, fontWeight: 600, fontFamily: "Inter, sans-serif" }}>
              {deadline.days_remaining < 0 ? "OVERDUE" : "SON TARİH YAKLAŞIYOR"}
            </span>
            <span style={{ fontSize: 12, color: alertRed, fontFamily: "JetBrains Mono, monospace" }}>{deadline.deadline}</span>
            {deadline.deadline_source && (
              <span style={{ fontSize: 11, color: textSecondary, fontFamily: "Inter, sans-serif" }}>— Kaynak: {deadline.deadline_source}</span>
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

          {/* Sol kolon */}
          <div>
            <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecondary, marginBottom: 16, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>Bilgi</div>
              {field("Disiplin", rfi.discipline)}
              {field("Gönderen", rfi.submitted_by)}
              {field("Gönderim Tarihi", rfi.submitted_date?.slice(0, 10))}
              {field("Harici Referans", rfi.external_ref, true)}
            </div>

            {rfi.description && (
              <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecondary, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>Açıklama</div>
                <p style={{ fontSize: 13, color: textPrimary, fontFamily: "Inter, sans-serif", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" as const }}>{rfi.description}</p>
              </div>
            )}

            {rfi.status === "closed" && (
              <div style={{ background: cardBg, padding: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecondary, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>Kapanış</div>
                {field("Kapanış Tarihi", rfi.closed_at?.slice(0, 10))}
                {field("Kapanış Notu", rfi.close_note)}
              </div>
            )}
          </div>

          {/* Sağ kolon */}
          <div>
            <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecondary, marginBottom: 16, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>Deadline</div>
              {field("Yanıt Beklenen", rfi.response_due_date?.slice(0, 10))}
              {field("Deadline Kaynağı", rfi.response_due_source)}
              {field("Gün Tipi", rfi.response_due_day_type)}
              {field("Gerçek Yanıt Tarihi", rfi.actual_response_date?.slice(0, 10))}
            </div>

            {/* Linked Correspondences */}
            {rfi.linked_correspondences && rfi.linked_correspondences.length > 0 && (
              <div style={{ background: cardBg, padding: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecondary, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
                  Bağlı Yazışmalar ({rfi.linked_correspondences.length})
                </div>
                {rfi.linked_correspondences.map((c) => (
                  <div key={c.id} onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${c.id}`)}
                    style={{ padding: "8px 10px", marginBottom: 4, borderLeft: `2px solid ${gold}`, cursor: "pointer", background: dark ? "#1F2228" : "#F5F2ED" }}>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: textSecondary }}>{c.corr_number}</div>
                    <div style={{ fontSize: 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>{c.subject}</div>
                    <div style={{ fontSize: 10, color: textSecondary, marginTop: 2 }}>{c.correspondence_date?.slice(0, 10)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Back button */}
        <div style={{ marginTop: 32, paddingTop: 16, borderTop: `0.5px solid ${border}` }}>
          <button onClick={() => navigate(`/projects/${projectId}/workspace?module=rfis`)}
            style={{ background: "none", border: `0.5px solid ${border}`, padding: "8px 16px", fontSize: 12, color: textSecondary, cursor: "pointer", fontFamily: "Inter, sans-serif" }}>
            ← RFI Listesine Dön
          </button>
        </div>

      </main>
    </div>
  );
}
