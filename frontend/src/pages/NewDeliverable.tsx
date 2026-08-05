import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { getAuth } from "../store/auth";
import { useLanguage } from "../context/LanguageContext";

const CATEGORIES = [
  { value: "hse", label: "HSE" },
  { value: "insurance", label: "Insurance" },
  { value: "bond_security", label: "Bond / Security" },
  { value: "statutory", label: "Statutory" },
  { value: "report", label: "Report" },
  { value: "certification", label: "Certification" },
  { value: "permit_approval", label: "Permit / Approval" },
  { value: "administrative", label: "Administrative" },
  { value: "other", label: "Other" },
];

const SOURCES = [
  { value: "contract_clause", label: { tr: "Kontrat maddesi", en: "Contract clause" } },
  { value: "handover", label: { tr: "Handover", en: "Handover" } },
  { value: "employer_imposition", label: { tr: "İşveren gereklilikleri", en: "Employer requirements" } },
  { value: "statutory", label: { tr: "Mevzuat", en: "Statutory" } },
];

const FILE_ACCEPT =
  ".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.jpg,.jpeg,.png,.dwg,.dxf,.txt,.csv";

/** Cadence → which date fields apply (locked model §3.5). */
function dateFieldsForCadence(cadence: string): {
  due: boolean;
  expiry: boolean;
} {
  if (cadence === "standing_renewal") return { due: false, expiry: true };
  // one_time | recurring
  return { due: true, expiry: false };
}

const KINDS = [
  { value: "artifact", label: { tr: "Belge / çıktı", en: "Artifact" } },
  { value: "compliance", label: { tr: "Uyum yükümlülüğü", en: "Compliance" } },
];

const CADENCES = [
  { value: "one_time", label: { tr: "Tek sefer", en: "One-time" } },
  { value: "recurring", label: { tr: "Tekrarlayan", en: "Recurring" } },
  { value: "standing_renewal", label: { tr: "Yenilemeli", en: "Standing renewal" } },
];

type ContractRoot = { id: string; title: string };

export default function NewDeliverable() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { lang, toggle: toggleLang, t } = useLanguage();
  const auth = getAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [contract, setContract] = useState<ContractRoot | null>(null);
  const [contractLoading, setContractLoading] = useState(true);

  const [form, setForm] = useState({
    title: "",
    category: "administrative",
    source: "contract_clause",
    source_ref: "",
    kind: "artifact",
    cadence: "one_time",
    due_date: "",
    expiry_date: "",
    responsible: "",
    notes: "",
    pending_detail: false,
    direction_override: false,
    direction: "we_owe" as "we_owe" | "they_owe",
  });

  const datesActive = dateFieldsForCadence(form.cadence);

  const setCadence = (cadence: string) => {
    const next = dateFieldsForCadence(cadence);
    setForm((prev) => ({
      ...prev,
      cadence,
      due_date: next.due ? prev.due_date : "",
      expiry_date: next.expiry ? prev.expiry_date : "",
    }));
  };

  const bg = "var(--color-bg-primary)";
  const cardBg = "var(--color-bg-secondary)";
  const border = "var(--color-border-light)";
  const textPrimary = "var(--color-text-primary)";
  const textSecond = "var(--color-text-secondary)";
  const alertRed = "var(--color-alert-red)";

  const inputStyle: React.CSSProperties = {
    width: "100%",
    backgroundColor: cardBg,
    border: `1px solid ${border}`,
    color: textPrimary,
    fontSize: 13,
    fontFamily: "var(--font-ui)",
    padding: "10px 12px",
    borderRadius: 0,
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: textSecond,
    display: "block",
    marginBottom: 6,
  };

  useEffect(() => {
    if (!projectId) return;
    setContractLoading(true);
    api
      .get<ContractRoot | null>(`/projects/${projectId}/contract`)
      .then((c) => setContract(c))
      .catch(() => setContract(null))
      .finally(() => setContractLoading(false));
  }, [projectId]);

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      setError(lang === "tr" ? "Başlık zorunlu." : "Title is required.");
      return;
    }
    if (!contract?.id) {
      setError(
        lang === "tr"
          ? "Önce bir kontrat tanımlayın (Contracts & Amendments)."
          : "Define a contract first (Contracts & Amendments)."
      );
      return;
    }

    setLoading(true);
    setError(null);
    setUploadErrors([]);
    try {
      const active = dateFieldsForCadence(form.cadence);
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        contract_id: contract.id,
        category: form.category,
        source: form.source,
        kind: form.kind,
        cadence: form.cadence,
        pending_detail: form.pending_detail,
        entry_source: "manual",
        direction_override: form.direction_override,
      };
      if (form.direction_override) body.direction = form.direction;
      if (form.source_ref.trim()) body.source_ref = form.source_ref.trim();
      if (active.due && form.due_date) body.due_date = form.due_date;
      if (active.expiry && form.expiry_date) body.expiry_date = form.expiry_date;
      if (form.responsible.trim()) body.responsible = form.responsible.trim();
      if (form.notes.trim()) body.notes = form.notes.trim();

      const created = await api.post<{ id: string }>(
        `/projects/${projectId}/deliverables`,
        body
      );

      if (selectedFiles.length > 0 && created.id) {
        const results = await Promise.all(
          selectedFiles.map(async (file) => {
            const formData = new FormData();
            formData.append("file", file);
            try {
              const res = await fetch(
                `/api/v1/projects/${projectId}/documents/upload?entity_type=deliverable&entity_id=${created.id}`,
                { method: "POST", credentials: "include", body: formData }
              );
              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                return `${file.name}: ${errData.detail ?? (lang === "tr" ? "Yükleme başarısız" : "Upload failed")}`;
              }
              return null;
            } catch {
              return `${file.name}: ${lang === "tr" ? "Bağlantı hatası" : "Connection error"}`;
            }
          })
        );
        const errors = results.filter((e): e is string => e !== null);
        if (errors.length > 0) setUploadErrors(errors);
      }

      navigate(`/projects/${projectId}/workspace/deliverables/${created.id}`);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : lang === "tr"
            ? "Kayıt başarısız."
            : "Save failed."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>
      <nav
        style={{
          backgroundColor: bg,
          borderBottom: `0.5px solid ${border}`,
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecond }}>
          <div className="gold-line gold-line-compact" />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>
            {t("nav.projects")}
          </span>
          <span>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>
            {t("nav.overview")}
          </span>
          <span>/</span>
          <span
            style={{ cursor: "pointer" }}
            onClick={() => navigate(`/projects/${projectId}/workspace?module=deliverables`)}
          >
            {t("module.deliverables")}
          </span>
          <span>/</span>
          <span style={{ color: textPrimary, fontWeight: 500 }}>
            {lang === "tr" ? "Yeni yükümlülük" : "New deliverable"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: textSecond }}>{auth?.full_name}</span>
          <button
            onClick={toggleLang}
            style={{
              background: "none",
              border: `1px solid ${border}`,
              cursor: "pointer",
              fontSize: 11,
              color: textSecond,
              padding: "2px 8px",
              fontFamily: "var(--font-meta)",
              fontWeight: 500,
              letterSpacing: "0.5px",
            }}
          >
            {lang === "en" ? "TR" : "EN"}
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
        <p
          style={{
            fontFamily: "var(--font-brand)",
            fontSize: "var(--type-h1)",
            color: textPrimary,
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          {lang === "tr" ? "Yeni yükümlülük" : "New deliverable"}
        </p>
        <p style={{ fontSize: 13, color: textSecond, marginBottom: 28 }}>
          {lang === "tr"
            ? "Sözleşme / mevzuat yükümlülüğünü C&C register'ına ekleyin."
            : "Add a contractual / statutory obligation to the C&C register."}
        </p>

        {contractLoading ? (
          <p style={{ fontSize: 12, color: textSecond }}>{t("state.loading")}</p>
        ) : !contract ? (
          <p style={{ fontSize: 13, color: alertRed, marginBottom: 20 }}>
            {lang === "tr"
              ? "Bu projede kontrat yok. Önce Contracts & Amendments altında kontrat oluşturun."
              : "No contract on this project. Create one under Contracts & Amendments first."}
          </p>
        ) : (
          <p style={{ fontSize: 12, color: textSecond, marginBottom: 20, fontFamily: "var(--font-meta)" }}>
            {lang === "tr" ? "Kontrat: " : "Contract: "}
            {contract.title}
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>{lang === "tr" ? "Başlık *" : "Title *"}</label>
            <input
              style={inputStyle}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={
                lang === "tr" ? "ör. Performance Bond" : "e.g. Performance Bond"
              }
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>{lang === "tr" ? "Kategori *" : "Category *"}</label>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{lang === "tr" ? "Kaynak *" : "Source *"}</label>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              >
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label[lang]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>
              {lang === "tr" ? "Kaynak referansı" : "Source reference"}
            </label>
            <input
              style={inputStyle}
              value={form.source_ref}
              onChange={(e) => setForm({ ...form, source_ref: e.target.value })}
              placeholder={lang === "tr" ? "Cl.4.2 / talimat tarihi…" : "Cl.4.2 / instruction date…"}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>{lang === "tr" ? "Tip *" : "Kind *"}</label>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label[lang]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{lang === "tr" ? "Cadence *" : "Cadence *"}</label>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={form.cadence}
                onChange={(e) => setCadence(e.target.value)}
              >
                {CADENCES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label[lang]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ ...labelStyle, opacity: datesActive.due ? 1 : 0.45 }}>
                {lang === "tr" ? "Vade" : "Due date"}
                {!datesActive.due && (
                  <span style={{ textTransform: "none", letterSpacing: 0, marginLeft: 6, fontWeight: 400 }}>
                    ({lang === "tr" ? "bu cadence için yok" : "n/a for cadence"})
                  </span>
                )}
              </label>
              <input
                type="date"
                disabled={!datesActive.due}
                style={{
                  ...inputStyle,
                  opacity: datesActive.due ? 1 : 0.45,
                  cursor: datesActive.due ? "text" : "not-allowed",
                }}
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
            <div>
              <label style={{ ...labelStyle, opacity: datesActive.expiry ? 1 : 0.45 }}>
                {lang === "tr" ? "Sona erme" : "Expiry date"}
                {!datesActive.expiry && (
                  <span style={{ textTransform: "none", letterSpacing: 0, marginLeft: 6, fontWeight: 400 }}>
                    ({lang === "tr" ? "bu cadence için yok" : "n/a for cadence"})
                  </span>
                )}
              </label>
              <input
                type="date"
                disabled={!datesActive.expiry}
                style={{
                  ...inputStyle,
                  opacity: datesActive.expiry ? 1 : 0.45,
                  cursor: datesActive.expiry ? "text" : "not-allowed",
                }}
                value={form.expiry_date}
                onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
              />
            </div>
          </div>
          <p style={{ fontSize: 11, color: textSecond, fontStyle: "italic", margin: "-4px 0 0" }}>
            {form.cadence === "standing_renewal"
              ? lang === "tr"
                ? "Yenilemeli yükümlülüklerde sona erme tarihi izlenir (sigorta, CR…)."
                : "Standing renewals track expiry (insurance, CR…)."
              : lang === "tr"
                ? "Tek sefer / tekrarlayan kalemlerde vade tarihi izlenir."
                : "One-time / recurring items track a due date."}
          </p>

          <div>
            <label style={labelStyle}>{lang === "tr" ? "İç sorumlu" : "Responsible"}</label>
            <input
              style={inputStyle}
              value={form.responsible}
              onChange={(e) => setForm({ ...form, responsible: e.target.value })}
            />
          </div>

          <div>
            <label style={labelStyle}>{lang === "tr" ? "Notlar" : "Notes"}</label>
            <textarea
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div
            style={{
              padding: 16,
              backgroundColor: cardBg,
              border: `0.5px solid ${border}`,
            }}
          >
            <p style={{ ...labelStyle, marginBottom: 8 }}>
              {lang === "tr" ? "Belgeler / kanıt" : "Documents / evidence"}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <label
                style={{
                  padding: "8px 16px",
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  color: textSecond,
                  fontSize: 12,
                  fontFamily: "var(--font-ui)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {lang === "tr" ? "Dosya Seç" : "Select File"}
                <input
                  type="file"
                  multiple
                  accept={FILE_ACCEPT}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setSelectedFiles((prev) => {
                      const names = new Set(prev.map((f) => f.name));
                      return [...prev, ...files.filter((f) => !names.has(f.name))];
                    });
                    e.target.value = "";
                  }}
                />
              </label>
              <span style={{ fontSize: 11, color: textSecond, fontStyle: "italic" }}>
                PDF, Word, Excel, DWG…
              </span>
            </div>
            {selectedFiles.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {selectedFiles.map((file, idx) => (
                  <div
                    key={`${file.name}-${idx}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 8px",
                      backgroundColor: bg,
                      borderLeft: "2px solid var(--color-accent)",
                    }}
                  >
                    <span style={{ fontSize: 12, color: textPrimary, flex: 1 }}>
                      {file.name}
                    </span>
                    <span style={{ fontSize: 11, color: textSecond }}>
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))
                      }
                      style={{
                        background: "none",
                        border: "none",
                        color: textSecond,
                        cursor: "pointer",
                        fontSize: 14,
                        padding: 0,
                      }}
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
                  <p key={idx} style={{ fontSize: 11, color: alertRed, margin: "2px 0" }}>
                    {err}
                  </p>
                ))}
              </div>
            )}
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: textPrimary,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={form.pending_detail}
              onChange={(e) => setForm({ ...form, pending_detail: e.target.checked })}
            />
            {lang === "tr"
              ? "Detay bekleniyor (placeholder yükümlülük)"
              : "Pending detail (placeholder obligation)"}
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: textPrimary,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={form.direction_override}
              onChange={(e) => setForm({ ...form, direction_override: e.target.checked })}
            />
            {lang === "tr"
              ? "Yönü elle ayarla (varsayılan kontrattan)"
              : "Override direction (default from contract)"}
          </label>
          {form.direction_override && (
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={form.direction}
              onChange={(e) =>
                setForm({
                  ...form,
                  direction: e.target.value as "we_owe" | "they_owe",
                })
              }
            >
              <option value="we_owe">
                {lang === "tr" ? "Biz borçluyuz" : "We owe"}
              </option>
              <option value="they_owe">
                {lang === "tr" ? "Karşı taraf borçlu" : "They owe"}
              </option>
            </select>
          )}

          {error && (
            <p style={{ fontSize: 13, color: alertRed, margin: 0 }}>{error}</p>
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <button
              onClick={handleSubmit}
              disabled={loading || !contract}
              style={{
                backgroundColor: "var(--color-accent)",
                color: "#F5F2ED",
                border: "none",
                padding: "10px 20px",
                fontSize: 13,
                fontFamily: "var(--font-ui)",
                cursor: loading || !contract ? "not-allowed" : "pointer",
                opacity: loading || !contract ? 0.6 : 1,
              }}
            >
              {loading
                ? lang === "tr"
                  ? "Kaydediliyor…"
                  : "Saving…"
                : lang === "tr"
                  ? "Oluştur"
                  : "Create"}
            </button>
            <button
              onClick={() =>
                navigate(`/projects/${projectId}/workspace?module=deliverables`)
              }
              style={{
                background: "none",
                border: `1px solid ${border}`,
                color: textSecond,
                padding: "10px 20px",
                fontSize: 13,
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
              }}
            >
              {lang === "tr" ? "İptal" : "Cancel"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
