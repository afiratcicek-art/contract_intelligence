import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDarkMode } from "../hooks/useDarkMode";
import { api } from "../services/api";
import { getAuth } from "../store/auth";
import { useLanguage } from "../context/LanguageContext";

const ORIGINS = [
  { value: "employer_instruction",  label: "Employer Instruction" },
  { value: "contractor_discovery",  label: "Contractor Discovery" },
  { value: "design_change",         label: "Design Change" },
  { value: "site_condition",        label: "Unforeseen Site Condition" },
  { value: "scope_addition",        label: "Scope Addition" },
  { value: "regulatory",            label: "Regulatory / Statutory" },
  { value: "other",                 label: "Other" },
];

const DEADLINE_SOURCES = [
  { value: "contract", label: "Contract" },
  { value: "manual",   label: "Manual" },
  { value: "custom",   label: "Custom" },
];

const DAY_TYPES = [
  { value: "calendar", label: "Calendar days" },
  { value: "business", label: "Business days" },
];

export default function NewChange() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const dark = useDarkMode();
  const { lang, toggle: toggleLang, t } = useLanguage();
  const auth = getAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    change_number:      "",
    title:              "",
    description:        "",
    origin:             "employer_instruction",
    notice_due_date:    "",
    notice_due_source:  "",
    notice_due_day_type:"",
    impact_due_date:    "",
    impact_due_source:  "",
  });

  const bg          = dark ? "#1F2228" : "#F5F2ED";
  const cardBg      = dark ? "#2E3340" : "#E7E3DC";
  const border      = dark ? "#3D4456" : "#C4AD87";
  const textPrimary = dark ? "#E8E6E0" : "#1C1917";
  const textSecond  = dark ? "#C4B49C" : "#44403C";
  const gold        = dark ? "#A0714A" : "#6B5D3F";
  const alertRed    = dark ? "#E07060" : "#A93226";

  const inputStyle = {
    width: "100%",
    backgroundColor: cardBg,
    border: `1px solid ${border}`,
    color: textPrimary,
    fontSize: 13,
    fontFamily: "Inter, sans-serif",
    padding: "10px 12px",
    borderRadius: 0,
    outline: "none",
  };

  const labelStyle = {
    fontSize: 10,
    fontWeight: 600 as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: textSecond,
    display: "block",
    marginBottom: 6,
  };

  const handleSubmit = async () => {
    if (!form.change_number.trim()) { setError(lang === "tr" ? "Change numarası zorunlu." : "Change number is required."); return; }
    if (!form.title.trim())         { setError(lang === "tr" ? "Başlık zorunlu." : "Title is required."); return; }
    if (!form.origin)               { setError(lang === "tr" ? "Kaynak zorunlu." : "Origin is required."); return; }

    setLoading(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        change_number: form.change_number.trim(),
        title:         form.title.trim(),
        origin:        form.origin,
      };
      if (form.description.trim())      body.description        = form.description.trim();
      if (form.notice_due_date)         body.notice_due_date    = form.notice_due_date;
      if (form.notice_due_source)       body.notice_due_source  = form.notice_due_source;
      if (form.notice_due_day_type)     body.notice_due_day_type = form.notice_due_day_type;
      if (form.impact_due_date)         body.impact_due_date    = form.impact_due_date;
      if (form.impact_due_source)       body.impact_due_source  = form.impact_due_source;

      await api.post<{ id: string }>(`/projects/${projectId}/changes`, body);
      navigate(`/projects/${projectId}/workspace?module=changes`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : (lang === "tr" ? "Kayıt başarısız." : "Save failed."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>

      {/* Nav */}
      <nav style={{ backgroundColor: bg, borderBottom: `0.5px solid ${dark ? "#3D4456" : "#E7E3DC"}`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecond }}>
          <div style={{ width: 2, height: 20, background: `linear-gradient(to bottom, transparent, ${gold} 20%, ${gold} 80%, transparent)` }} />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=changes`)}>{t("module.changes")}</span>
          <span style={{ color: "#C4AD87" }}>/</span>
          <span style={{ color: textPrimary, fontWeight: 500 }}>{lang === "tr" ? "Yeni Change" : "New Change"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: textSecond }}>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: `1px solid ${dark ? "#3D4456" : "#C4AD87"}`, cursor: "pointer", fontSize: 11, color: textSecond, padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 600, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>

        <p style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 20, color: textPrimary, fontWeight: 600, marginBottom: 8 }}>
          {lang === "tr" ? "Yeni Change" : "New Change"}
        </p>
        <p style={{ fontSize: 13, color: textSecond, marginBottom: 28 }}>
          {lang === "tr" ? "Yeni bir değişiklik talebi oluşturun." : "Open a new change case."}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Number + Origin */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>{lang === "tr" ? "Change Numarası *" : "Change Number *"}</label>
              <input
                style={inputStyle}
                value={form.change_number}
                onChange={(e) => setForm({ ...form, change_number: e.target.value })}
                placeholder="CH-001"
              />
            </div>
            <div>
              <label style={labelStyle}>{lang === "tr" ? "Kaynak *" : "Origin *"}</label>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={form.origin}
                onChange={(e) => setForm({ ...form, origin: e.target.value })}
              >
                {ORIGINS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Title */}
          <div>
            <label style={labelStyle}>{lang === "tr" ? "Başlık *" : "Title *"}</label>
            <input
              style={inputStyle}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={lang === "tr" ? "Change'in kısa başlığı" : "Short title of the change"}
            />
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>{lang === "tr" ? "Açıklama" : "Description"}</label>
            <textarea
              style={{ ...inputStyle, minHeight: 90, resize: "vertical" as const }}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={lang === "tr" ? "Arka plan, etkilenen kapsam..." : "Background, affected scope..."}
            />
          </div>

          {/* Notice Deadline */}
          <div style={{ padding: 16, backgroundColor: cardBg, border: `0.5px solid ${border}` }}>
            <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 6 }}>
              {lang === "tr" ? "Notice Deadline (Opsiyonel)" : "Notice Deadline (Optional)"}
            </p>
            <p style={{ fontSize: 11, color: textSecond, fontStyle: "italic", marginBottom: 12 }}>
              {lang === "tr" ? "Boş bırakılırsa proje konfigürasyonundan hesaplanır." : "If empty, calculated from project configuration."}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>{lang === "tr" ? "Tarih" : "Date"}</label>
                <input type="date" style={inputStyle} value={form.notice_due_date}
                  onChange={(e) => setForm({ ...form, notice_due_date: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>{lang === "tr" ? "Kaynak" : "Source"}</label>
                <select style={{ ...inputStyle, cursor: "pointer" }} value={form.notice_due_source}
                  onChange={(e) => setForm({ ...form, notice_due_source: e.target.value })}>
                  <option value="">—</option>
                  {DEADLINE_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{lang === "tr" ? "Gün Tipi" : "Day Type"}</label>
                <select style={{ ...inputStyle, cursor: "pointer" }} value={form.notice_due_day_type}
                  onChange={(e) => setForm({ ...form, notice_due_day_type: e.target.value })}>
                  <option value="">—</option>
                  {DAY_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Impact Deadline */}
          <div style={{ padding: 16, backgroundColor: cardBg, border: `0.5px solid ${border}` }}>
            <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 6 }}>
              {lang === "tr" ? "Impact Submission Deadline (Opsiyonel)" : "Impact Submission Deadline (Optional)"}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>{lang === "tr" ? "Tarih" : "Date"}</label>
                <input type="date" style={inputStyle} value={form.impact_due_date}
                  onChange={(e) => setForm({ ...form, impact_due_date: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>{lang === "tr" ? "Kaynak" : "Source"}</label>
                <select style={{ ...inputStyle, cursor: "pointer" }} value={form.impact_due_source}
                  onChange={(e) => setForm({ ...form, impact_due_source: e.target.value })}>
                  <option value="">—</option>
                  {DEADLINE_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && <p style={{ fontSize: 12, color: alertRed }}>{error}</p>}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{ backgroundColor: gold, color: dark ? "#E8E6E0" : "#F5F2ED", border: "none", padding: "10px 24px", fontSize: 13, fontWeight: 600, letterSpacing: "0.5px", cursor: loading ? "not-allowed" : "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", opacity: loading ? 0.7 : 1 }}
            >
              {loading ? (lang === "tr" ? "Kaydediliyor..." : "Saving...") : (lang === "tr" ? "Kaydet" : "Save")}
            </button>
            <button
              onClick={() => navigate(`/projects/${projectId}/workspace?module=changes`)}
              style={{ backgroundColor: "transparent", color: textSecond, border: `1px solid ${border}`, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif" }}
            >
              {lang === "tr" ? "İptal" : "Cancel"}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
