import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { api, fetchLinkableDocuments, type LinkableDoc } from "../services/api";
import { getAuth } from "../store/auth";
import { useLanguage } from "../context/LanguageContext";
import { DOCUMENT_TYPE_LABELS } from "../constants/documentTypes";

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
  const [docKeywords, setDocKeywords] = useState("");
  const [docLocation, setDocLocation] = useState("");
  // Olusturma-ani referanslar (MIMARI-YON-1). Bellekte birikir,
  // submit'te body.references'a katilir. Backend: create_correspondence (E3).
  // _display yalniz UI listesi; body'ye GITMEZ (soyulur).
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
  const [manualRef, setManualRef] = useState({ type: "", number: "", title: "", date: "", note: "" });
  const refPickerRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    corr_number: "",
    type: "letter",
    subject: "",
    correspondence_date: new Date().toISOString().slice(0, 10),
    external_ref: "",
    from_party_id: "",
    to_party_id: "",
  });

  const bg            = "var(--color-bg-primary)";
  const cardBg        = "var(--color-bg-secondary)";
  const border        = "var(--color-border-light)";
  const textPrimary   = "var(--color-text-primary)";
  const textSecondary = "var(--color-text-secondary)";
  const alertRed      = "var(--color-alert-red)";
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

  // 'other'/manuel turde kullanicinin girdigi kunye. external_doc_* alanlarina yazilir.
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
    setManualRef({ type: "", number: "", title: "", date: "", note: "" });
    setShowManualRef(false);
  };
  const canAddManual = manualRef.number.trim() !== "" && manualRef.type !== "";

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

      if (docKeywords.trim()) {
        body.keywords = docKeywords
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean);
      }

      if (pendingRefs.length > 0) {
        body.references = pendingRefs.map(({ _display, ...ref }) => ref);
      }

      const corr = await api.post<{ id: string }>(`/projects/${projectId}/correspondences`, body);

      if (selectedFiles.length > 0 && corr.id) {
        const uploadResults = await Promise.all(
          selectedFiles.map(async (file) => {
            const formData = new FormData();
            formData.append("file", file);
            try {
              const uploadRes = await fetch(
                `/api/v1/projects/${projectId}/documents/upload?entity_type=correspondence&entity_id=${corr.id}${docKeywords.trim() ? `&keywords=${encodeURIComponent(docKeywords.trim())}` : ""}${docLocation.trim() ? `&location=${encodeURIComponent(docLocation.trim())}` : ""}`,
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
      <nav style={{ backgroundColor: bg, borderBottom: `0.5px solid ${border}`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecondary }}>
          <div style={{ width: 2, height: 20, background: "linear-gradient(to bottom, transparent, var(--color-accent) 20%, var(--color-accent) 80%, transparent)" }} />
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
          <button onClick={toggleLang} style={{ background: "none", border: "1px solid var(--color-border-light)", cursor: "pointer", fontSize: 11, color: textSecondary, padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 500, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>

        {/* Direction selector */}
        {!direction && (
          <div>
            <p style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, color: textPrimary, fontWeight: 500, marginBottom: 8 }}>
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
                <p style={{ fontSize: 13, fontWeight: 500, color: textPrimary, marginBottom: 4, fontFamily: "Inter, sans-serif" }}>Outgoing →</p>
                <p style={{ fontSize: 11, color: textSecondary, fontFamily: "Inter, sans-serif" }}>{lang === "tr" ? "Bizden karşı tarafa gönderilen yazışma" : "Outgoing correspondence to the other party"}</p>
              </button>
              <button
                onClick={() => setDirection("incoming")}
                style={{ padding: "20px 24px", backgroundColor: cardBg, border: `1px solid ${border}`, cursor: "pointer", textAlign: "left", borderRadius: 0 }}
              >
                <p style={{ fontSize: 13, fontWeight: 500, color: textPrimary, marginBottom: 4, fontFamily: "Inter, sans-serif" }}>← Incoming</p>
                <p style={{ fontSize: 11, color: textSecondary, fontFamily: "Inter, sans-serif" }}>{lang === "tr" ? "Karşı taraftan bize gelen yazışma" : "Incoming correspondence from the other party"}</p>
              </button>
            </div>
          </div>
        )}

        {/* Form */}
        {direction && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <p style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 22, color: textPrimary, fontWeight: 500, marginBottom: 8 }}>
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
                <label style={labelStyle}>{lang === "tr" ? "Belgeler (birden fazla seçilebilir)" : "Documents (multiple allowed)"}</label>
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
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", backgroundColor: cardBg, borderLeft: `2px solid ${"var(--color-accent)"}` }}>
                        <span style={{ fontSize: 12, color: textPrimary, flex: 1 }}>{file.name}</span>
                        <span style={{ fontSize: 11, color: textSecondary }}>{(file.size / 1024).toFixed(0)} KB</span>
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
                      <p key={idx} style={{ fontSize: 11, color: alertRed, margin: "2px 0" }}>{err}</p>
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
                <p style={{ fontSize: 12, color: alertRed }}>{error}</p>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  style={{ backgroundColor: "var(--color-accent)", color: "var(--color-bg-primary)", border: "none", padding: "10px 24px", fontSize: 13, fontWeight: 500, letterSpacing: "0.5px", cursor: loading ? "not-allowed" : "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif", opacity: loading ? 0.7 : 1 }}
                >
                  {loading ? (lang === "tr" ? "Kaydediliyor..." : "Saving...") : (lang === "tr" ? "Kaydet" : "Save")}
                </button>
                <button
                  onClick={() => navigate(`/projects/${projectId}/workspace`)}
                  style={{ backgroundColor: "transparent", color: textSecondary, border: `1px solid ${border}`, padding: "10px 24px", fontSize: 13, fontWeight: 500, cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif" }}
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
