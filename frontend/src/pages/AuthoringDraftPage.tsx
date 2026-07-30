import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import RichTextEditor from "../components/editor/RichTextEditor";
import { useLanguage } from "../context/LanguageContext";
import { ApiError, fetchLinkableDocuments, type LinkableDoc } from "../services/api";
import {
  aiDraft,
  approveAuthoringDraft,
  createAuthoringDraft,
  fetchAuthoringDocxUrl,
  fetchAuthoringDraft,
  generateAuthoringDocx,
  patchAuthoringDraft,
  type DocumentDraft,
} from "../services/authoringApi";

type RefItem = {
  ref_type: string;
  rfi_id?: string;
  ref_corr_id?: string;
  external_ref?: string;
  _display?: string;
};

export default function AuthoringDraftPage() {
  const { projectId, draftId: routeDraftId } = useParams<{
    projectId: string;
    draftId?: string;
  }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { lang } = useLanguage();

  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [attentionTo, setAttentionTo] = useState("");
  const [projectName, setProjectName] = useState("");
  const [references, setReferences] = useState<RefItem[]>([]);
  const [version, setVersion] = useState(1);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "conflict">("idle");
  const [error, setError] = useState<string | null>(null);
  const [docNumber, setDocNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [refSearch, setRefSearch] = useState("");
  const [linkable, setLinkable] = useState<LinkableDoc[]>([]);
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiHints, setAiHints] = useState<string | null>(null);

  const versionRef = useRef(version);
  versionRef.current = version;
  const draftIdRef = useRef<string | null>(routeDraftId ?? null);
  const skipNextAutosave = useRef(true);

  const tpl = draft?.document_templates;

  // Bootstrap: create or load
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        if (routeDraftId) {
          const d = await fetchAuthoringDraft(projectId, routeDraftId);
          if (cancelled) return;
          applyDraft(d);
          draftIdRef.current = d.id;
        } else {
          const docType = (search.get("doc_type") === "rfi" ? "rfi" : "letter") as
            | "letter"
            | "rfi";
          const d = await createAuthoringDraft(projectId, { doc_type: docType });
          if (cancelled) return;
          applyDraft(d);
          draftIdRef.current = d.id;
          navigate(`/projects/${projectId}/workspace/authoring/${d.id}`, { replace: true });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : "Failed to open draft");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, routeDraftId]);

  function applyDraft(d: DocumentDraft) {
    skipNextAutosave.current = true;
    setDraft(d);
    setSubject(d.subject || "");
    setBodyHtml(d.body_html || "");
    setAttentionTo(String(d.field_values?.attention_to || ""));
    setProjectName(String(d.field_values?.project || ""));
    setReferences((d.field_values?.references as RefItem[]) || []);
    setVersion(d.version);
  }

  // Debounced autosave
  useEffect(() => {
    if (!projectId || !draftIdRef.current || !draft) return;
    if (draft.status !== "drafting") return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const updated = await patchAuthoringDraft(projectId, draftIdRef.current!, {
          version: versionRef.current,
          subject,
          body_html: bodyHtml,
          field_values: {
            project: projectName,
            attention_to: attentionTo,
            references,
          },
        });
        setVersion(updated.version);
        setDraft((prev) => (prev ? { ...prev, ...updated } : updated));
        setSaveState("saved");
        setError(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setSaveState("conflict");
          setError(
            lang === "tr"
              ? "Çakışma: başka biri bu taslağı güncelledi. Sayfayı yenileyin."
              : "Conflict: another editor updated this draft. Reload the page."
          );
        } else {
          setSaveState("idle");
          setError(e instanceof ApiError ? e.message : "Autosave failed");
        }
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [subject, bodyHtml, attentionTo, projectName, references, projectId, draft, lang]);

  useEffect(() => {
    if (!projectId) return;
    fetchLinkableDocuments(projectId)
      .then(setLinkable)
      .catch(() => setLinkable([]));
  }, [projectId]);

  const filtered = linkable.filter((d) => {
    const q = refSearch.toLowerCase();
    if (!q) return false;
    return (
      d.ref_number.toLowerCase().includes(q) ||
      d.subject.toLowerCase().includes(q)
    );
  }).slice(0, 8);

  const addRef = useCallback((doc: LinkableDoc) => {
    const item: RefItem = {
      ref_type: doc.type === "rfi" ? "rfi" : "correspondence",
      _display: `${doc.ref_number} — ${doc.subject}`,
    };
    if (doc.type === "rfi") item.rfi_id = doc.id;
    else item.ref_corr_id = doc.id;
    setReferences((prev) => [...prev, item]);
    setRefSearch("");
  }, []);

  async function handleGenerate() {
    if (!projectId || !draftIdRef.current) return;
    setBusy(true);
    try {
      const res = await generateAuthoringDocx(projectId, draftIdRef.current);
      setDraft((prev) => (prev ? { ...prev, ...res.draft } : res.draft));
      if (res.draft.version) setVersion(res.draft.version);
      const url = await fetchAuthoringDocxUrl(projectId, draftIdRef.current);
      window.open(url.signed_url, "_blank");
      if (!res.pdf_preview_available) {
        setError(
          lang === "tr"
            ? "PDF önizleme yok — DOCX indirildi."
            : "PDF preview unavailable — DOCX downloaded."
        );
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleAiDraft() {
    if (!projectId || !draftIdRef.current) return;
    setBusy(true);
    setAiHints(null);
    try {
      const language = lang === "tr" || lang === "ar" ? lang : "en";
      const res = await aiDraft(projectId, draftIdRef.current, {
        user_instructions: aiInstructions.trim() || undefined,
        language,
        version: versionRef.current,
      });
      skipNextAutosave.current = true;
      setBodyHtml(res.body_html);
      setVersion(res.version);
      setDraft((prev) =>
        prev ? { ...prev, body_html: res.body_html, version: res.version } : prev
      );
      setError(null);
      const hints: string[] = [];
      if (res.review_required) {
        hints.push(lang === "tr" ? "İnceleme gerekli" : "Review required");
      }
      if (res.objectivity_flag) {
        hints.push(lang === "tr" ? "Nesnellik uyarısı" : "Objectivity flag");
      }
      if (res.warnings?.length) {
        hints.push(...res.warnings);
      }
      setAiHints(hints.length ? hints.join(" · ") : null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setError(typeof e.message === "string" ? e.message : String(e.message));
      } else if (e instanceof ApiError && e.status === 409) {
        setSaveState("conflict");
        setError(
          lang === "tr"
            ? "Taslak değişti, yenile"
            : "Draft changed — please reload"
        );
      } else {
        setError(e instanceof ApiError ? e.message : "AI draft failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!projectId || !draftIdRef.current || !docNumber.trim()) return;
    setBusy(true);
    try {
      const res = await approveAuthoringDraft(projectId, draftIdRef.current, {
        version: versionRef.current,
        document_number: docNumber.trim(),
        direction: "outgoing",
        corr_type: "letter",
      });
      setDraft(res.draft);
      const path =
        res.entity_type === "rfi"
          ? `/projects/${projectId}/workspace/rfis/${res.materialized.id}`
          : `/projects/${projectId}/workspace/correspondence/${res.materialized.id}`;
      navigate(path);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSaveState("conflict");
      }
      setError(e instanceof ApiError ? e.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  if (!draft && !error) {
    return (
      <div style={{ padding: 24, color: "var(--color-text-secondary)", fontSize: 12 }}>
        {lang === "tr" ? "Taslak açılıyor…" : "Opening draft…"}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 16px 64px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1
          style={{
            fontFamily: "Playfair Display, Georgia, serif",
            fontSize: 20,
            color: "var(--color-text-primary)",
            fontWeight: 500,
            margin: 0,
          }}
        >
          {draft?.doc_type === "rfi"
            ? lang === "tr" ? "RFI Yaz" : "Write RFI"
            : lang === "tr" ? "Yazışma Yaz" : "Write Letter"}
        </h1>
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
          v{version} ·{" "}
          {saveState === "saving"
            ? "…"
            : saveState === "saved"
              ? lang === "tr" ? "kaydedildi" : "saved"
              : saveState === "conflict"
                ? "409"
                : ""}
        </span>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-alert-red)", marginBottom: 12 }}>{error}</p>
      )}

      {/* Letterhead frame */}
      <div
        style={{
          position: "relative",
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-medium)",
          padding: "28px 32px",
          overflow: "hidden",
        }}
      >
        {/* Watermark lives in template.watermark_image_path; DOCX embed deferred (TB).
            CSS preview needs a signed URL — not wired in Faz A/B. */}
        <div style={{ position: "relative", zIndex: 1 }}>
          <div
            style={{
              textAlign: "center",
              marginBottom: 20,
              paddingBottom: 12,
              borderBottom: "1px solid var(--color-border-light)",
              color: "var(--color-text-secondary)",
              fontSize: 12,
              fontFamily: "Inter, sans-serif",
            }}
          >
            {tpl?.header_text || (lang === "tr" ? "(üst bilgi)" : "(header)")}
          </div>

          <label style={fieldLabel}>{lang === "tr" ? "Konu" : "Subject"}</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={draft?.status !== "drafting"}
            style={fieldInput}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={fieldLabel}>Attention to</label>
              <input
                value={attentionTo}
                onChange={(e) => setAttentionTo(e.target.value)}
                disabled={draft?.status !== "drafting"}
                style={fieldInput}
              />
            </div>
            <div>
              <label style={fieldLabel}>Project</label>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={draft?.status !== "drafting"}
                style={fieldInput}
              />
            </div>
          </div>

          <label style={fieldLabel}>{lang === "tr" ? "Referanslar" : "References"}</label>
          {references.map((r, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                padding: "6px 8px",
                marginBottom: 4,
                background: "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
              }}
            >
              <span>{r._display || r.external_ref || r.rfi_id || r.ref_corr_id}</span>
              {draft?.status === "drafting" && (
                <button
                  type="button"
                  onClick={() => setReferences((prev) => prev.filter((_, j) => j !== i))}
                  style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-text-secondary)" }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {draft?.status === "drafting" && (
            <div style={{ position: "relative", marginBottom: 16 }}>
              <input
                value={refSearch}
                onChange={(e) => setRefSearch(e.target.value)}
                placeholder={lang === "tr" ? "RFI veya yazışma ara…" : "Search RFI or correspondence…"}
                style={fieldInput}
              />
              {filtered.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: "100%",
                    zIndex: 5,
                    background: "var(--color-bg-primary)",
                    border: "1px solid var(--color-border-medium)",
                    maxHeight: 180,
                    overflowY: "auto",
                  }}
                >
                  {filtered.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => addRef(doc)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        fontSize: 12,
                        color: "var(--color-text-primary)",
                        fontFamily: "Inter, sans-serif",
                      }}
                    >
                      {doc.ref_number} — {doc.subject}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label style={fieldLabel}>{lang === "tr" ? "Gövde" : "Body"}</label>
          <div
            style={{
              border: "1px solid var(--color-border-medium)",
              padding: 12,
              background: "var(--color-bg-primary)",
              marginBottom: 16,
            }}
          >
            <RichTextEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              readOnly={draft?.status !== "drafting"}
            />
          </div>

          <div
            style={{
              textAlign: "center",
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--color-border-light)",
              color: "var(--color-text-secondary)",
              fontSize: 12,
              fontFamily: "Inter, sans-serif",
            }}
          >
            {tpl?.footer_text || (lang === "tr" ? "(alt bilgi)" : "(footer)")}
          </div>
        </div>
      </div>

      {draft?.status === "drafting" && (
        <div
          style={{
            marginTop: 20,
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "flex-end",
          }}
        >
          <div style={{ flex: "1 1 220px", minWidth: 180 }}>
            <label style={fieldLabel}>
              {lang === "tr" ? "AI talimatı (opsiyonel)" : "AI instructions (optional)"}
            </label>
            <input
              value={aiInstructions}
              onChange={(e) => setAiInstructions(e.target.value)}
              disabled={busy}
              placeholder={
                lang === "tr"
                  ? "Örn. gecikme bildirimi, nazik ton"
                  : "e.g. delay notice, polite tone"
              }
              style={{ ...fieldInput, marginBottom: 0 }}
            />
          </div>
          <button
            type="button"
            disabled={busy || saveState === "conflict"}
            onClick={() => void handleAiDraft()}
            style={btnSecondary}
          >
            {lang === "tr" ? "AI ile taslak oluştur" : "Generate with AI"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleGenerate()}
            style={btnSecondary}
          >
            {lang === "tr" ? "DOCX Üret" : "Generate DOCX"}
          </button>
          <div>
            <label style={fieldLabel}>
              {draft.doc_type === "rfi" ? "RFI number" : "Corr. number"}
            </label>
            <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} style={{ ...fieldInput, width: 160 }} />
          </div>
          <button
            type="button"
            disabled={busy || !docNumber.trim() || saveState === "conflict"}
            onClick={() => void handleApprove()}
            style={btnPrimary}
          >
            {lang === "tr" ? "Onayla & Materyalize" : "Approve & Materialize"}
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(
                draft.doc_type === "rfi"
                  ? `/projects/${projectId}/workspace?module=rfis`
                  : `/projects/${projectId}/workspace?module=correspondence`
              )
            }
            style={btnSecondary}
          >
            {lang === "tr" ? "Geri" : "Back"}
          </button>
        </div>
      )}
      {aiHints && (
        <p
          style={{
            marginTop: 12,
            fontSize: 12,
            color: "var(--color-text-secondary)",
            fontFamily: "Inter, sans-serif",
          }}
        >
          {aiHints}
        </p>
      )}
    </div>
  );
}

const fieldLabel: CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--color-text-secondary)",
  marginBottom: 4,
  fontFamily: "Inter, sans-serif",
};

const fieldInput: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--color-border-medium)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  fontSize: 12,
  fontFamily: "Inter, sans-serif",
  boxSizing: "border-box",
  marginBottom: 12,
};

const btnPrimary: CSSProperties = {
  background: "var(--color-accent)",
  color: "var(--color-bg-primary)",
  border: "none",
  padding: "8px 16px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "Inter, sans-serif",
};

const btnSecondary: CSSProperties = {
  background: "var(--color-bg-secondary)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-medium)",
  padding: "8px 16px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "Inter, sans-serif",
};
