import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useDarkMode } from "../hooks/useDarkMode";
import { api } from "../services/api";
import { getAuth } from "../store/auth";
import { useLanguage } from "../context/LanguageContext";

interface Party {
  id: string;
  party_name: string;
  party_type: string;
}

const CORR_TYPES = [
  { value: "letter", label: "Letter" },
  { value: "email", label: "Email" },
  { value: "notice", label: "Notice" },
  { value: "instruction", label: "Instruction" },
  { value: "certificate", label: "Certificate" },
  { value: "report", label: "Report" },
  { value: "request", label: "Request" },
  { value: "other", label: "Other" },
];

export default function NewCorrespondence() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const dark = useDarkMode();
  const { lang, toggle: toggleLang, t } = useLanguage();
  const auth = getAuth();
  const location = useLocation();
  const qp = new URLSearchParams(location.search);
  const mode = qp.get("mode") ?? "new";
  const parentId = qp.get("parent_id") ?? null;
  const parentNumber = qp.get("parent_number") ?? null;

  const [direction, setDirection] = useState<"incoming" | "outgoing" | null>(
    mode === "response" || mode === "followup" ? "outgoing" : null
  );
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  const [form, setForm] = useState({
    corr_number: "",
    type: "letter",
    subject: "",
    correspondence_date: new Date().toISOString().slice(0, 10),
    external_ref: "",
    from_party_id: "",
    to_party_id: "",
  });

  const bg = dark ? "#1F2228" : "#F5F2ED";
  const cardBg = dark ? "#2E3340" : "#E7E3DC";
  const border = dark ? "#3D4456" : "#E7E3DC";
  const textPrimary = dark ? "#E8E6E0" : "#1C1917";
  const textSecondary = dark ? "#C4B49C" : "#44403C";
  const gold = dark ? "#A0714A" : "#6B5D3F";

  useEffect(() => {
    api.get<Party[]>(`/projects/${projectId}/parties`)
      .then(setParties)
      .catch(() => setParties([]));
  }, [projectId]);

  // Parent correspondence fetch — mode=response veya followup ise
  useEffect(() => {
    if (!parentId || !projectId) return;
    if (mode !== "response" && mode !== "followup") return;
    api.get<{ subject: string; direction: string; corr_number: string }>(`/projects/${projectId}/correspondences/${parentId}`)
      .then((parent) => {
        // Direction: response → tersine çevir, followup → aynı
        const newDirection = mode === "response"
          ? (parent.direction === "outgoing" ? "incoming" : "outgoing")
          : parent.direction as "incoming" | "outgoing";
        setDirection(newDirection);
        // Subject prefix
        const prefix = mode === "response" ? "Re: " : "Fw: ";
        setForm((prev) => ({
          ...prev,
          subject: prefix + (parent.subject ?? ""),
        }));
      })
      .catch(() => {});
  }, [parentId, projectId, mode]);

  // mode=response veya followup ama parent_id yoksa listeye yönlendir
  useEffect(() => {
    if ((mode === "response" || mode === "followup") && !parentId) {
      navigate(`/projects/${projectId}/workspace?module=correspondence`);
    }
  }, [mode, parentId]);

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
    color: textSecondary,
    display: "block",
    marginBottom: 6,
  };

  const handleSubmit = async () => {
    if (!direction) { setError("Lütfen gönderim yönünü seçin."); return; }
    if (!form.corr_number.trim()) { setError("Correspondence numarası zorunlu."); return; }
    if (!form.subject.trim()) { setError("Konu zorunlu."); return; }
    if (!form.correspondence_date) { setError("Tarih zorunlu."); return; }

    setLoading(true);
    setError(null);
    setUploadErrors([]);
    try {
      const body: Record<string, unknown> = {
        corr_number: form.corr_number.trim(),
        direction,
        type: form.type,
        subject: form.subject.trim(),
        correspondence_date: form.correspondence_date,
      };
      if (parentId) body.parent_id = parentId;
      if (form.external_ref.trim()) body.external_ref = form.external_ref.trim();
      if (form.from_party_id) body.from_party_id = form.from_party_id;
      if (form.to_party_id) body.to_party_id = form.to_party_id;

      const corr = await api.post<{ id: string }>(`/projects/${projectId}/correspondences`, body);

      if (selectedFiles.length > 0 && corr.id) {
        const uploadResults = await Promise.all(
          selectedFiles.map(async (file) => {
            const formData = new FormData();
            formData.append("file", file);
            try {
              const uploadRes = await fetch(
                `/api/v1/projects/${projectId}/documents/upload?entity_type=correspondence&entity_id=${corr.id}`,
                { method: "POST", credentials: "include", body: formData }
              );
              if (!uploadRes.ok) {
                const errData = await uploadRes.json().catch(() => ({}));
                return `${file.name}: ${errData.detail ?? "Yükleme başarısız"}`;
              }
              return null;
            } catch {
              return `${file.name}: Bağlantı hatası`;
            }
          })
        );
        const errors = uploadResults.filter((e): e is string => e !== null);
        if (errors.length > 0) setUploadErrors(errors);
      }

      navigate(`/projects/${projectId}/workspace?module=correspondence`);
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecondary }}>
          <div style={{ width: 2, height: 20, background: "linear-gradient(to bottom, transparent, #6B5D3F 20%, #6B5D3F 80%, transparent)" }} />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: textSecondary }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span style={{ color: textSecondary }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=correspondence`)}>{t("module.correspondence")}</span>
          <span style={{ color: textSecondary }}>/</span>
          <span style={{ color: textPrimary, fontWeight: 500 }}>
            {mode === "response"
              ? (lang === "tr" ? `Yanıt — ${parentNumber ?? ""}` : `Response to ${parentNumber ?? ""}`)
              : mode === "followup"
              ? (lang === "tr" ? `Followup — ${parentNumber ?? ""}` : `Followup to ${parentNumber ?? ""}`)
              : (lang === "tr" ? "Yeni Yazışma" : "New Correspondence")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: textSecondary }}>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: `1px solid ${dark ? "#3D4456" : "#E7E3DC"}`, cursor: "pointer", fontSize: 11, color: textSecondary, padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 600, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>

        {/* Direction selector */}
        {!direction && (
          <div>
            <p style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, color: textPrimary, fontWeight: 600, marginBottom: 8 }}>
              {lang === "tr" ? "Yeni Yazışma" : "New Correspondence"}
            </p>
            <p style={{ fontSize: 13, color: textSecondary, marginBottom: 32 }}>
              {lang === "tr" ? "Bu yazışma hangi yönde?" : "Which direction is this correspondence?"}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <button
                onClick={() => setDirection("outgoing")}
                style={{ padding: "20px 24px", backgroundColor: cardBg, border: `1px solid ${border}`, cursor: "pointer", textAlign: "left", borderRadius: 0 }}
              >
                <p style={{ fontSize: 13, fontWeight: 600, color: textPrimary, marginBottom: 4, fontFamily: "Inter, sans-serif" }}>Outgoing →</p>
                <p style={{ fontSize: 11, color: textSecondary, fontFamily: "Inter, sans-serif" }}>{lang === "tr" ? "Bizden karşı tarafa gönderilen yazışma" : "Outgoing correspondence to the other party"}</p>
              </button>
              <button
                onClick={() => setDirection("incoming")}
                style={{ padding: "20px 24px", backgroundColor: cardBg, border: `1px solid ${border}`, cursor: "pointer", textAlign: "left", borderRadius: 0 }}
              >
                <p style={{ fontSize: 13, fontWeight: 600, color: textPrimary, marginBottom: 4, fontFamily: "Inter, sans-serif" }}>← Incoming</p>
                <p style={{ fontSize: 11, color: textSecondary, fontFamily: "Inter, sans-serif" }}>{lang === "tr" ? "Karşı taraftan bize gelen yazışma" : "Incoming correspondence from the other party"}</p>
              </button>
            </div>
          </div>
        )}

        {/* Form */}
        {direction && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <p style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, color: textPrimary, fontWeight: 600, marginBottom: 8 }}>
                {mode === "response"
                  ? (lang === "tr" ? `Yanıt: ${parentNumber ?? ""}` : `Response to ${parentNumber ?? ""}`)
                  : mode === "followup"
                  ? (lang === "tr" ? `Followup: ${parentNumber ?? ""}` : `Followup to ${parentNumber ?? ""}`)
                  : direction === "outgoing"
                  ? (lang === "tr" ? "Giden Yazışma" : "Outgoing Correspondence")
                  : (lang === "tr" ? "Gelen Yazışmayı Kaydet" : "Register Incoming Correspondence")}
              </p>
              <button
                onClick={() => setDirection(null)}
                style={{ fontSize: 11, color: textSecondary, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontFamily: "Inter, sans-serif" }}
              >
                {lang === "tr" ? "Değiştir" : "Change"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Corr Number + Type */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>{lang === "tr" ? "Numara *" : "Number *"}</label>
                  <input
                    style={inputStyle}
                    value={form.corr_number}
                    onChange={(e) => setForm({ ...form, corr_number: e.target.value })}
                    placeholder="CORR-001"
                  />
                </div>
                <div>
                  <label style={labelStyle}>{lang === "tr" ? "Tip *" : "Type *"}</label>
                  <select
                    style={{ ...inputStyle, cursor: "pointer" }}
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                    {CORR_TYPES.map((ct) => (
                      <option key={ct.value} value={ct.value}>{ct.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Subject */}
              <div>
                <label style={labelStyle}>{lang === "tr" ? "Konu *" : "Subject *"}</label>
                <input
                  style={inputStyle}
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder={lang === "tr" ? "Yazışmanın konusu" : "Subject of correspondence"}
                />
              </div>

              {/* Date + External Ref */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>{lang === "tr" ? "Tarih *" : "Date *"}</label>
                  <input
                    type="date"
                    style={inputStyle}
                    value={form.correspondence_date}
                    onChange={(e) => setForm({ ...form, correspondence_date: e.target.value })}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{lang === "tr" ? "Karşı Taraf Ref No" : "Ext. Reference No"}</label>
                  <input
                    style={inputStyle}
                    value={form.external_ref}
                    onChange={(e) => setForm({ ...form, external_ref: e.target.value })}
                    placeholder="Opsiyonel"
                  />
                </div>
              </div>

              {/* Parties */}
              {parties.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>{lang === "tr" ? "Gönderen" : "From"}</label>
                    <select
                      style={{ ...inputStyle, cursor: "pointer" }}
                      value={form.from_party_id}
                      onChange={(e) => setForm({ ...form, from_party_id: e.target.value })}
                    >
                      <option value="">{lang === "tr" ? "Seçin..." : "Select..."}</option>
                      {parties.map((p) => (
                        <option key={p.id} value={p.id}>{p.party_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>{lang === "tr" ? "Alıcı" : "To"}</label>
                    <select
                      style={{ ...inputStyle, cursor: "pointer" }}
                      value={form.to_party_id}
                      onChange={(e) => setForm({ ...form, to_party_id: e.target.value })}
                    >
                      <option value="">{lang === "tr" ? "Seçin..." : "Select..."}</option>
                      {parties.map((p) => (
                        <option key={p.id} value={p.id}>{p.party_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Dosya yükleme */}
              <div>
                <label style={labelStyle}>{lang === "tr" ? "Belgeler (birden fazla seçilebilir)" : "Documents (multiple allowed)"}</label>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <label
                    style={{
                      padding: "8px 16px",
                      backgroundColor: cardBg,
                      border: `1px solid ${border}`,
                      color: textSecondary,
                      fontSize: 12,
                      fontFamily: "Inter, sans-serif",
                      cursor: "pointer",
                      borderRadius: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {lang === "tr" ? "Dosya Seç" : "Select File"}
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.jpg,.jpeg,.png,.dwg,.dxf,.txt,.csv"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        setSelectedFiles((prev) => {
                          const names = new Set(prev.map((f) => f.name));
                          return [...prev, ...files.filter((f) => !names.has(f.name))];
                        });
                      }}
                    />
                  </label>
                  <span style={{ fontSize: 11, color: textSecondary, fontStyle: "italic" }}>
                    PDF, Word, Excel, PowerPoint, Görsel, DWG, DXF, TXT, CSV
                  </span>
                </div>
                {selectedFiles.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {selectedFiles.map((file, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", backgroundColor: cardBg, borderLeft: `2px solid ${gold}` }}>
                        <span style={{ fontSize: 12, color: textPrimary, flex: 1 }}>{file.name}</span>
                        <span style={{ fontSize: 10, color: textSecondary }}>{(file.size / 1024).toFixed(0)} KB</span>
                        <button
                          onClick={() => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))}
                          style={{ background: "none", border: "none", color: textSecondary, cursor: "pointer", fontSize: 14, padding: 0 }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {uploadErrors.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {uploadErrors.map((err, idx) => (
                      <p key={idx} style={{ fontSize: 11, color: dark ? "#E07060" : "#A93226", margin: "2px 0" }}>{err}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* Response due note */}
              <p style={{ fontSize: 11, color: textSecondary, fontStyle: "italic" }}>
                {lang === "tr" ? "Response deadline proje konfigürasyonuna göre otomatik hesaplanacak." : "Response deadline will be calculated automatically based on project configuration."}
              </p>

              {/* Error */}
              {error && (
                <p style={{ fontSize: 12, color: dark ? "#E07060" : "#A93226" }}>{error}</p>
              )}

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
                  onClick={() => navigate(`/projects/${projectId}/workspace`)}
                  style={{ backgroundColor: "transparent", color: textSecondary, border: `1px solid ${border}`, padding: "10px 24px", fontSize: 13, fontWeight: 600, cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif" }}
                >
                  {lang === "tr" ? "İptal" : "Cancel"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
