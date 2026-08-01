import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import {
  createAuthoringTemplate,
  listAuthoringTemplates,
  updateAuthoringTemplate,
  uploadTemplateChrome,
  type DocumentTemplate,
} from "../services/authoringApi";
import { ApiError } from "../services/api";

interface Props {
  projectId: string;
}

export default function AuthoringTemplatesPanel({ projectId }: Props) {
  const { lang } = useLanguage();
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [docType, setDocType] = useState<"letter" | "rfi">("letter");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await listAuthoringTemplates(projectId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createAuthoringTemplate(projectId, {
        doc_type: docType,
        name: name.trim(),
        header_text: headerText || undefined,
        footer_text: footerText || undefined,
        is_active: true,
      });
      setName("");
      setHeaderText("");
      setFooterText("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleChrome(
    templateId: string,
    slot: "header" | "footer" | "watermark",
    file: File | null
  ) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadTemplateChrome(projectId, templateId, slot, file);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(tpl: DocumentTemplate) {
    setBusy(true);
    try {
      await updateAuthoringTemplate(projectId, tpl.id, { is_active: true });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const label = {
    fontSize: 11,
    color: "var(--color-text-secondary)",
    fontFamily: "var(--font-ui)",
    display: "block",
    marginBottom: 4,
  } as const;
  const input = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid var(--color-border-medium)",
    background: "var(--color-bg-primary)",
    color: "var(--color-text-primary)",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    boxSizing: "border-box" as const,
  };

  return (
    <div style={{ marginTop: 32 }}>
      <h3
        style={{
          fontFamily: "var(--font-brand)",
          fontSize: 16,
          color: "var(--color-text-primary)",
          fontWeight: 500,
          marginBottom: 8,
        }}
      >
        {lang === "tr" ? "Belge Şablonları (Letterhead)" : "Document Templates (Letterhead)"}
      </h3>
      <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 16, fontFamily: "var(--font-ui)" }}>
        {lang === "tr"
          ? "Yazışma ve RFI yazma yüzeyinde kullanılacak antetli şablonlar."
          : "Letterhead templates used by the letter and RFI authoring surfaces."}
      </p>

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-alert-red)", marginBottom: 12 }}>{error}</p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 20,
          padding: 16,
          background: "var(--color-bg-secondary)",
        }}
      >
        <div>
          <label style={label}>{lang === "tr" ? "Ad" : "Name"}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={input} />
        </div>
        <div>
          <label style={label}>{lang === "tr" ? "Tür" : "Type"}</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as "letter" | "rfi")}
            style={input}
          >
            <option value="letter">Letter</option>
            <option value="rfi">RFI</option>
          </select>
        </div>
        <div>
          <label style={label}>Header text</label>
          <input value={headerText} onChange={(e) => setHeaderText(e.target.value)} style={input} />
        </div>
        <div>
          <label style={label}>Footer text</label>
          <input value={footerText} onChange={(e) => setFooterText(e.target.value)} style={input} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void handleCreate()}
            style={{
              background: "var(--color-accent)",
              color: "var(--color-bg-primary)",
              border: "none",
              padding: "8px 16px",
              fontSize: 12,
              cursor: busy ? "wait" : "pointer",
              fontFamily: "var(--font-ui)",
            }}
          >
            {lang === "tr" ? "Şablon Oluştur" : "Create Template"}
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>…</p>
      ) : templates.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", fontStyle: "italic" }}>
          {lang === "tr" ? "Henüz şablon yok." : "No templates yet."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              style={{
                padding: 12,
                background: "var(--color-bg-secondary)",
                borderLeft: tpl.is_active
                  ? "3px solid var(--color-accent)"
                  : "3px solid transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, color: "var(--color-text-primary)", fontWeight: 500 }}>
                    {tpl.name}{" "}
                    <span style={{ fontFamily: "var(--font-meta)", fontSize: 11, color: "var(--color-text-secondary)" }}>
                      ({tpl.doc_type})
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 4 }}>
                    {tpl.is_active ? (lang === "tr" ? "Aktif" : "Active") : (lang === "tr" ? "Pasif" : "Inactive")}
                    {tpl.header_image_path ? " · header img" : ""}
                    {tpl.footer_image_path ? " · footer img" : ""}
                    {tpl.watermark_image_path ? " · watermark" : ""}
                  </div>
                </div>
                {!tpl.is_active && (
                  <button
                    type="button"
                    onClick={() => void setActive(tpl)}
                    style={{
                      fontSize: 11,
                      border: "1px solid var(--color-border-medium)",
                      background: "var(--color-bg-primary)",
                      color: "var(--color-text-primary)",
                      padding: "4px 10px",
                      cursor: "pointer",
                    }}
                  >
                    {lang === "tr" ? "Aktifleştir" : "Activate"}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
                {(["header", "footer", "watermark"] as const).map((slot) => (
                  <label
                    key={slot}
                    style={{ fontSize: 11, color: "var(--color-text-secondary)", cursor: "pointer" }}
                  >
                    {slot} (PNG/JPEG)
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      style={{ display: "block", marginTop: 4, fontSize: 11 }}
                      onChange={(e) =>
                        void handleChrome(tpl.id, slot, e.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
