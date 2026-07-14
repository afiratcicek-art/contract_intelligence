import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { getAuth } from "../store/auth";
import ThemeToggle from "../components/ThemeToggle";
import { useLanguage } from "../context/LanguageContext";
import RelationPopup from "../components/RelationPopup";
import { DOCUMENT_TYPE_LABELS, type RefItem } from "../constants/documentTypes";

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
  keywords?: string[];
}

interface Document {
  id: string;
  original_filename: string;
  file_size_bytes: number;
  parse_status: string;
  created_at: string;
  keywords?: string[];
  location?: string | null;
}

export default function CorrespondenceDetail() {
  const { projectId, corrId } = useParams<{ projectId: string; corrId: string }>();
  const navigate = useNavigate();
  const auth = getAuth();
  const { lang, toggle: toggleLang, t } = useLanguage();

  const [corr, setCorr] = useState<CorrDetail | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [refs, setRefs] = useState<RefItem[]>([]);
  const citationRefs = refs.filter((r) => r.ref_role !== "attachment");
  const [showRelations, setShowRelations] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  // Parse status polling — pending/processing belgeler için
  // her 4 saniyede bir kontrol, tümü completed/failed olunca durur
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
    const hasPending = docs.some(
      (d) => d.parse_status === "pending" || d.parse_status === "processing"
    );
    if (!hasPending) return;
    const interval = setInterval(async () => {
      try {
        const updated = await api.get<Document[]>(
          `/projects/${projectId}/documents/?entity_type=correspondence&entity_id=${corrId}`
        );
        if (Array.isArray(updated)) {
          setDocs(updated);
        }
      } catch {
        // Sessizce devam et — polling hata verirse bir sonraki turda dener
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [docs, projectId, corrId]);

  const bg          = "var(--color-bg-primary)";
  const cardBg      = "var(--color-bg-secondary)";
  const border      = "var(--color-border-light)";
  const textPrimary = "var(--color-text-primary)";
  const textSecond  = "var(--color-text-secondary)";
  const alertRed    = "var(--color-alert-red)";
  const warnBg      = "var(--color-warning-bg)";
  const warnBorder  = "var(--color-warning)";

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

  useEffect(() => {
    if (!projectId || !corrId) return;
    api.get<RefItem[]>(`/projects/${projectId}/correspondences/${corrId}/references`)
      .then(setRefs)
      .catch(() => {});
  }, [projectId, corrId]);

  const labelStyle = {
    fontSize: 11,
    fontWeight: 500 as const,
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

  const directionPill = (direction: string) => (
    <span style={{
      fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const,
      letterSpacing: "0.04em", padding: "2px 8px",
      backgroundColor: direction === "incoming" ? "var(--color-success-bg)" : "var(--color-warning-bg)",
      color: direction === "incoming" ? "var(--color-success)" : "var(--color-warning)",
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

  const parseStatusLabel = (status: string | null, lang: string) => {
    if (!status || status === "pending") return null;
    if (status === "processing") return lang === "tr" ? "İşleniyor" : "Processing";
    if (status === "done" || status === "completed") return null;
    if (status === "failed") return lang === "tr" ? "İşlem başarısız" : "Upload failed";
    return null;
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>

      {/* Nav */}
      <nav style={{ backgroundColor: bg, borderBottom: `0.5px solid ${border}`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecond }}>
          <div style={{ width: 2, height: 20, background: "linear-gradient(to bottom, transparent, var(--color-accent) 20%, var(--color-accent) 80%, transparent)" }} />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=correspondence`)}>{t("module.correspondence")}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
            <span style={{ color: textPrimary, fontWeight: 500, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{corr.corr_number}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: textSecond }}>
          <span>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: "1px solid var(--color-border-light)", cursor: "pointer", fontSize: 11, color: textSecond, padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 500, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>

        {/* Parent zinciri breadcrumb */}
        {corr.breadcrumb && corr.breadcrumb.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 16, padding: "8px 12px", backgroundColor: cardBg, borderLeft: `2px solid ${"var(--color-accent)"}` }}>
            <span style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginRight: 4 }}>
              {lang === "tr" ? "Zincir:" : "Chain:"}
            </span>
            {corr.breadcrumb.map((b, idx) => (
              <span key={b.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${b.id}`)}
                  style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--color-accent-text)", cursor: "pointer", textDecoration: "underline" }}
                >
                  {b.corr_number}
                </span>
                {idx < corr.breadcrumb.length - 1 && (
                  <span style={{ fontSize: 11, color: textSecond }}>→</span>
                )}
              </span>
            ))}
            <span style={{ fontSize: 11, color: textSecond }}>→</span>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: textPrimary, fontWeight: 500 }}>{corr.corr_number}</span>
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
              style={{ fontSize: 11, fontWeight: 500, color: warnBorder, background: "none", border: `0.5px solid ${warnBorder}`, padding: "3px 10px", cursor: "pointer", fontFamily: "Inter, sans-serif" }}
            >
              {lang === "tr" ? "En Güncele Git →" : "Go to Latest →"}
            </button>
          </div>
        )}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: textSecond, marginBottom: 4 }}>{corr.corr_number}</p>
            <h1 style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, color: textPrimary, fontWeight: 500, lineHeight: 1.3, marginBottom: 8 }}>{corr.subject}</h1>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {directionPill(corr.direction)}
              <span style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.04em", padding: "2px 8px", backgroundColor: cardBg, color: textSecond }}>{corr.type}</span>
              <span style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.04em", padding: "2px 8px", backgroundColor: cardBg, color: textSecond }}>{corr.status}</span>
              {corr.parent_id && (
                <span style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.04em", padding: "2px 8px", backgroundColor: "var(--color-bg-secondary)", color: "var(--color-text-secondary)" }}>
                  🔗 {lang === "tr" ? "Zincirde" : "In Chain"}
                </span>
              )}
            </div>
          </div>

          {/* Yanıt / Followup butonları */}
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 6, flexShrink: 0, marginLeft: 24 }}>
            <button
              onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/new?mode=response&parent_id=${corr.id}&parent_number=${corr.corr_number}`)}
              style={{ backgroundColor: "var(--color-accent)", color: "var(--color-bg-primary)", border: "none", padding: "6px 12px", fontSize: 11, fontWeight: 500, letterSpacing: "0.5px", cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" as const }}
            >
              {lang === "tr" ? "↩ Yanıt Yaz" : "↩ Write Response"}
            </button>
            <button
              onClick={() => setFlagOpen(true)}
              style={{ backgroundColor: "transparent", color: "var(--color-warning)", border: "1px solid var(--color-warning)", padding: "6px 12px", fontSize: 11, fontWeight: 500, cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif" }}>
              ⚠ {lang === "tr" ? "Potansiyel Etki" : "Potential Impact"}
            </button>
            <button
              onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/new?mode=followup&parent_id=${corr.id}&parent_number=${corr.corr_number}`)}
              style={{ backgroundColor: "transparent", color: "var(--color-accent-text)", border: `1px solid ${"var(--color-accent)"}`, padding: "6px 12px", fontSize: 11, fontWeight: 500, letterSpacing: "0.5px", cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" as const }}
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
          {docs.some(d => d.location) && (
            <div>
              <label style={labelStyle}>{lang === "tr" ? "LOKASYON" : "LOCATION"}</label>
              <p style={fieldStyle}>
                {docs.find(d => d.location)?.location ?? "—"}
              </p>
            </div>
          )}
          {((corr.keywords && corr.keywords.length > 0) ||
            docs.some(d => d.keywords && d.keywords.length > 0)) && (
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>{lang === "tr" ? "ANAHTAR KELİMELER" : "KEYWORDS"}</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginTop: 4 }}>
                {[...new Set([
                  ...(corr.keywords || []),
                  ...docs.flatMap(d => d.keywords || []),
                ])].map((kw, i) => (
                    <span key={i} style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      background: bg,
                      border: `0.5px solid ${border}`,
                      color: textSecond,
                      fontFamily: "JetBrains Mono, monospace",
                    }}>
                      {kw}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>

        {showRelations && projectId && corrId && (
          <RelationPopup
            projectId={projectId}
            entityType="correspondence"
            entityId={corrId}
            onClose={() => setShowRelations(false)}
          />
        )}

        {/* Children — bu yazışmaya verilen yanıtlar */}
        {corr.children && corr.children.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 10 }}>
              {lang === "tr" ? `Yanıtlar / Followuplar (${corr.children.length})` : `Responses / Followups (${corr.children.length})`}
            </div>
            {corr.children.map((child) => (
              <div
                key={child.id}
                onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${child.id}`)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: cardBg, marginBottom: 4, borderLeft: `2px solid ${child.has_response ? textSecond : "var(--color-accent)"}`, cursor: "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--color-accent-text)" }}>{child.corr_number}</span>
                  {directionPill(child.direction)}
                  <span style={{ fontSize: 12, color: textPrimary, fontWeight: 500 }}>{child.subject}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {child.has_response && (
                    <span style={{ fontSize: 11, color: textSecond, fontStyle: "italic" }}>
                      {lang === "tr" ? "yanıtlandı" : "responded"}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: textSecond }}>{child.correspondence_date?.slice(0, 10)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* References (E3 gosterim - RFIDetail aynasi, picker haric) */}
        <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
            {lang === "tr" ? `Referanslar (${citationRefs.length})` : `References (${citationRefs.length})`}
          </div>
          {citationRefs.length === 0 && (
            <p style={{ fontSize: 12, color: textSecond, fontStyle: "italic", margin: 0, fontFamily: "Inter, sans-serif" }}>
              {lang === "tr" ? "Henüz referans yok." : "No references yet."}
            </p>
          )}
          {citationRefs.map((r) => (
            <div key={r.id}
              style={{ padding: "8px 10px", marginBottom: 4, borderLeft: `2px solid var(--color-accent)`, background: "var(--color-bg-primary)" }}>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: textSecond }}>
                {r.document_id ? (
                  <span
                    onClick={async () => {
                      try {
                        const res = await api.get<{ signed_url: string }>(`/projects/${projectId}/documents/${r.document_id}/signed-url`);
                        window.open(res.signed_url, "_blank");
                      } catch {
                        console.error("signed-url alinamadi", r.document_id);
                      }
                    }}
                    style={{ cursor: "pointer", color: "var(--color-accent)", textDecoration: "underline" }}
                    title={lang === "tr" ? "Belgeyi ac" : "Open document"}
                  >
                    {r.target_label ?? "-"}
                  </span>
                ) : (
                  r.target_label ?? "-"
                )}
                {DOCUMENT_TYPE_LABELS[r.ref_type] && (
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.05em", padding: "2px 6px", background: "var(--color-bg-secondary)", color: textSecond }}>
                    {DOCUMENT_TYPE_LABELS[r.ref_type][lang as "en" | "tr"]}
                  </span>
                )}
              </div>
              {r.target_subject && (
                <div style={{ fontSize: 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>{r.target_subject}</div>
              )}
              {r.external_doc_date && (
                <div style={{ fontSize: 11, color: textSecond, marginTop: 2 }}>{r.external_doc_date.slice(0, 10)}</div>
              )}
              {r.note && (
                <div style={{ fontSize: 11, color: textSecond, marginTop: 2, fontStyle: "italic" }}>{r.note}</div>
              )}
            </div>
          ))}
        </div>

        {/* Documents */}
        <div style={{ padding: 20, backgroundColor: cardBg }}>
          <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12 }}>
            {lang === "tr" ? "EKLİ BELGELER" : "ATTACHED DOCUMENTS"} ({docs.length})
          </p>
          {docs.length === 0 ? (
            <p style={{ fontSize: 12, color: textSecond, fontStyle: "italic" }}>{lang === "tr" ? "Belge eklenmemiş." : "No documents attached."}</p>
          ) : (
            docs.map((doc) => (
              <div key={doc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `0.5px solid ${border}` }}>
                <div>
                  <p style={{ fontSize: 12, color: textPrimary, fontWeight: 500 }}>{doc.original_filename}</p>
                  <p style={{ fontSize: 11, color: textSecond, marginTop: 2 }}>
                    {(doc.file_size_bytes / 1024).toFixed(0)} KB
                    {parseStatusLabel(doc.parse_status, lang) && (
                      <span style={{ color: "var(--color-alert-red)", fontSize: 11, fontFamily: "Inter, sans-serif" }}>
                        · {parseStatusLabel(doc.parse_status, lang)}
                      </span>
                    )}
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
                  style={{ fontSize: 11, color: "var(--color-accent-text)", background: "none", border: "none", cursor: "pointer", fontWeight: 500, fontFamily: "Inter, sans-serif" }}
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
            style={{ background: "none", border: `1px solid ${"var(--color-accent)"}`, padding: "8px 16px", fontSize: 12, color: "var(--color-accent-text)", cursor: "pointer", fontFamily: "Inter, sans-serif", fontWeight: 500 }}
          >
            {lang === "tr" ? "← Yazışma Listesine Dön" : "← Back to Correspondence"}
          </button>
        </div>

        <div style={{
          display: "flex", justifyContent: "flex-end",
          marginTop: 24, marginBottom: 8,
        }}>
          <button
            onClick={() => setShowRelations(true)}
            style={{
              background: "var(--color-ai-bg)",
              color: "var(--color-ai)",
              border: "1px solid var(--color-ai)",
              borderRadius: 6,
              padding: "8px 18px",
              fontSize: 11, fontWeight: 500,
              letterSpacing: "0.04em",
              display: "flex", alignItems: "center", gap: 6,
              cursor: "pointer",
              fontFamily: "Inter, sans-serif",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18h6" />
              <path d="M10 22h4" />
              <path d="M12 2a7 7 0 0 0-4.24 12.6c.7.53 1.24 1.4 1.24 2.4v.5h6v-.5c0-1 .54-1.87 1.24-2.4A7 7 0 0 0 12 2z" />
            </svg>
            Benzerlik Tespit Edilen Kayıtlar
          </button>
        </div>
      </div>

      {/* Flag Modal */}
      {flagOpen && (
        <div
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "var(--z-modal)" as unknown as number, padding: 24 }}
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
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 8 }}>
                {lang === "tr" ? "Açıklama *" : "Narrative *"}
              </label>
              <textarea
                value={flagForm.narrative}
                onChange={(e) => setFlagForm({ ...flagForm, narrative: e.target.value })}
                rows={4}
                placeholder={lang === "tr" ? "Potansiyel etkiyi açıklayın..." : "Describe the potential impact..."}
                style={{ width: "100%", padding: "8px 10px", fontSize: 13, color: textPrimary, backgroundColor: "var(--color-bg-primary)", border: `1px solid ${border}`, fontFamily: "Inter, sans-serif", resize: "vertical" as const, boxSizing: "border-box" as const }}
              />
            </div>

            {noticeConfigs.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 8 }}>
                  {lang === "tr" ? "Potansiyel Sözleşme Maddesi (Opsiyonel)" : "Potential Contractual Trigger (Optional)"}
                </label>
                <select
                  value={flagForm.notice_config_id}
                  onChange={(e) => setFlagForm({ ...flagForm, notice_config_id: e.target.value })}
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13, color: textPrimary, backgroundColor: "var(--color-bg-primary)", border: `1px solid ${border}`, fontFamily: "Inter, sans-serif" }}
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
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 8 }}>
                  {lang === "tr" ? "İlgili Belgeler (Opsiyonel)" : "Related Documents (Optional)"}
                </label>
                <div style={{ border: `1px solid ${border}`, padding: "8px 10px", backgroundColor: "var(--color-bg-primary)" }}>
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
                      {parseStatusLabel(d.parse_status, lang) && (
                        <span style={{ color: "var(--color-alert-red)", fontSize: 11, fontFamily: "Inter, sans-serif", marginLeft: "auto" }}>
                          {parseStatusLabel(d.parse_status, lang)}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 8 }}>
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
              <label style={{ display: "block", fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 8 }}>
                {lang === "tr" ? "Bildir" : "Notify"}
              </label>
              <select
                value={flagForm.assigned_to_user}
                onChange={(e) => setFlagForm({ ...flagForm, assigned_to_user: e.target.value })}
                style={{ width: "100%", padding: "8px 10px", fontSize: 13, color: textPrimary, backgroundColor: "var(--color-bg-primary)", border: `1px solid ${border}`, fontFamily: "Inter, sans-serif" }}
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
                  if (!projectId || !corr) return;
                  setFlagSubmitting(true);
                  try {
                    const res = await api.post<{ id: string }>(`/projects/${projectId}/alerts`, {
                      alert_type: "potential_impact",
                      source_entity_type: "correspondence",
                      source_entity_id: corr.id,
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
                style={{ backgroundColor: flagForm.narrative.trim() ? "var(--color-accent)" : "var(--color-border-medium)", color: flagForm.narrative.trim() ? "var(--color-bg-primary)" : textSecond, border: "none", padding: "8px 16px", fontSize: 12, fontWeight: 500, cursor: flagSubmitting ? "wait" : "pointer", fontFamily: "Inter, sans-serif", opacity: flagSubmitting ? 0.6 : 1 }}
              >
                {flagSubmitting
                  ? (lang === "tr" ? "Gönderiliyor…" : "Submitting…")
                  : (lang === "tr" ? "Flag Olarak İşaretle" : "Flag as Potential Impact")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
