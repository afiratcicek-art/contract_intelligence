import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDarkMode } from "../hooks/useDarkMode";
import { api } from "../services/api";
import { getAuth } from "../store/auth";
import ThemeToggle from "../components/ThemeToggle";
import { useLanguage } from "../context/LanguageContext";

interface BreadcrumbItem {
  id: string;
  corr_number: string;
  type: string;
  subject: string;
  direction: string;
}

interface ChildCorr {
  id: string;
  corr_number: string;
  subject: string;
  type: string;
  direction: string;
  status: string;
  correspondence_date: string;
  has_response: boolean;
}

interface CorrDetail {
  id: string;
  corr_number: string;
  subject: string;
  type: string;
  direction: string;
  status: string;
  correspondence_date: string;
  response_due_date: string | null;
  external_ref: string | null;
  from_party_id: string | null;
  to_party_id: string | null;
  parent_id: string | null;
  has_response: boolean;
  response_corr_id: string | null;
  created_at: string;
  breadcrumb: BreadcrumbItem[];
  children: ChildCorr[];
}

interface Document {
  id: string;
  original_filename: string;
  file_size_bytes: number;
  parse_status: string;
  created_at: string;
}

export default function CorrespondenceDetail() {
  const { projectId, corrId } = useParams<{ projectId: string; corrId: string }>();
  const navigate = useNavigate();
  const dark = useDarkMode();
  const auth = getAuth();
  const { lang, toggle: toggleLang, t } = useLanguage();

  const [corr, setCorr] = useState<CorrDetail | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bg          = dark ? "#1F2228" : "#F5F2ED";
  const cardBg      = dark ? "#2E3340" : "#E7E3DC";
  const border      = dark ? "#3D4456" : "#E7E3DC";
  const textPrimary = dark ? "#E8E6E0" : "#1C1917";
  const textSecond  = dark ? "#C4B49C" : "#44403C";
  const gold        = dark ? "#A0714A" : "#6B5D3F";
  const alertRed    = dark ? "#E07060" : "#A93226";
  const warnBg      = dark ? "#3D2E0A" : "#FEF9E7";
  const warnBorder  = dark ? "#D4956A" : "#92400E";

  useEffect(() => {
    if (!projectId || !corrId) return;
    Promise.all([
      api.get<CorrDetail>(`/projects/${projectId}/correspondences/${corrId}`),
      api.get<Document[]>(`/projects/${projectId}/documents/?entity_type=correspondence&entity_id=${corrId}`),
    ])
      .then(([corrData, docsData]) => {
        setCorr(corrData);
        setDocs(Array.isArray(docsData) ? docsData : []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, corrId]);

  const labelStyle = {
    fontSize: 9,
    fontWeight: 600 as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: textSecond,
    display: "block",
    marginBottom: 4,
  };

  const fieldStyle = {
    fontSize: 13,
    color: textPrimary,
    fontFamily: "Inter, sans-serif",
  };

  const parseStatusColor = (status: string) => {
    if (status === "completed") return dark ? "#4DB88A" : "#1F6B4E";
    if (status === "failed") return dark ? "#E07060" : "#A93226";
    return textSecond;
  };

  const directionPill = (direction: string) => (
    <span style={{
      fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const,
      letterSpacing: "0.04em", padding: "2px 8px",
      backgroundColor: direction === "incoming" ? (dark ? "#0F2D1A" : "#E6F4EE") : (dark ? "#3D2E0A" : "#FEF3C7"),
      color: direction === "incoming" ? (dark ? "#4DB88A" : "#1F6B4E") : (dark ? "#D4956A" : "#92400E"),
    }}>
      {direction === "incoming" ? "← Incoming" : "Outgoing →"}
    </span>
  );

  // En güncel mi? has_response true ise yanıtlanmış = artık en güncel değil
  const isLatest = corr ? !corr.has_response : true;

  if (loading) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: textSecond }}>{t("state.loading")}</p>
    </div>
  );

  if (error || !corr) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: alertRed }}>{error ?? (lang === "tr" ? "Kayıt bulunamadı." : "Record not found.")}</p>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>

      {/* Nav */}
      <nav style={{ backgroundColor: bg, borderBottom: `0.5px solid ${border}`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecond }}>
          <div style={{ width: 2, height: 20, background: "linear-gradient(to bottom, transparent, #6B5D3F 20%, #6B5D3F 80%, transparent)" }} />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=correspondence`)}>{t("module.correspondence")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ color: textPrimary, fontWeight: 500, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>{corr.corr_number}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: textSecond }}>
          <span>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: `1px solid ${dark ? "#3D4456" : "#E7E3DC"}`, cursor: "pointer", fontSize: 11, color: textSecond, padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 600, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>

        {/* Parent zinciri breadcrumb */}
        {corr.breadcrumb && corr.breadcrumb.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 16, padding: "8px 12px", backgroundColor: cardBg, borderLeft: `2px solid ${gold}` }}>
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginRight: 4 }}>
              {lang === "tr" ? "Zincir:" : "Chain:"}
            </span>
            {corr.breadcrumb.map((b, idx) => (
              <span key={b.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${b.id}`)}
                  style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: gold, cursor: "pointer", textDecoration: "underline" }}
                >
                  {b.corr_number}
                </span>
                {idx < corr.breadcrumb.length - 1 && (
                  <span style={{ fontSize: 10, color: textSecond }}>→</span>
                )}
              </span>
            ))}
            <span style={{ fontSize: 10, color: textSecond }}>→</span>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: textPrimary, fontWeight: 600 }}>{corr.corr_number}</span>
          </div>
        )}

        {/* "En güncel değil" uyarısı */}
        {!isLatest && corr.response_corr_id && (
          <div style={{ backgroundColor: warnBg, border: `0.5px solid ${warnBorder}`, padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: warnBorder, fontFamily: "Inter, sans-serif", fontWeight: 500 }}>
              {lang === "tr"
                ? "⚠ Bu yazışma zincirinin en güncel belgesi değil."
                : "⚠ This is not the latest document in the correspondence chain."}
            </span>
            <button
              onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${corr.response_corr_id}`)}
              style={{ fontSize: 11, fontWeight: 600, color: warnBorder, background: "none", border: `0.5px solid ${warnBorder}`, padding: "3px 10px", cursor: "pointer", fontFamily: "Inter, sans-serif" }}
            >
              {lang === "tr" ? "En Güncele Git →" : "Go to Latest →"}
            </button>
          </div>
        )}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: textSecond, marginBottom: 4 }}>{corr.corr_number}</p>
            <h1 style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, color: textPrimary, fontWeight: 600, lineHeight: 1.3, marginBottom: 8 }}>{corr.subject}</h1>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {directionPill(corr.direction)}
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.04em", padding: "2px 8px", backgroundColor: cardBg, color: textSecond }}>{corr.type}</span>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.04em", padding: "2px 8px", backgroundColor: cardBg, color: textSecond }}>{corr.status}</span>
              {corr.parent_id && (
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.04em", padding: "2px 8px", backgroundColor: dark ? "#1F2A3A" : "#E8F0FE", color: dark ? "#7BA7D4" : "#1A56A4" }}>
                  🔗 {lang === "tr" ? "Zincirde" : "In Chain"}
                </span>
              )}
            </div>
          </div>

          {/* Yanıt / Followup butonları */}
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 6, flexShrink: 0, marginLeft: 24 }}>
            <button
              onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/new?mode=response&parent_id=${corr.id}&parent_number=${corr.corr_number}`)}
              style={{ backgroundColor: gold, color: dark ? "#E8E6E0" : "#F5F2ED", border: "none", padding: "7px 14px", fontSize: 11, fontWeight: 600, letterSpacing: "0.5px", cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" as const }}
            >
              {lang === "tr" ? "↩ Yanıt Yaz" : "↩ Write Response"}
            </button>
            <button
              onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/new?mode=followup&parent_id=${corr.id}&parent_number=${corr.corr_number}`)}
              style={{ backgroundColor: "transparent", color: gold, border: `1px solid ${gold}`, padding: "7px 14px", fontSize: 11, fontWeight: 600, letterSpacing: "0.5px", cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" as const }}
            >
              {lang === "tr" ? "+ Followup Ekle" : "+ Add Followup"}
            </button>
          </div>
        </div>

        {/* Fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, padding: 20, backgroundColor: cardBg, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>{lang === "tr" ? "TARİH" : "DATE"}</label>
            <p style={fieldStyle}>{corr.correspondence_date}</p>
          </div>
          <div>
            <label style={labelStyle}>{lang === "tr" ? "SON TARİH" : "RESPONSE DEADLINE"}</label>
            <p style={{ ...fieldStyle, color: corr.response_due_date ? (new Date(corr.response_due_date) < new Date() ? alertRed : textPrimary) : textSecond }}>
              {corr.response_due_date ?? "—"}
            </p>
          </div>
          <div>
            <label style={labelStyle}>{lang === "tr" ? "KARŞI TARAF REF" : "EXT. REFERENCE"}</label>
            <p style={fieldStyle}>{corr.external_ref ?? "—"}</p>
          </div>
        </div>

        {/* Children — bu yazışmaya verilen yanıtlar */}
        {corr.children && corr.children.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 10 }}>
              {lang === "tr" ? `Yanıtlar / Followuplar (${corr.children.length})` : `Responses / Followups (${corr.children.length})`}
            </div>
            {corr.children.map((child) => (
              <div
                key={child.id}
                onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${child.id}`)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: cardBg, marginBottom: 3, borderLeft: `2px solid ${child.has_response ? textSecond : gold}`, cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: gold }}>{child.corr_number}</span>
                  {directionPill(child.direction)}
                  <span style={{ fontSize: 12, color: textPrimary, fontWeight: 500 }}>{child.subject}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {child.has_response && (
                    <span style={{ fontSize: 9, color: textSecond, fontStyle: "italic" }}>
                      {lang === "tr" ? "yanıtlandı" : "responded"}
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: textSecond }}>{child.correspondence_date?.slice(0, 10)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Documents */}
        <div style={{ padding: 20, backgroundColor: cardBg }}>
          <p style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12 }}>
            {lang === "tr" ? "EKLİ BELGELER" : "ATTACHED DOCUMENTS"} ({docs.length})
          </p>
          {docs.length === 0 ? (
            <p style={{ fontSize: 12, color: textSecond, fontStyle: "italic" }}>{lang === "tr" ? "Belge eklenmemiş." : "No documents attached."}</p>
          ) : (
            docs.map((doc) => (
              <div key={doc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `0.5px solid ${border}` }}>
                <div>
                  <p style={{ fontSize: 12, color: textPrimary, fontWeight: 500 }}>{doc.original_filename}</p>
                  <p style={{ fontSize: 10, color: textSecond, marginTop: 2 }}>
                    {(doc.file_size_bytes / 1024).toFixed(0)} KB ·{" "}
                    <span style={{ color: parseStatusColor(doc.parse_status) }}>{doc.parse_status}</span>
                  </p>
                </div>
                <button
                  onClick={async () => {
                    try {
                      const res = await api.get<{ signed_url: string }>(`/projects/${projectId}/documents/${doc.id}/signed-url`);
                      window.open(res.signed_url, "_blank");
                    } catch {
                      alert(lang === "tr" ? "İndirme linki oluşturulamadı." : "Could not generate download link.");
                    }
                  }}
                  style={{ fontSize: 11, color: gold, background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontFamily: "Inter, sans-serif" }}
                >
                  {lang === "tr" ? "İndir →" : "Download →"}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Back */}
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: `0.5px solid ${border}` }}>
          <button
            onClick={() => navigate(`/projects/${projectId}/workspace?module=correspondence`)}
            style={{ background: "none", border: `0.5px solid ${border}`, padding: "8px 16px", fontSize: 12, color: textSecond, cursor: "pointer", fontFamily: "Inter, sans-serif" }}
          >
            {lang === "tr" ? "← Yazışma Listesine Dön" : "← Back to Correspondence"}
          </button>
        </div>

      </div>
    </div>
  );
}
