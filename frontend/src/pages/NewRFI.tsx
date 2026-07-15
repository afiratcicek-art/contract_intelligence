import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { api, fetchLinkableDocuments, type LinkableDoc } from "../services/api";
import { DOCUMENT_TYPE_LABELS } from "../constants/documentTypes";
import { getAuth } from "../store/auth";
import { useLanguage } from "../context/LanguageContext";

const DISCIPLINES = [
  { value: "", label: "—" },
  { value: "Civil", label: "Civil" },
  { value: "Architectural", label: "Architectural" },
  { value: "Structural", label: "Structural" },
  { value: "Mechanical", label: "Mechanical" },
  { value: "Electrical", label: "Electrical" },
  { value: "Plumbing", label: "Plumbing" },
  { value: "Other", label: "Other" },
];

const DEADLINE_SOURCES = [
  { value: "contract", label: "Contract" },
  { value: "manual", label: "Manual" },
  { value: "custom", label: "Custom" },
];

const DAY_TYPES = [
  { value: "calendar", label: "Calendar days" },
  { value: "business", label: "Business days" },
];

export default function NewRFI() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { lang, toggle: toggleLang, t } = useLanguage();
  const auth = getAuth();
  const location = useLocation();
  const qp = new URLSearchParams(location.search);
  const mode = qp.get("mode") ?? "new";
  const parentId = qp.get("parent_id") ?? null;
  const parentNumber = qp.get("parent_number") ?? null;
  const rfiType = mode === "response" ? "response" : mode === "revision" ? "revision" : "original";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [docKeywords, setDocKeywords] = useState("");
  const [docLocation, setDocLocation] = useState("");

  const today = new Date().toISOString().slice(0, 10);

  // Parent RFI verisini çek — mode=response veya revision ise
  useEffect(() => {
    if (!parentId || !projectId) return;
    api.get<{ subject: string; discipline: string | null }>(`/projects/${projectId}/rfis/${parentId}`)
      .then((parent) => {
        const prefix = mode === "revision" ? "Revision 1 - " : "Response to: ";
        setForm((prev) => ({
          ...prev,
          subject: prefix + (parent.subject ?? ""),
          discipline: parent.discipline ?? prev.discipline,
        }));
      })
      .catch(() => {});
  }, [parentId, projectId, mode]);

  const [form, setForm] = useState({
    rfi_number: "",
    subject: "",
    description: "",
    discipline: "",
    submitted_by: "",
    submitted_date: today,
    external_ref: "",
    response_due_date: "",
    response_due_source: "",
    response_due_day_type: "",
  });
  const [entryMode, setEntryMode] = useState<"authored" | "recorded" | null>(null);

  // Olusturma-ani referanslar (MIMARI-YON-1). Bellekte birikir,
  // submit'te body.references'a katilir. Backend: create_rfi (E1, d83706e).
  // Sekil = RFIReferenceAdd alt kumesi; _display yalniz UI listesi icin,
  // body'ye GITMEZ (backend _display bilmez -> soyulur).
  const [pendingRefs, setPendingRefs] = useState<Array<{
    ref_type: string;
    rfi_id?: string;
    ref_corr_id?: string;
    change_id?: string;
    document_id?: string;
    external_doc_number?: string;
    external_doc_title?: string;
    external_doc_date?: string;
    note?: string;
    _display: string;
  }>>([]);
  const [linkable, setLinkable] = useState<LinkableDoc[]>([]);
  const [refSearch, setRefSearch] = useState("");
  const [showRefDropdown, setShowRefDropdown] = useState(false);
  const [showManualRef, setShowManualRef] = useState(false);
  const [manualRef, setManualRef] = useState({ number: "", title: "", date: "", type: "", note: "" });
  const refPickerRef = useRef<HTMLDivElement>(null);

  const bg            = "var(--color-bg-primary)";
  const cardBg        = "var(--color-bg-secondary)";
  const border        = "var(--color-border-light)";
  const textPrimary   = "var(--color-text-primary)";
  const textSecondary = "var(--color-text-secondary)";
  const alertRed      = "var(--color-alert-red)";

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
    fontSize: 11,
    fontWeight: 500 as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: textSecondary,
    display: "block",
    marginBottom: 6,
  };

  // Linkable dokuman listesi (RFI + Correspondence) — referans picker icin.
  useEffect(() => {
    if (!projectId) return;
    fetchLinkableDocuments(projectId).then(setLinkable).catch(() => setLinkable([]));
  }, [projectId]);
  useEffect(() => {
    if (!showRefDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (refPickerRef.current && !refPickerRef.current.contains(e.target as Node)) {
        setShowRefDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showRefDropdown]);
  const filteredLinkable = linkable.filter((d) => {
    const q = refSearch.toLowerCase();
    return (
      !pendingRefs.some((r) =>
        (d.type === "rfi" && r.rfi_id === d.id) ||
        (d.type === "correspondence" && r.ref_corr_id === d.id)
      ) &&
      (d.ref_number.toLowerCase().includes(q) || d.subject.toLowerCase().includes(q))
    );
  });
  // Bellek versiyonu (MIMARI-YON-1): API'ye POST yok, pendingRefs'e eklenir.
  // submit'te body.references'a katilir; _display yalniz UI, backend'e gitmez.
  const addRefFromDoc = (doc: LinkableDoc) => {
    setPendingRefs((prev) => [
      ...prev,
      {
        ref_type: doc.type === "rfi" ? "rfi" : "correspondence",
        rfi_id: doc.type === "rfi" ? doc.id : undefined,
        ref_corr_id: doc.type === "correspondence" ? doc.id : undefined,
        _display: `${doc.ref_number} — ${doc.subject}`,
      },
    ]);
    setRefSearch("");
    setShowRefDropdown(false);
  };
  // 'other' turunde kullanicinin girdigi kunye note alanina yazilir (TB-59):
  // rfi_references'ta serbest tip aciklamasi icin ayri kolon yok.
  const addManualRef = () => {
    if (!manualRef.number.trim() || !manualRef.type) return;
    setPendingRefs((prev) => [
      ...prev,
      {
        ref_type: manualRef.type,
        external_doc_number: manualRef.number.trim(),
        external_doc_title: manualRef.title.trim() || undefined,
        external_doc_date: manualRef.date || undefined,
        note: manualRef.note.trim() || undefined,
        _display: manualRef.title.trim()
          ? `${manualRef.number.trim()} — ${manualRef.title.trim()}`
          : manualRef.number.trim(),
      },
    ]);
    setManualRef({ number: "", title: "", date: "", type: "", note: "" });
    setShowManualRef(false);
  };
  const canAddManual = manualRef.number.trim() !== "" && manualRef.type !== "";

  const handleSubmit = async () => {
    if (!form.rfi_number.trim()) { setError(lang === "tr" ? "RFI numarası zorunlu." : "RFI number is required."); return; }
    if (!form.subject.trim()) { setError(lang === "tr" ? "Konu zorunlu." : "Subject is required."); return; }
    if (entryMode === "recorded" && !form.submitted_date) { setError(lang === "tr" ? "Gönderim tarihi zorunlu." : "Submission date is required."); return; }

    setLoading(true);
    setError(null);
    setUploadErrors([]);

    try {
      const body: Record<string, unknown> = {
        rfi_number: form.rfi_number.trim(),
        subject: form.subject.trim(),
        ...(entryMode === "recorded" ? { submitted_date: form.submitted_date } : {}),
        rfi_type: rfiType,
        entry_mode: entryMode,
      };
      if (parentId) body.parent_id = parentId;
      if (form.description.trim()) body.description = form.description.trim();
      if (form.discipline) body.discipline = form.discipline;
      if (form.submitted_by.trim()) body.submitted_by = form.submitted_by.trim();
      if (form.external_ref.trim()) body.external_ref = form.external_ref.trim();
      if (form.response_due_date) body.response_due_date = form.response_due_date;
      if (form.response_due_source) body.response_due_source = form.response_due_source;
      if (form.response_due_day_type) body.response_due_day_type = form.response_due_day_type;

      // keywords: dosya eki olmasa da card'a yazılır (TB-17 resolved)
      if (docKeywords.trim()) {
        body.keywords = docKeywords
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean);
      }

      if (pendingRefs.length > 0) {
        body.references = pendingRefs.map(({ _display, ...ref }) => ref);
      }

      const rfi = await api.post<{ id: string }>(`/projects/${projectId}/rfis`, body);

      if (selectedFiles.length > 0 && rfi.id) {
        const uploadResults = await Promise.all(
          selectedFiles.map(async (file) => {
            const formData = new FormData();
            formData.append("file", file);
            try {
              const uploadRes = await fetch(
                `/api/v1/projects/${projectId}/documents/upload?entity_type=rfi&entity_id=${rfi.id}${docKeywords.trim() ? `&keywords=${encodeURIComponent(docKeywords.trim())}` : ""}${docLocation.trim() ? `&location=${encodeURIComponent(docLocation.trim())}` : ""}`,
                { method: "POST", credentials: "include", body: formData }
              );
              if (!uploadRes.ok) {
                const errData = await uploadRes.json().catch(() => ({}));
                return `${file.name}: ${errData.detail ?? (lang === "tr" ? "Yükleme başarısız" : "Upload failed")}`;
              }
              return null;
            } catch {
              return `${file.name}: ${lang === "tr" ? "Bağlantı hatası" : "Connection error"}`;
            }
          })
        );
        const errors = uploadResults.filter((e): e is string => e !== null);
        if (errors.length > 0) setUploadErrors(errors);
      }

      navigate(`/projects/${projectId}/workspace?module=rfis`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : (lang === "tr" ? "Kayıt başarısız." : "Save failed."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>
      {/* Nav */}
      <nav style={{ backgroundColor: bg, borderBottom: `0.5px solid ${border}`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecondary }}>
          <div style={{ width: 2, height: 20, background: `linear-gradient(to bottom, transparent, ${"var(--color-accent)"} 20%, ${"var(--color-accent)"} 80%, transparent)` }} />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: textSecondary }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span style={{ color: textSecondary }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=rfis`)}>{t("module.rfis")}</span>
          <span style={{ color: textSecondary }}>/</span>
          <span style={{ color: textPrimary, fontWeight: 500 }}>
            {mode === "response"
              ? (lang === "tr" ? `Yanıt — ${parentNumber ?? ""}` : `Response to ${parentNumber ?? ""}`)
              : mode === "revision"
              ? (lang === "tr" ? `Revize — ${parentNumber ?? ""}` : `Revision of ${parentNumber ?? ""}`)
              : (lang === "tr" ? "Yeni RFI" : "New RFI")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: textSecondary }}>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: "1px solid var(--color-border-light)", cursor: "pointer", fontSize: 11, color: textSecondary, padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 500, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
        <p style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, color: textPrimary, fontWeight: 500, marginBottom: 8 }}>
          {mode === "response"
            ? (lang === "tr" ? `Yanıt: ${parentNumber ?? ""}` : `Response to ${parentNumber ?? ""}`)
            : mode === "revision"
            ? (lang === "tr" ? `Revize: ${parentNumber ?? ""}` : `Revision of ${parentNumber ?? ""}`)
            : (lang === "tr" ? "Yeni RFI" : "New RFI")}
        </p>
        <p style={{ fontSize: 13, color: textSecondary, marginBottom: 28 }}>
          {mode === "response"
            ? (lang === "tr" ? "Bu RFI için yanıt oluşturun." : "Create a response to this RFI.")
            : mode === "revision"
            ? (lang === "tr" ? "Bu RFI için revize oluşturun." : "Create a revision of this RFI.")
            : (lang === "tr" ? "Bilgi talebi oluşturun." : "Create a request for information.")}
        </p>

        {entryMode === null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 28 }}>
            <button
              onClick={() => setEntryMode("authored")}
              style={{
                backgroundColor: cardBg,
                border: `1px solid ${border}`,
                padding: "16px 20px",
                textAlign: "left" as const,
                cursor: "pointer",
                borderRadius: 0,
                fontFamily: "Inter, sans-serif",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: textPrimary, display: "block", marginBottom: 6 }}>
                {lang === "tr" ? "RFI Yaz" : "Author RFI"}
              </span>
              <span style={{ fontSize: 11, color: textSecondary, lineHeight: 1.5 }}>
                {lang === "tr"
                  ? "Platformda yazılır. Taslak olarak doğar, onaylandığında muhataba çıkar."
                  : "Written on the platform. Born as a draft; issued when approved."}
              </span>
            </button>
            <button
              onClick={() => setEntryMode("recorded")}
              style={{
                backgroundColor: cardBg,
                border: `1px solid ${border}`,
                padding: "16px 20px",
                textAlign: "left" as const,
                cursor: "pointer",
                borderRadius: 0,
                fontFamily: "Inter, sans-serif",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: textPrimary, display: "block", marginBottom: 6 }}>
                {lang === "tr" ? "RFI Kaydet" : "Record RFI"}
              </span>
              <span style={{ fontSize: 11, color: textSecondary, lineHeight: 1.5 }}>
                {lang === "tr"
                  ? "Dışarıda yazılmış belge kayda geçiriliyor. Doğrudan açık olur."
                  : "An externally issued document is being recorded. Opens directly."}
              </span>
            </button>
          </div>
        )}

        {entryMode !== null && (
          <>
            <button
              onClick={() => setEntryMode(null)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                marginBottom: 20,
                fontSize: 11,
                fontWeight: 500,
                color: "var(--color-accent-text)",
                cursor: "pointer",
                fontFamily: "Inter, sans-serif",
                borderRadius: 0,
              }}
            >
              {lang === "tr" ? "← Giriş türünü değiştir" : "← Change entry type"}
            </button>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* RFI Number + Discipline */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>{lang === "tr" ? "RFI Numarası *" : "RFI Number *"}</label>
                  <input
                    style={inputStyle}
                    value={form.rfi_number}
                    onChange={(e) => setForm({ ...form, rfi_number: e.target.value })}
                    placeholder="RFI-001"
                  />
                </div>
                <div>
                  <label style={labelStyle}>{lang === "tr" ? "Disiplin" : "Discipline"}</label>
                  <select
                    style={{ ...inputStyle, cursor: "pointer" }}
                    value={form.discipline}
                    onChange={(e) => setForm({ ...form, discipline: e.target.value })}
                  >
                    {DISCIPLINES.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
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
                  placeholder={lang === "tr" ? "RFI konusu" : "Subject of the RFI"}
                />
              </div>

              {/* Description */}
              <div>
                <label style={labelStyle}>{lang === "tr" ? "Açıklama" : "Description"}</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 100, resize: "vertical" as const }}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={lang === "tr" ? "Detaylar, arka plan bilgisi..." : "Details, background information..."}
                />
              </div>

              {/* Submitted by + Date */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>{lang === "tr" ? "Gönderen" : "Submitted By"}</label>
                  <input
                    style={inputStyle}
                    value={form.submitted_by}
                    onChange={(e) => setForm({ ...form, submitted_by: e.target.value })}
                    placeholder={lang === "tr" ? "İsim veya şirket" : "Name or company"}
                  />
                </div>
                <div>
                  {entryMode === "recorded" ? (
                    <>
                      <label style={labelStyle}>{lang === "tr" ? "Gönderim Tarihi *" : "Submission Date *"}</label>
                      <input
                        type="date"
                        style={inputStyle}
                        value={form.submitted_date}
                        onChange={(e) => setForm({ ...form, submitted_date: e.target.value })}
                      />
                    </>
                  ) : (
                    <p style={{ fontSize: 11, color: textSecondary, fontStyle: "italic", margin: "24px 0 0", lineHeight: 1.5 }}>
                      {lang === "tr" ? "Gönderim tarihi onay anında atanır." : "Submission date is set at approval."}
                    </p>
                  )}
                </div>
              </div>

              {/* Deadline — opsiyonel, manuel override */}
              <div style={{ padding: 16, backgroundColor: cardBg, border: `0.5px solid ${border}` }}>
                <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecondary, marginBottom: 12 }}>
                  {lang === "tr" ? "Deadline (Opsiyonel)" : "Deadline (Optional)"}
                </p>
                <p style={{ fontSize: 11, color: textSecondary, fontStyle: "italic", marginBottom: 12 }}>
                  {lang === "tr" ? "Boş bırakılırsa proje konfigürasyonuna göre otomatik hesaplanır." : "If left empty, calculated automatically from project configuration."}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>{lang === "tr" ? "Yanıt Tarihi" : "Response Due"}</label>
                    <input
                      type="date"
                      style={inputStyle}
                      value={form.response_due_date}
                      onChange={(e) => setForm({ ...form, response_due_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>{lang === "tr" ? "Kaynak" : "Source"}</label>
                    <select
                      style={{ ...inputStyle, cursor: "pointer" }}
                      value={form.response_due_source}
                      onChange={(e) => setForm({ ...form, response_due_source: e.target.value })}
                    >
                      <option value="">—</option>
                      {DEADLINE_SOURCES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>{lang === "tr" ? "Gün Tipi" : "Day Type"}</label>
                    <select
                      style={{ ...inputStyle, cursor: "pointer" }}
                      value={form.response_due_day_type}
                      onChange={(e) => setForm({ ...form, response_due_day_type: e.target.value })}
                    >
                      <option value="">—</option>
                      {DAY_TYPES.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* External Ref */}
              <div>
                <label style={labelStyle}>{lang === "tr" ? "Harici Referans" : "External Reference"}</label>
                <input
                  style={inputStyle}
                  value={form.external_ref}
                  onChange={(e) => setForm({ ...form, external_ref: e.target.value })}
                  placeholder={lang === "tr" ? "Karşı taraf referans numarası (opsiyonel)" : "Other party reference number (optional)"}
                />
              </div>

              {/* Referanslar (opsiyonel) — olusturma aninda eklenir (MIMARI-YON-1) */}
              <div>
                <label style={labelStyle}>{lang === "tr" ? "Referanslar" : "References"}</label>
                {pendingRefs.length === 0 && (
                  <p style={{ fontSize: 12, color: textSecondary, fontStyle: "italic", margin: "0 0 12px", fontFamily: "Inter, sans-serif" }}>
                    {lang === "tr" ? "Henüz referans yok." : "No references yet."}
                  </p>
                )}
                {pendingRefs.map((r, idx) => (
                  <div key={idx}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", marginBottom: 4, borderLeft: `2px solid ${"var(--color-accent)"}`, background: bg }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: textSecondary }}>
                        {r._display}
                        {DOCUMENT_TYPE_LABELS[r.ref_type] && (
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500,
                            textTransform: "uppercase" as const, letterSpacing: "0.05em",
                            padding: "2px 6px", background: cardBg, color: textSecondary }}>
                            {DOCUMENT_TYPE_LABELS[r.ref_type][lang as "en" | "tr"]}
                          </span>
                        )}
                      </div>
                      {r.external_doc_date && (
                        <div style={{ fontSize: 11, color: textSecondary, marginTop: 2 }}>{r.external_doc_date.slice(0, 10)}</div>
                      )}
                      {r.note && (
                        <div style={{ fontSize: 11, color: textSecondary, marginTop: 2, fontStyle: "italic" }}>{r.note}</div>
                      )}
                    </div>
                    <button
                      onClick={() => setPendingRefs((prev) => prev.filter((_, i) => i !== idx))}
                      style={{ background: "none", border: "none", color: textSecondary, cursor: "pointer", fontSize: 14, padding: 0 }}
                    >×</button>
                  </div>
                ))}
                <div ref={refPickerRef} style={{ position: "relative", marginBottom: 8, marginTop: pendingRefs.length > 0 ? 12 : 0 }}>
                  <input
                    value={refSearch}
                    onChange={(e) => { setRefSearch(e.target.value); setShowRefDropdown(true); }}
                    onFocus={() => setShowRefDropdown(true)}
                    placeholder={lang === "tr" ? "RFI veya yazışma ara..." : "Search RFI or Correspondence..."}
                    style={{
                      width: "100%", padding: "8px 12px",
                      border: `1px solid ${border}`,
                      background: "var(--color-bg-primary)",
                      color: textPrimary,
                      fontSize: 12, borderRadius: 0,
                      boxSizing: "border-box" as const,
                      fontFamily: "Inter, sans-serif",
                    }}
                  />
                  {showRefDropdown && filteredLinkable.length > 0 && (
                    <div style={{
                      position: "absolute", top: "100%", left: 0, right: 0,
                      background: "var(--color-bg-primary)",
                      border: `1px solid ${border}`,
                      zIndex: "var(--z-dropdown)" as unknown as number,
                      maxHeight: 220, overflowY: "auto",
                    }}>
                      {filteredLinkable.map((doc) => (
                        <button
                          key={doc.id}
                          onClick={() => addRefFromDoc(doc)}
                          style={{
                            display: "block", width: "100%", textAlign: "left",
                            padding: "8px 12px", background: "none", border: "none",
                            borderBottom: `1px solid ${border}`,
                            cursor: "pointer",
                            fontSize: 12, color: textPrimary,
                            fontFamily: "Inter, sans-serif",
                          }}
                        >
                          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: textSecondary }}>
                            {doc.ref_number}
                          </span>
                          {" "}{doc.subject}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowManualRef((v) => !v)}
                  style={{
                    fontSize: 11, background: "none",
                    border: `1px solid ${border}`,
                    color: textSecondary, cursor: "pointer",
                    padding: "4px 12px", borderRadius: 0,
                    fontFamily: "Inter, sans-serif",
                  }}
                >
                  {showManualRef
                    ? (lang === "tr" ? "Manuel girişi iptal" : "Cancel manual entry")
                    : (lang === "tr" ? "+ Sistemde olmayan referans ekle" : "+ Add reference not in system")}
                </button>
                {showManualRef && (
                  <div style={{
                    padding: 12, marginTop: 12,
                    border: `1px solid ${border}`,
                    background: "var(--color-bg-primary)",
                  }}>
                    <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const,
                                letterSpacing: "0.08em", color: textSecondary, marginBottom: 4 }}>
                      {lang === "tr" ? "TÜR *" : "TYPE *"}
                    </p>
                    <select
                      value={manualRef.type}
                      onChange={(e) => setManualRef({ ...manualRef, type: e.target.value })}
                      style={{ width: "100%", padding: "8px 10px", marginBottom: 12,
                        border: `1px solid ${border}`, background: "var(--color-bg-primary)",
                        color: manualRef.type ? textPrimary : textSecondary,
                        fontSize: 12, borderRadius: 0, boxSizing: "border-box" as const,
                        fontFamily: "Inter, sans-serif" }}
                    >
                      <option value="" disabled>
                        {lang === "tr" ? "— Seçiniz —" : "— Select —"}
                      </option>
                      {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v[lang as "en" | "tr"]}</option>
                      ))}
                    </select>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecondary, marginBottom: 4 }}>
                          {lang === "tr" ? "NUMARA *" : "NUMBER *"}
                        </p>
                        <input
                          value={manualRef.number}
                          onChange={(e) => setManualRef({ ...manualRef, number: e.target.value })}
                          style={{
                            width: "100%", padding: "8px 10px",
                            border: `1px solid ${border}`,
                            background: "var(--color-bg-primary)",
                            color: textPrimary,
                            fontSize: 12, borderRadius: 0,
                            boxSizing: "border-box" as const,
                            fontFamily: "Inter, sans-serif",
                          }}
                        />
                      </div>
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecondary, marginBottom: 4 }}>
                          {lang === "tr" ? "TARİH" : "DATE"}
                        </p>
                        <input
                          type="date"
                          value={manualRef.date}
                          onChange={(e) => setManualRef({ ...manualRef, date: e.target.value })}
                          style={{
                            width: "100%", padding: "8px 10px",
                            border: `1px solid ${border}`,
                            background: "var(--color-bg-primary)",
                            color: textPrimary,
                            fontSize: 12, borderRadius: 0,
                            boxSizing: "border-box" as const,
                            fontFamily: "Inter, sans-serif",
                          }}
                        />
                      </div>
                    </div>
                    <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecondary, marginBottom: 4 }}>
                      {lang === "tr" ? "BAŞLIK" : "TITLE"}
                    </p>
                    <input
                      value={manualRef.title}
                      onChange={(e) => setManualRef({ ...manualRef, title: e.target.value })}
                      style={{
                        width: "100%", padding: "8px 10px", marginBottom: 12,
                        border: `1px solid ${border}`,
                        background: "var(--color-bg-primary)",
                        color: textPrimary,
                        fontSize: 12, borderRadius: 0,
                        boxSizing: "border-box" as const,
                        fontFamily: "Inter, sans-serif",
                      }}
                    />
                    {manualRef.type === "other" && (
                      <>
                        <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const,
                                    letterSpacing: "0.08em", color: textSecondary, marginBottom: 4 }}>
                          {lang === "tr" ? "TÜR KÜNYESİ" : "TYPE DESCRIPTION"}
                        </p>
                        <input
                          value={manualRef.note}
                          onChange={(e) => setManualRef({ ...manualRef, note: e.target.value })}
                          placeholder={lang === "tr" ? "ör. Toplantı Tutanağı, Saha Notu"
                                                     : "e.g. Meeting Minutes, Site Note"}
                          style={{ width: "100%", padding: "8px 10px", marginBottom: 12,
                            border: `1px solid ${border}`, background: "var(--color-bg-primary)",
                            color: textPrimary, fontSize: 12, borderRadius: 0,
                            boxSizing: "border-box" as const, fontFamily: "Inter, sans-serif" }}
                        />
                      </>
                    )}
                    <button
                      onClick={addManualRef}
                      disabled={!canAddManual}
                      style={{
                        fontSize: 11, padding: "6px 14px",
                        background: canAddManual ? "var(--color-accent)" : "var(--color-border-medium)",
                        color: canAddManual ? "var(--color-bg-primary)" : textSecondary,
                        border: "none", borderRadius: 0,
                        cursor: !canAddManual ? "not-allowed" : "pointer",
                        fontWeight: 500, fontFamily: "Inter, sans-serif",
                      }}
                    >
                      {lang === "tr" ? "Referans Ekle" : "Add Reference"}
                    </button>
                  </div>
                )}
              </div>

              {/* Dosya yükleme */}
              <div>
                <label style={labelStyle}>{lang === "tr" ? "Belgeler (opsiyonel)" : "Documents (optional)"}</label>
                {/* Document metadata — optional, passed to extraction pipeline */}
                <div style={{ marginBottom: 8 }}>
                  <label style={{
                    ...labelStyle,
                    marginBottom: 4,
                  }}>
                    {lang === "tr" ? "Anahtar Kelimeler (opsiyonel)" : "Keywords (optional)"}
                  </label>
                  <input
                    type="text"
                    value={docKeywords}
                    onChange={(e) => setDocKeywords(e.target.value)}
                    placeholder={lang === "tr"
                      ? "ör. Grid Zone 4A, RFI-006, Madde 13.3"
                      : "e.g. Grid Zone 4A, RFI-006, Sub-Clause 13.3"}
                    style={inputStyle}
                  />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{
                    ...labelStyle,
                    marginBottom: 4,
                  }}>
                    {lang === "tr" ? "Lokasyon (opsiyonel)" : "Location (optional)"}
                  </label>
                  <input
                    type="text"
                    value={docLocation}
                    onChange={(e) => setDocLocation(e.target.value)}
                    placeholder={lang === "tr"
                      ? "ör. Grid Zone 4A, 3. Kat Podium"
                      : "e.g. Grid Zone 4A, Level 3 Podium"}
                    style={inputStyle}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <label style={{ padding: "8px 16px", backgroundColor: cardBg, border: `1px solid ${border}`, color: textSecondary, fontSize: 12, fontFamily: "Inter, sans-serif", cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap" as const }}>
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
                  <span style={{ fontSize: 11, color: textSecondary, fontStyle: "italic" }}>PDF, Word, Excel, DWG, DXF...</span>
                </div>
                {selectedFiles.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {selectedFiles.map((file, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", backgroundColor: cardBg, borderLeft: `2px solid ${"var(--color-accent)"}` }}>
                        <span style={{ fontSize: 12, color: textPrimary, flex: 1 }}>{file.name}</span>
                        <span style={{ fontSize: 11, color: textSecondary }}>{(file.size / 1024).toFixed(0)} KB</span>
                        <button onClick={() => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: textSecondary, cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                {uploadErrors.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {uploadErrors.map((err, idx) => (
                      <p key={idx} style={{ fontSize: 11, color: alertRed, margin: "2px 0" }}>{err}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* Error */}
              {error && <p style={{ fontSize: 12, color: alertRed }}>{error}</p>}

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  style={{ backgroundColor: "var(--color-accent)", color: "var(--color-bg-primary)", border: "none", padding: "10px 24px", fontSize: 13, fontWeight: 500, letterSpacing: "0.5px", cursor: loading ? "not-allowed" : "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", opacity: loading ? 0.7 : 1 }}
                >
                  {loading
                    ? (lang === "tr" ? "Kaydediliyor..." : "Saving...")
                    : entryMode === "authored"
                    ? (lang === "tr" ? "Taslak Oluştur" : "Create Draft")
                    : (lang === "tr" ? "Kaydet" : "Save")}
                </button>
                <button
                  onClick={() => navigate(`/projects/${projectId}/workspace?module=rfis`)}
                  style={{ backgroundColor: "transparent", color: textSecondary, border: `1px solid ${border}`, padding: "10px 24px", fontSize: 13, fontWeight: 500, cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif" }}
                >
                  {lang === "tr" ? "İptal" : "Cancel"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
