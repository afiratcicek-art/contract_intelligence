import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDarkMode } from "../hooks/useDarkMode";
import { api } from "../services/api";
import { getAuth } from "../store/auth";
import ThemeToggle from "../components/ThemeToggle";
import { useLanguage } from "../context/LanguageContext";

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
  created_at: string;
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

  const bg = dark ? "#1F2228" : "#F5F2ED";
  const cardBg = dark ? "#2E3340" : "#E7E3DC";
  const border = dark ? "#3D4456" : "#E7E3DC";
  const textPrimary = dark ? "#E8E6E0" : "#1C1917";
  const textSecondary = dark ? "#C4B49C" : "#44403C";
  const gold = dark ? "#A0714A" : "#6B5D3F";

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
    color: textSecondary,
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
    return textSecondary;
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: textSecondary }}>{t("state.loading")}</p>
    </div>
  );

  if (error || !corr) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: dark ? "#E07060" : "#A93226" }}>{error ?? (lang === "tr" ? "Kayıt bulunamadı." : "Record not found.")}</p>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>
      {/* Nav */}
      <nav style={{ backgroundColor: bg, borderBottom: `0.5px solid ${border}`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecondary }}>
          <div style={{ width: 2, height: 20, background: "linear-gradient(to bottom, transparent, #6B5D3F 20%, #6B5D3F 80%, transparent)" }} />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=correspondence`)}>{t("module.correspondence")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ color: textPrimary, fontWeight: 500, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>{corr.corr_number}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: textSecondary }}>
          <span>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: `1px solid ${dark ? "#3D4456" : "#E7E3DC"}`, cursor: "pointer", fontSize: 11, color: dark ? "#C4B49C" : "#44403C", padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 600, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "32px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: textSecondary, marginBottom: 4 }}>{corr.corr_number}</p>
            <h1 style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, color: textPrimary, fontWeight: 600, lineHeight: 1.3, marginBottom: 8 }}>{corr.subject}</h1>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", padding: "2px 8px", backgroundColor: corr.direction === "incoming" ? (dark ? "#0F2D1A" : "#E6F4EE") : (dark ? "#3D2E0A" : "#FEF3C7"), color: corr.direction === "incoming" ? (dark ? "#4DB88A" : "#1F6B4E") : (dark ? "#D4956A" : "#92400E") }}>
                {corr.direction === "incoming" ? "← Incoming" : "Outgoing →"}
              </span>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", padding: "2px 8px", backgroundColor: cardBg, color: textSecondary }}>
                {corr.type}
              </span>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", padding: "2px 8px", backgroundColor: cardBg, color: textSecondary }}>
                {corr.status}
              </span>
            </div>
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
            <p style={{ ...fieldStyle, color: corr.response_due_date ? (new Date(corr.response_due_date) < new Date() ? (dark ? "#E07060" : "#A93226") : textPrimary) : textSecondary }}>
              {corr.response_due_date ?? "—"}
            </p>
          </div>
          <div>
            <label style={labelStyle}>{lang === "tr" ? "KARŞI TARAF REF" : "EXT. REFERENCE"}</label>
            <p style={fieldStyle}>{corr.external_ref ?? "—"}</p>
          </div>
        </div>

        {/* Documents */}
        <div style={{ padding: 20, backgroundColor: cardBg }}>
          <p style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: textSecondary, marginBottom: 12 }}>
            {lang === "tr" ? "EKLİ BELGELER" : "ATTACHED DOCUMENTS"} ({docs.length})
          </p>
          {docs.length === 0 ? (
            <p style={{ fontSize: 12, color: textSecondary, fontStyle: "italic" }}>{lang === "tr" ? "Belge eklenmemiş." : "No documents attached."}</p>
          ) : (
            docs.map((doc) => (
              <div key={doc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `0.5px solid ${border}` }}>
                <div>
                  <p style={{ fontSize: 12, color: textPrimary, fontWeight: 500 }}>{doc.original_filename}</p>
                  <p style={{ fontSize: 10, color: textSecondary, marginTop: 2 }}>
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

      </div>
    </div>
  );
}
