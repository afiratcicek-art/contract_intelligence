import { useCallback, useEffect, useState } from "react";
import LanguageToggle from "../components/LanguageToggle";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { getAuth } from "../store/auth";
import { useLanguage, type Lang } from "../context/LanguageContext";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";
import StatusChip from "../components/StatusChip";
import ConfirmModal from "../components/ConfirmModal";
import Button from "../components/Button";

type SubItem = {
  id: string;
  name: string;
  due_date: string | null;
  status: string;
  fulfillment: string;
  notes: string | null;
  origin: string;
  sort_order: number;
};

type Deliverable = {
  id: string;
  title: string;
  category: string;
  source: string;
  source_ref: string | null;
  kind: string;
  direction: string;
  direction_override: boolean;
  cadence: string;
  status: string;
  due_date: string | null;
  expiry_date: string | null;
  responsible: string | null;
  notes: string | null;
  pending_detail: boolean;
  entry_source: string;
  version: number;
  time_status: string | null;
  days_remaining: number | null;
  contract_title?: string;
  sub_items?: SubItem[];
};

type DocItem = {
  id: string;
  original_filename: string;
  parse_status: string;
  created_at: string;
  doc_date?: string | null;
  keywords?: string[] | null;
};

type FormState = {
  title: string;
  status: string;
  due_date: string;
  expiry_date: string;
  responsible: string;
  notes: string;
  source_ref: string;
  source: string;
  category: string;
  kind: string;
};

const STATUSES = ["open", "in_progress", "completed", "not_applicable"] as const;
const CATEGORIES = [
  "hse",
  "insurance",
  "bond_security",
  "statutory",
  "report",
  "certification",
  "permit_approval",
  "administrative",
  "other",
] as const;
const KINDS = ["artifact", "compliance"] as const;
const SOURCES = [
  "contract_clause",
  "handover",
  "employer_imposition",
  "statutory",
] as const;
const FILE_ACCEPT =
  ".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.jpg,.jpeg,.png,.dwg,.dxf,.txt,.csv";
const PERIOD_KW_PREFIX = "deliv_period:";

const SOURCE_LABEL: Record<string, Record<Lang, string>> = {
  contract_clause: { tr: "Kontrat maddesi", en: "Contract clause", ar: "بند تعاقدي" },
  handover: { tr: "Handover", en: "Handover", ar: "تسليم" },
  employer_imposition: { tr: "İşveren gereklilikleri", en: "Employer requirements", ar: "متطلبات صاحب العمل" },
  statutory: { tr: "Mevzuat", en: "Statutory", ar: "نظامي" },
};

function dateFieldsForCadence(cadence: string): { due: boolean; expiry: boolean } {
  if (cadence === "standing_renewal") return { due: false, expiry: true };
  return { due: true, expiry: false };
}

function isPeriodCadence(cadence: string): boolean {
  return cadence === "recurring" || cadence === "standing_renewal";
}

function formatDocWhen(iso: string | null | undefined, lang: string): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function periodLabelFromDoc(doc: DocItem): string | null {
  const tagged = (doc.keywords ?? []).find((k) => k.startsWith(PERIOD_KW_PREFIX));
  if (tagged) return tagged.slice(PERIOD_KW_PREFIX.length).trim() || null;
  return null;
}

function monthInputToLabel(ym: string, lang: string): string {
  // ym = YYYY-MM
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", {
    month: "long",
    year: "numeric",
  });
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 0); // day 0 of next month = last of this
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function parseStatusDisplay(status: string, lang: string): string | null {
  if (status === "completed" || status === "done") return null;
  if (status === "pending" || status === "processing") {
    return lang === "tr" ? "işleniyor" : "processing";
  }
  if (status === "failed") {
    return lang === "tr" ? "parse hatası" : "parse failed";
  }
  return status;
}

function toForm(d: Deliverable): FormState {
  return {
    title: d.title,
    status: d.status,
    due_date: d.due_date ?? "",
    expiry_date: d.expiry_date ?? "",
    responsible: d.responsible ?? "",
    notes: d.notes ?? "",
    source_ref: d.source_ref ?? "",
    source: d.source,
    category: d.category,
    kind: d.kind,
  };
}

export default function DeliverableDetail() {
  const { projectId, deliverableId } = useParams<{
    projectId: string;
    deliverableId: string;
  }>();
  const navigate = useNavigate();
  const { lang, t } = useLanguage();
  const auth = getAuth();

  const [item, setItem] = useState<Deliverable | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [periodFormOpen, setPeriodFormOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(""); // YYYY-MM for recurring
  const [periodEnd, setPeriodEnd] = useState(""); // YYYY-MM-DD for standing_renewal
  const [periodLabel, setPeriodLabel] = useState("");

  useUnsavedGuard(dirty && !saving);
  const [periodFile, setPeriodFile] = useState<File | null>(null);
  const [newStep, setNewStep] = useState("");
  const [newStepDue, setNewStepDue] = useState("");

  const bg = "var(--color-bg-primary)";
  const cardBg = "var(--color-bg-secondary)";
  const border = "var(--color-border-light)";
  const textPrimary = "var(--color-text-primary)";
  const textSecond = "var(--color-text-secondary)";

  const inputStyle: React.CSSProperties = {
    width: "100%",
    backgroundColor: cardBg,
    border: `1px solid ${border}`,
    color: textPrimary,
    fontSize: 13,
    fontFamily: "var(--font-ui)",
    padding: "8px 10px",
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

  const listUrl = `/projects/${projectId}/workspace?module=deliverables`;

  const load = useCallback(() => {
    if (!projectId || !deliverableId) return;
    setLoading(true);
    Promise.all([
      api.get<Deliverable>(`/projects/${projectId}/deliverables/${deliverableId}`),
      api
        .get<DocItem[]>(
          `/projects/${projectId}/documents/?entity_type=deliverable&entity_id=${deliverableId}`
        )
        .catch(() => [] as DocItem[]),
    ])
      .then(([d, documents]) => {
        setItem(d);
        setForm(toForm(d));
        setDirty(false);
        const list = Array.isArray(documents) ? [...documents] : [];
        list.sort((a, b) => {
          const ta = a.created_at ? Date.parse(a.created_at) : 0;
          const tb = b.created_at ? Date.parse(b.created_at) : 0;
          return tb - ta;
        });
        setDocs(list);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, deliverableId]);

  useEffect(() => {
    load();
  }, [load]);

  const patchForm = (patch: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setSavedFlash(false);
  };

  const handleSave = async () => {
    if (!item || !form) return;
    if (!form.title.trim()) {
      setError(lang === "tr" ? "Başlık zorunlu." : "Title is required.");
      return;
    }
    const dates = dateFieldsForCadence(item.cadence);
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        version: item.version,
        title: form.title.trim(),
        status: form.status,
        responsible: form.responsible.trim() || null,
        notes: form.notes.trim() || null,
        source_ref: form.source_ref.trim() || null,
        source: form.source,
        category: form.category,
        kind: form.kind,
        // Confirming draft → live register entry
        pending_detail: false,
        due_date: dates.due && form.due_date ? form.due_date : null,
        expiry_date: dates.expiry && form.expiry_date ? form.expiry_date : null,
      };
      const updated = await api.put<Deliverable>(
        `/projects/${projectId}/deliverables/${deliverableId}`,
        body
      );
      setItem({ ...item, ...updated, sub_items: item.sub_items });
      setForm(toForm({ ...item, ...updated }));
      setDirty(false);
      setSavedFlash(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/projects/${projectId}/deliverables/${deliverableId}`);
      navigate(listUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const addSubItem = async () => {
    if (!newStep.trim() || !item) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: newStep.trim() };
      if (newStepDue) body.due_date = newStepDue;
      await api.post(
        `/projects/${projectId}/deliverables/${deliverableId}/sub-items`,
        body
      );
      setNewStep("");
      setNewStepDue("");
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleFulfillment = async (sub: SubItem) => {
    const next = sub.fulfillment === "fulfilled" ? "pending" : "fulfilled";
    const status = next === "fulfilled" ? "completed" : sub.status;
    try {
      await api.put(
        `/projects/${projectId}/deliverables/${deliverableId}/sub-items/${sub.id}`,
        { fulfillment: next, status }
      );
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  const removeSubItem = async (subId: string) => {
    try {
      await api.delete(
        `/projects/${projectId}/deliverables/${deliverableId}/sub-items/${subId}`
      );
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || !projectId || !deliverableId) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(
          `/api/v1/projects/${projectId}/documents/upload?entity_type=deliverable&entity_id=${deliverableId}`,
          { method: "POST", credentials: "include", body: formData }
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(
            `${file.name}: ${errData.detail ?? (lang === "tr" ? "Yükleme başarısız" : "Upload failed")}`
          );
        }
      }
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const resetPeriodForm = () => {
    setPeriodFormOpen(false);
    setPeriodMonth("");
    setPeriodEnd("");
    setPeriodLabel("");
    setPeriodFile(null);
  };

  const submitPeriodEvidence = async () => {
    if (!item || !projectId || !deliverableId || !periodFile) return;

    let label = periodLabel.trim();
    let docDate = "";

    if (item.cadence === "recurring") {
      if (!periodMonth) {
        setError(
          lang === "tr"
            ? "Dönem ayını seçin (ör. Temmuz 2026)."
            : "Select the period month (e.g. July 2026)."
        );
        return;
      }
      docDate = lastDayOfMonth(periodMonth);
      if (!label) label = monthInputToLabel(periodMonth, lang);
    } else if (item.cadence === "standing_renewal") {
      if (!periodEnd) {
        setError(
          lang === "tr"
            ? "Bu belgenin geçerlilik / sona erme tarihini girin."
            : "Enter this document's validity / expiry date."
        );
        return;
      }
      docDate = periodEnd;
      if (!label) {
        label =
          lang === "tr"
            ? `Geçerli → ${formatDocWhen(periodEnd, lang)}`
            : `Valid → ${formatDocWhen(periodEnd, lang)}`;
      }
    } else {
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", periodFile);
      const qs = new URLSearchParams({
        entity_type: "deliverable",
        entity_id: deliverableId,
        doc_date: docDate,
        period_label: label,
      });
      const res = await fetch(
        `/api/v1/projects/${projectId}/documents/upload?${qs.toString()}`,
        { method: "POST", credentials: "include", body: formData }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.detail ?? (lang === "tr" ? "Yükleme başarısız" : "Upload failed")
        );
      }

      // Standing renewal: keep card expiry in sync with new period end.
      if (item.cadence === "standing_renewal" && periodEnd) {
        try {
          const updated = await api.put<Deliverable>(
            `/projects/${projectId}/deliverables/${deliverableId}`,
            {
              version: item.version,
              expiry_date: periodEnd,
              pending_detail: false,
            }
          );
          setItem({ ...item, ...updated, sub_items: item.sub_items });
          setForm(toForm({ ...item, ...updated }));
        } catch {
          // Non-fatal — evidence already stored
        }
      }

      resetPeriodForm();
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const openDoc = (docId: string) => {
    window.open(`/projects/${projectId}/view/${docId}`, "_blank", "noopener,noreferrer");
  };

  const datesActive = item ? dateFieldsForCadence(item.cadence) : { due: true, expiry: false };

  const directionLabel =
    item?.direction === "they_owe"
      ? lang === "tr"
        ? "Karşı taraf borçlu"
        : "They owe"
      : lang === "tr"
        ? "Biz borçluyuz"
        : "We owe";

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>
      <nav className="app-chrome-nav">
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
          <span style={{ cursor: "pointer" }} onClick={() => navigate(listUrl)}>
            {t("module.deliverables")}
          </span>
          <span>/</span>
          <span style={{ color: textPrimary, fontWeight: 500 }}>
            {form?.title ?? item?.title ?? "…"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: textSecond }}>{auth?.full_name}</span>
          <LanguageToggle />
        </div>
      </nav>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        {/* Back + Save bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => navigate(listUrl)}
          >
            {lang === "tr" ? "← Listeye dön" : "← Back to list"}
          </Button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {savedFlash && !dirty && (
              <span style={{ fontSize: 12, color: "var(--color-success)" }}>
                {lang === "tr" ? "Kaydedildi" : "Saved"}
              </span>
            )}
            {dirty && (
              <span style={{ fontSize: 12, color: "var(--color-warning)" }}>
                {lang === "tr" ? "Kaydedilmedi" : "Unsaved"}
              </span>
            )}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              disabled={deleting}
            >
              {lang === "tr" ? "Sil" : "Delete"}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || !form || (!dirty && !item?.pending_detail)}
              loading={saving}
              loadingText={lang === "tr" ? "Kaydediliyor…" : "Saving…"}
            >
              {item?.pending_detail
                ? lang === "tr"
                  ? "Kaydet ve onayla"
                  : "Save & confirm"
                : lang === "tr"
                  ? "Kaydet"
                  : "Save"}
            </Button>
          </div>
        </div>

        {loading && (
          <p style={{ fontSize: 12, color: textSecond }}>{t("state.loading")}</p>
        )}
        {error && (
          <p style={{ fontSize: 13, color: "var(--color-alert-red)", marginBottom: 16 }}>
            {error}
          </p>
        )}
        {item && form && (
          <>
            {item.pending_detail && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-warning)",
                  marginBottom: 16,
                  padding: "10px 12px",
                  background: cardBg,
                  borderLeft: "2px solid var(--color-warning)",
                }}
              >
                {lang === "tr"
                  ? "Bu bir taslak. Eksik alanları doldurup «Kaydet ve onayla» ile register'a alın — o zaman diğer kartlarla eş görünür."
                  : "This is a draft. Fill required fields and «Save & confirm» to promote it — then it matches other register cards."}
              </p>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
                marginBottom: 8,
              }}
            >
              <input
                style={{
                  ...inputStyle,
                  fontFamily: "var(--font-brand)",
                  fontSize: "var(--type-h1)",
                  fontWeight: 500,
                  background: "transparent",
                  border: `1px solid ${dirty ? border : "transparent"}`,
                  padding: "4px 8px",
                }}
                value={form.title}
                onChange={(e) => patchForm({ title: e.target.value })}
              />
              {item.pending_detail ? (
                <StatusChip status="draft" />
              ) : (
                <StatusChip status={form.status} />
              )}
            </div>

            <p
              style={{
                fontSize: 12,
                color: textSecond,
                fontFamily: "var(--font-meta)",
                marginBottom: 20,
              }}
            >
              {form.category.replace("_", " ")} · {form.kind} ·{" "}
              {item.cadence.replace("_", " ")}
              {item.pending_detail
                ? ` · ${lang === "tr" ? "taslak" : "draft"}`
                : ""}
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 20,
                padding: 16,
                backgroundColor: cardBg,
                border: `0.5px solid ${border}`,
              }}
            >
              <Meta
                label={lang === "tr" ? "Yön" : "Direction"}
                value={`${directionLabel}${item.direction_override ? " *" : ""}`}
              />
              <div>
                <label style={labelStyle}>
                  {lang === "tr" ? "Kaynak" : "Source"}
                </label>
                <select
                  style={inputStyle}
                  value={form.source}
                  onChange={(e) => patchForm({ source: e.target.value })}
                >
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABEL[s]?.[lang] ?? s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>
                  {lang === "tr" ? "Kategori" : "Category"}
                </label>
                <select
                  style={inputStyle}
                  value={form.category}
                  onChange={(e) => patchForm({ category: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>
                  {lang === "tr" ? "Tür" : "Kind"}
                </label>
                <select
                  style={inputStyle}
                  value={form.kind}
                  onChange={(e) => patchForm({ kind: e.target.value })}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>
                  {lang === "tr" ? "Kaynak referansı" : "Source ref"}
                </label>
                <input
                  style={inputStyle}
                  value={form.source_ref}
                  onChange={(e) => patchForm({ source_ref: e.target.value })}
                  placeholder="Cl.4.2…"
                />
              </div>
              <div>
                <label style={labelStyle}>
                  {lang === "tr" ? "İç sorumlu" : "Responsible"}
                </label>
                <input
                  style={inputStyle}
                  value={form.responsible}
                  onChange={(e) => patchForm({ responsible: e.target.value })}
                />
              </div>
              {datesActive.due && (
                <div>
                  <label style={labelStyle}>
                    {item.cadence === "recurring"
                      ? lang === "tr"
                        ? "Sonraki vade (takip)"
                        : "Next due (tracking)"
                      : lang === "tr"
                        ? "Vade"
                        : "Due"}
                  </label>
                  <input
                    type="date"
                    style={inputStyle}
                    value={form.due_date}
                    onChange={(e) => patchForm({ due_date: e.target.value })}
                  />
                  {item.cadence === "recurring" && (
                    <p
                      style={{
                        fontSize: 11,
                        color: textSecond,
                        margin: "6px 0 0",
                        lineHeight: 1.45,
                      }}
                    >
                      {lang === "tr"
                        ? "Liste ve uyarılar buradan bakar: bir sonraki rapor ne zaman teslim edilmeli? Aşağıdaki «kapsanan ay» ise yüklediğin belgenin hangi döneme ait olduğu — ikisi farklı."
                        : "List and alerts use this: when is the next report due? The period month below is which month the file covers — different things."}
                    </p>
                  )}
                </div>
              )}
              {datesActive.expiry && (
                <div>
                  <label style={labelStyle}>
                    {lang === "tr" ? "Sona erme (takip)" : "Expiry (tracking)"}
                  </label>
                  {item.cadence === "standing_renewal" ? (
                    <>
                      <div
                        style={{
                          ...inputStyle,
                          display: "flex",
                          alignItems: "center",
                          minHeight: 38,
                          color: form.expiry_date ? textPrimary : textSecond,
                          cursor: "default",
                          borderStyle: "dashed",
                          opacity: 0.92,
                        }}
                        aria-readonly="true"
                      >
                        {form.expiry_date
                          ? formatDocWhen(form.expiry_date, lang)
                          : lang === "tr"
                            ? "Henüz dönem yok"
                            : "No period yet"}
                      </div>
                      <p
                        style={{
                          fontSize: 11,
                          color: textSecond,
                          margin: "6px 0 0",
                          lineHeight: 1.45,
                        }}
                      >
                        {lang === "tr"
                          ? "Güncel dönemden gelir. Tarihi buradan değiştirmezsin — aşağıda «Yeni döneme geç» ile yeni dönem kaydı ekle."
                          : "Comes from the current period. Don’t edit here — add a period below via «Start new period»."}
                      </p>
                    </>
                  ) : (
                    <input
                      type="date"
                      style={inputStyle}
                      value={form.expiry_date}
                      onChange={(e) =>
                        patchForm({ expiry_date: e.target.value })
                      }
                    />
                  )}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>{lang === "tr" ? "Notlar" : "Notes"}</label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
                value={form.notes}
                onChange={(e) => patchForm({ notes: e.target.value })}
              />
            </div>

            <div style={{ marginBottom: 28 }}>
              <p style={labelStyle}>{lang === "tr" ? "Statü" : "Status"}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => patchForm({ status: s })}
                    style={{
                      background:
                        form.status === s ? "var(--color-accent)" : "transparent",
                      color: form.status === s ? "var(--color-bg-primary)" : textSecond,
                      border: `1px solid ${
                        form.status === s ? "var(--color-accent)" : border
                      }`,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontFamily: "var(--font-ui)",
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: textSecond, marginTop: 8, fontStyle: "italic" }}>
                {lang === "tr"
                  ? "Statü değişikliği «Kaydet» ile uygulanır."
                  : "Status changes apply on Save."}
              </p>
            </div>

            {/* Evidence history — newest first; prior periods kept for archive */}
            <div style={{ marginBottom: 32 }}>
              <p
                style={{
                  fontFamily: "var(--font-brand)",
                  fontSize: "var(--type-h2)",
                  color: textPrimary,
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              >
                {isPeriodCadence(item.cadence)
                  ? lang === "tr"
                    ? "Kanıt geçmişi"
                    : "Evidence history"
                  : lang === "tr"
                    ? "Belgeler / kanıt"
                    : "Documents / evidence"}
              </p>
              <p style={{ fontSize: 12, color: textSecond, marginBottom: 12 }}>
                {isPeriodCadence(item.cadence)
                  ? lang === "tr"
                    ? "Her satır bir dönem kaydıdır (hangi dönemi kapsadığı yazılıdır). Yeni dönem eklemek eski kaydı silmez — arşive alır."
                    : "Each row is a period record (coverage is shown). Adding a new period archives the current one — it is never deleted."
                  : lang === "tr"
                    ? "PDF, Word, Excel ve benzeri dosyalar."
                    : "PDF, Word, Excel and similar files."}
              </p>
              {docs.length === 0 && (
                <p
                  style={{
                    fontSize: 12,
                    color: textSecond,
                    fontStyle: "italic",
                    marginBottom: 12,
                  }}
                >
                  {lang === "tr" ? "Henüz dönem kaydı yok." : "No period records yet."}
                </p>
              )}
              {docs.map((doc, idx) => {
                const current = idx === 0;
                const archive = isPeriodCadence(item.cadence) && !current;
                const period = periodLabelFromDoc(doc);
                const coverage =
                  period ||
                  (doc.doc_date
                    ? formatDocWhen(doc.doc_date, lang)
                    : null);
                const statusLabel = parseStatusDisplay(doc.parse_status, lang);
                return (
                  <div
                    key={doc.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: current ? "14px 14px" : "10px 12px",
                      backgroundColor: cardBg,
                      marginBottom: 4,
                      borderLeft: current
                        ? "2px solid var(--color-accent)"
                        : `2px solid ${border}`,
                      opacity: archive ? 0.78 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          marginBottom: 4,
                        }}
                      >
                        {isPeriodCadence(item.cadence) && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              fontFamily: "var(--font-meta)",
                              color: current
                                ? "var(--color-accent)"
                                : textSecond,
                            }}
                          >
                            {current
                              ? lang === "tr"
                                ? "Güncel dönem"
                                : "Current period"
                              : lang === "tr"
                                ? "Arşiv"
                                : "Archive"}
                          </span>
                        )}
                      </div>
                      <p
                        style={{
                          fontSize: current ? 15 : 13,
                          color: textPrimary,
                          margin: "0 0 4px",
                          fontWeight: 500,
                        }}
                      >
                        {coverage
                          ? coverage
                          : lang === "tr"
                            ? "Dönem belirtilmemiş"
                            : "Period not set"}
                      </p>
                      <p
                        style={{
                          fontSize: 12,
                          color: textSecond,
                          margin: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {doc.original_filename}
                        <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
                        {lang === "tr" ? "Yükleme" : "Uploaded"}{" "}
                        {formatDocWhen(doc.created_at, lang)}
                        {statusLabel ? (
                          <>
                            <span style={{ margin: "0 6px", opacity: 0.5 }}>·</span>
                            {statusLabel}
                          </>
                        ) : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openDoc(doc.id)}
                      style={{
                        background: "none",
                        border: `1px solid ${border}`,
                        color: textSecond,
                        fontSize: 11,
                        padding: "4px 8px",
                        cursor: "pointer",
                        fontFamily: "var(--font-ui)",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {lang === "tr" ? "Aç" : "Open"}
                    </button>
                  </div>
                );
              })}

              {isPeriodCadence(item.cadence) ? (
                periodFormOpen ? (
                  <div
                    style={{
                      marginTop: 14,
                      padding: 16,
                      backgroundColor: cardBg,
                      borderLeft: "3px solid var(--color-accent)",
                    }}
                  >
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: textPrimary,
                        margin: "0 0 6px",
                      }}
                    >
                      {lang === "tr" ? "Yeni dönem kaydı" : "New period record"}
                    </p>
                    <p
                      style={{
                        fontSize: 12,
                        color: textSecond,
                        margin: "0 0 14px",
                        lineHeight: 1.5,
                      }}
                    >
                      {docs.length > 0
                        ? lang === "tr"
                          ? "Üstteki güncel kayıt arşive iner (silinmez). Buraya girdiğin dönem yeni güncel olur."
                          : "The current record above moves to archive (not deleted). The period you enter becomes current."
                        : lang === "tr"
                          ? "Bu yükümlülük için ilk dönem kaydını oluşturuyorsun."
                          : "Creating the first period record for this obligation."}
                    </p>

                    {item.cadence === "recurring" ? (
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>
                          {lang === "tr" ? "Kapsanan ay" : "Covered month"}
                        </label>
                        <input
                          type="month"
                          style={inputStyle}
                          value={periodMonth}
                          onChange={(e) => {
                            setPeriodMonth(e.target.value);
                            if (e.target.value) {
                              setPeriodLabel(
                                monthInputToLabel(e.target.value, lang)
                              );
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>
                          {lang === "tr"
                            ? "Geçerlilik / sona erme"
                            : "Valid until / expiry"}
                        </label>
                        <input
                          type="date"
                          style={inputStyle}
                          value={periodEnd}
                          onChange={(e) => {
                            setPeriodEnd(e.target.value);
                            if (e.target.value) {
                              setPeriodLabel(
                                lang === "tr"
                                  ? `Geçerli → ${formatDocWhen(e.target.value, lang)}`
                                  : `Valid → ${formatDocWhen(e.target.value, lang)}`
                              );
                            }
                          }}
                        />
                      </div>
                    )}

                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>
                        {lang === "tr"
                          ? "Dönem etiketi (isteğe bağlı düzeltme)"
                          : "Period label (optional override)"}
                      </label>
                      <input
                        style={inputStyle}
                        value={periodLabel}
                        onChange={(e) => setPeriodLabel(e.target.value)}
                        placeholder={
                          lang === "tr"
                            ? "ör. Temmuz 2026 HSE Raporu"
                            : "e.g. July 2026 HSE Report"
                        }
                      />
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <label style={labelStyle}>
                        {lang === "tr" ? "Belge dosyası" : "Evidence file"}
                      </label>
                      <input
                        type="file"
                        accept={FILE_ACCEPT}
                        disabled={uploading}
                        onChange={(e) =>
                          setPeriodFile(e.target.files?.[0] ?? null)
                        }
                        style={{
                          fontSize: 12,
                          fontFamily: "var(--font-ui)",
                          color: textSecond,
                        }}
                      />
                      {periodFile && (
                        <p
                          style={{
                            fontSize: 12,
                            color: textPrimary,
                            margin: "6px 0 0",
                          }}
                        >
                          {periodFile.name}
                        </p>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={resetPeriodForm}
                        disabled={uploading}
                      >
                        {lang === "tr" ? "Vazgeç" : "Cancel"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void submitPeriodEvidence()}
                        disabled={uploading || !periodFile}
                        loading={uploading}
                        loadingText={lang === "tr" ? "Kaydediliyor…" : "Saving…"}
                      >
                        {lang === "tr" ? "Dönemi kaydet" : "Save period"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPeriodFormOpen(true)}
                    style={{
                      display: "inline-block",
                      marginTop: 12,
                      padding: "8px 16px",
                      backgroundColor: cardBg,
                      border: `1px solid ${border}`,
                      color: textSecond,
                      fontSize: 12,
                      fontFamily: "var(--font-ui)",
                      cursor: "pointer",
                    }}
                  >
                    {docs.length > 0
                      ? lang === "tr"
                        ? "Yeni döneme geç…"
                        : "Start new period…"
                      : lang === "tr"
                        ? "İlk dönem kaydını ekle…"
                        : "Add first period record…"}
                  </button>
                )
              ) : (
                <label
                  style={{
                    display: "inline-block",
                    marginTop: 12,
                    padding: "8px 16px",
                    backgroundColor: cardBg,
                    border: `1px solid ${border}`,
                    color: textSecond,
                    fontSize: 12,
                    fontFamily: "var(--font-ui)",
                    cursor: uploading ? "not-allowed" : "pointer",
                    opacity: uploading ? 0.6 : 1,
                  }}
                >
                  {uploading
                    ? lang === "tr"
                      ? "Yükleniyor…"
                      : "Uploading…"
                    : lang === "tr"
                      ? "Belge ekle"
                      : "Add document"}
                  <input
                    type="file"
                    multiple
                    accept={FILE_ACCEPT}
                    disabled={uploading}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      void uploadFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>

            {/* Sub-items */}
            <div style={{ marginBottom: 32 }}>
              <p
                style={{
                  fontFamily: "var(--font-brand)",
                  fontSize: "var(--type-h2)",
                  color: textPrimary,
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              >
                {lang === "tr" ? "Ara adımlar" : "Sub-items"}
              </p>
              <p style={{ fontSize: 12, color: textSecond, marginBottom: 16 }}>
                {lang === "tr"
                  ? "Düz liste — milestone veya tekrar örneği."
                  : "Flat list — milestones or cadence occurrences."}
              </p>

              {(item.sub_items ?? []).length === 0 && (
                <p
                  style={{
                    fontSize: 12,
                    color: textSecond,
                    fontStyle: "italic",
                    marginBottom: 12,
                  }}
                >
                  {lang === "tr" ? "Henüz ara adım yok." : "No sub-items yet."}
                </p>
              )}

              {(item.sub_items ?? []).map((sub) => (
                <div
                  key={sub.id}
                  className="list-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 90px var(--gutter-status) 28px",
                    gap: 8,
                    padding: "10px 12px",
                    backgroundColor: cardBg,
                    marginBottom: 4,
                    alignItems: "center",
                    borderLeft: `2px solid ${
                      sub.fulfillment === "fulfilled"
                        ? "var(--color-success)"
                        : "transparent"
                    }`,
                  }}
                >
                  <div>
                    <p style={{ fontSize: 13, color: textPrimary, margin: 0 }}>
                      {sub.name}
                    </p>
                    <span
                      style={{
                        fontSize: 11,
                        color: textSecond,
                        fontFamily: "var(--font-meta)",
                      }}
                    >
                      {sub.origin === "cadence_generated" ? "cadence" : "user"}
                      {sub.due_date ? ` · ${sub.due_date}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleFulfillment(sub)}
                    style={{
                      background: "none",
                      border: `1px solid ${border}`,
                      color: textSecond,
                      fontSize: 11,
                      padding: "4px 6px",
                      cursor: "pointer",
                      fontFamily: "var(--font-ui)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {sub.fulfillment === "fulfilled"
                      ? t("status.fulfilled")
                      : t("status.pending")}
                  </button>
                  <StatusChip status={sub.status} />
                  <button
                    type="button"
                    onClick={() => removeSubItem(sub.id)}
                    title={lang === "tr" ? "Sil" : "Remove"}
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

              <div
                className="list-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 140px auto",
                  gap: 8,
                  marginTop: 12,
                }}
              >
                <input
                  style={inputStyle}
                  value={newStep}
                  onChange={(e) => setNewStep(e.target.value)}
                  placeholder={
                    lang === "tr" ? "Ara adım adı…" : "Sub-item name…"
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addSubItem();
                  }}
                />
                <input
                  type="date"
                  style={inputStyle}
                  value={newStepDue}
                  onChange={(e) => setNewStepDue(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={addSubItem}
                  disabled={saving || !newStep.trim()}
                >
                  {lang === "tr" ? "Ekle" : "Add"}
                </Button>
              </div>
            </div>

            {/* Bottom save for long forms */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                paddingTop: 8,
                borderTop: `0.5px solid ${border}`,
              }}
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigate(listUrl)}
              >
                {lang === "tr" ? "Listeye dön" : "Back to list"}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={saving || (!dirty && !item.pending_detail)}
                loading={saving}
                loadingText={lang === "tr" ? "Kaydediliyor…" : "Saving…"}
              >
                {item.pending_detail
                  ? lang === "tr"
                    ? "Kaydet ve onayla"
                    : "Save & confirm"
                  : lang === "tr"
                    ? "Kaydet"
                    : "Save"}
              </Button>
            </div>
          </>
        )}
      </div>

      <ConfirmModal
        open={deleteOpen}
        message={
          lang === "tr"
            ? `"${item?.title ?? ""}" silinsin mi? Kayıt arşivlenir (soft-delete); listeden kalkar.`
            : `Delete "${item?.title ?? ""}"? The record is archived (soft-delete) and removed from the list.`
        }
        confirmLabel={deleting ? (lang === "tr" ? "Siliniyor…" : "Deleting…") : (lang === "tr" ? "Sil" : "Delete")}
        cancelLabel={lang === "tr" ? "İptal" : "Cancel"}
        variant="destructive"
        onConfirm={() => {
          if (!deleting) void handleDelete();
        }}
        onCancel={() => {
          if (!deleting) setDeleteOpen(false);
        }}
      />
    </div>
  );
}

function Meta({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <p
        style={{
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-text-secondary)",
          marginBottom: 4,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 13,
          color: color ?? "var(--color-text-primary)",
          margin: 0,
        }}
      >
        {value}
      </p>
    </div>
  );
}
