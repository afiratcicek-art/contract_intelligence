import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useLanguage } from "../context/LanguageContext";
import {
  createAuthoringTemplate,
  deleteAuthoringTemplate,
  fetchTemplateChromeUrl,
  listAuthoringTemplates,
  updateAuthoringTemplate,
  uploadTemplateChrome,
  type DocumentTemplate,
} from "../services/authoringApi";
import { ApiError } from "../services/api";
import Button from "./Button";
import ConfirmModal from "./ConfirmModal";

interface Props {
  projectId: string;
}

type ChromeSlot = "header" | "footer" | "watermark";
type BandSlot = "header" | "footer";
type Align = "left" | "center" | "right";
type StackOrder = "image_first" | "text_first";

type Selection =
  | { kind: "image"; slot: ChromeSlot }
  | { kind: "text"; slot: BandSlot }
  | { kind: "band"; slot: BandSlot }
  | null;

interface SlotLayout {
  align: Align;
  text_align: Align;
  /** Image width as % of band content width */
  width_pct: number;
  offset_x_pct: number;
  offset_y_pct: number;
  opacity: number;
  /** Header/footer band height (px on paper) */
  band_height_px: number;
  /** Image above text, or text above image */
  stack: StackOrder;
}

type ChromeLayout = Record<ChromeSlot, SlotLayout>;
type PendingChrome = Partial<Record<ChromeSlot, File>>;
type ChromeUrls = Partial<Record<ChromeSlot, string>>;

const SLOTS: ChromeSlot[] = ["header", "footer", "watermark"];

const DEFAULT_SLOT: SlotLayout = {
  align: "center",
  text_align: "center",
  width_pct: 40,
  offset_x_pct: 0,
  offset_y_pct: 0,
  opacity: 0.14,
  band_height_px: 140,
  stack: "image_first",
};

function defaultChrome(): ChromeLayout {
  return {
    header: { ...DEFAULT_SLOT, width_pct: 42, band_height_px: 150, stack: "image_first" },
    footer: { ...DEFAULT_SLOT, width_pct: 36, band_height_px: 120, stack: "text_first" },
    watermark: {
      ...DEFAULT_SLOT,
      width_pct: 50,
      opacity: 0.14,
      band_height_px: 200,
      stack: "image_first",
    },
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function parseAlign(v: unknown, fallback: Align = "center"): Align {
  return v === "left" || v === "right" ? v : fallback;
}

function parseStack(v: unknown, fallback: StackOrder): StackOrder {
  return v === "text_first" ? "text_first" : v === "image_first" ? "image_first" : fallback;
}

function parseChrome(fieldConfig: unknown): ChromeLayout {
  const base = defaultChrome();
  if (!fieldConfig || typeof fieldConfig !== "object") return base;
  const chrome = (fieldConfig as { chrome?: unknown }).chrome;
  if (!chrome || typeof chrome !== "object") return base;
  for (const slot of SLOTS) {
    const raw = (chrome as Record<string, unknown>)[slot];
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const align = parseAlign(r.align, base[slot].align);
    base[slot] = {
      align,
      text_align: parseAlign(r.text_align, align),
      width_pct: clamp(Number(r.width_pct) || base[slot].width_pct, 8, 100),
      offset_x_pct: clamp(Number(r.offset_x_pct) || 0, -45, 45),
      offset_y_pct: clamp(Number(r.offset_y_pct) || 0, -40, 40),
      opacity: clamp(Number(r.opacity) || base[slot].opacity, 0.05, 0.45),
      band_height_px: clamp(
        Number(r.band_height_px) || base[slot].band_height_px,
        72,
        320
      ),
      stack: parseStack(r.stack, base[slot].stack),
    };
  }
  return base;
}

function revokeUrls(urls: ChromeUrls) {
  for (const u of Object.values(urls)) {
    if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
  }
}

/** Fit image inside band: never taller/wider than container; Boyut = max width %. */
function imageStyle(
  cfg: SlotLayout,
  opts?: { opacity?: number; maxHeightPx?: number }
): CSSProperties {
  const maxH = opts?.maxHeightPx ?? 120;
  return {
    display: "block",
    width: "auto",
    height: "auto",
    maxWidth: `${cfg.width_pct}%`,
    maxHeight: maxH,
    objectFit: "contain",
    objectPosition:
      cfg.align === "left" ? "left center" : cfg.align === "right" ? "right center" : "center center",
    opacity: opts?.opacity ?? 1,
    userSelect: "none",
    cursor: "grab",
    marginLeft: cfg.align === "left" ? 0 : "auto",
    marginRight: cfg.align === "right" ? 0 : "auto",
    transform: `translate(${cfg.offset_x_pct}%, ${cfg.offset_y_pct}%)`,
    pointerEvents: "auto",
  };
}

export default function AuthoringTemplatesPanel({ projectId }: Props) {
  const { lang } = useLanguage();
  const tr = lang === "tr";

  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [docType, setDocType] = useState<"letter" | "rfi">("letter");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [layout, setLayout] = useState<ChromeLayout>(defaultChrome);
  const [pending, setPending] = useState<PendingChrome>({});
  const [preview, setPreview] = useState<ChromeUrls>({});
  const [selected, setSelected] = useState<Selection>(null);
  const [pendingDelete, setPendingDelete] = useState<DocumentTemplate | null>(null);

  const previewRef = useRef(preview);
  previewRef.current = preview;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickSlotRef = useRef<ChromeSlot | null>(null);

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

  useEffect(() => () => revokeUrls(previewRef.current), []);

  function resetEditor() {
    revokeUrls(preview);
    setEditingId(null);
    setName("");
    setDocType("letter");
    setHeaderText("");
    setFooterText("");
    setLayout(defaultChrome());
    setPending({});
    setPreview({});
    setSelected(null);
  }

  async function startEdit(tpl: DocumentTemplate) {
    revokeUrls(preview);
    setEditingId(tpl.id);
    setName(tpl.name);
    setDocType(tpl.doc_type);
    setHeaderText(tpl.header_text || "");
    setFooterText(tpl.footer_text || "");
    setLayout(parseChrome(tpl.field_config));
    setPending({});
    setSelected(null);
    const urls: ChromeUrls = {};
    await Promise.all(
      SLOTS.map(async (slot) => {
        const pathKey =
          slot === "header"
            ? "header_image_path"
            : slot === "footer"
              ? "footer_image_path"
              : "watermark_image_path";
        if (!tpl[pathKey]) return;
        try {
          const res = await fetchTemplateChromeUrl(projectId, tpl.id, slot);
          urls[slot] = res.signed_url;
        } catch {
          /* ignore */
        }
      })
    );
    setPreview(urls);
  }

  function setChromeFile(slot: ChromeSlot, file: File | null) {
    setPreview((prev) => {
      const old = prev[slot];
      if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
      const next = { ...prev };
      if (file) next[slot] = URL.createObjectURL(file);
      else if (!editingId) delete next[slot];
      return next;
    });
    setPending((prev) => {
      const next = { ...prev };
      if (file) next[slot] = file;
      else delete next[slot];
      return next;
    });
    if (file) setSelected({ kind: "image", slot });
  }

  /** Must stay sync inside the click handler (browser user-gesture). */
  function openPicker(slot: ChromeSlot) {
    pickSlotRef.current = slot;
    const el = fileInputRef.current;
    if (el) {
      el.value = "";
      el.click();
    }
  }

  function patchSlot(slot: ChromeSlot, patch: Partial<SlotLayout>) {
    setLayout((prev) => ({ ...prev, [slot]: { ...prev[slot], ...patch } }));
  }

  async function handleSave() {
    if (!name.trim()) {
      setError(tr ? "Şablon adı gerekli." : "Template name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const field_config = { chrome: layout };
    try {
      let tplId = editingId;
      if (editingId) {
        await updateAuthoringTemplate(projectId, editingId, {
          name: name.trim(),
          header_text: headerText,
          footer_text: footerText,
          field_config,
          is_active: true,
        });
      } else {
        const created = await createAuthoringTemplate(projectId, {
          doc_type: docType,
          name: name.trim(),
          header_text: headerText || undefined,
          footer_text: footerText || undefined,
          is_active: true,
          field_config,
        });
        tplId = created.id;
      }
      if (tplId) {
        for (const slot of SLOTS) {
          const file = pending[slot];
          if (file) await uploadTemplateChrome(projectId, tplId, slot, file);
        }
        await updateAuthoringTemplate(projectId, tplId, { field_config });
      }
      resetEditor();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(tpl: DocumentTemplate) {
    setBusy(true);
    setError(null);
    try {
      await deleteAuthoringTemplate(projectId, tpl.id);
      if (editingId === tpl.id) resetEditor();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    } finally {
      setBusy(false);
      setPendingDelete(null);
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

  const field: CSSProperties = {
    width: "100%",
    padding: "7px 10px",
    border: "1px solid var(--color-border-medium)",
    background: "var(--color-bg-primary)",
    color: "var(--color-text-primary)",
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    boxSizing: "border-box",
  };
  const lab: CSSProperties = {
    fontSize: 11,
    color: "var(--color-text-secondary)",
    fontFamily: "var(--font-ui)",
    display: "block",
    marginBottom: 4,
  };

  return (
    <div style={{ marginTop: 32, maxWidth: "100%", overflow: "hidden" }}>
      <h3
        style={{
          fontFamily: "var(--font-brand)",
          fontSize: "var(--type-title-card)",
          color: "var(--color-text-primary)",
          fontWeight: 500,
          marginBottom: 8,
        }}
      >
        {tr ? "Belge Şablonları (Letterhead)" : "Document Templates (Letterhead)"}
      </h3>
      <p
        style={{
          fontSize: 12,
          color: "var(--color-text-secondary)",
          marginBottom: 16,
          fontFamily: "var(--font-ui)",
          lineHeight: 1.45,
        }}
      >
        {tr
          ? "Ayarlar Word/DOCX export ile hizalı (A4): boyut, hiza, sıra, bant yüksekliği, filigran. Kaydettikten sonra yazışma export’unda aynı düzen uygulanır."
          : "Settings map to Word/DOCX export (A4): size, align, order, band height, watermark. After save, letter export uses the same layout."}
      </p>

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-alert-red)", marginBottom: 12 }}>{error}</p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto auto",
          gap: 12,
          marginBottom: 10,
          alignItems: "end",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <label style={lab}>{tr ? "Şablon adı" : "Name"}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tr ? "ör. Ana antet" : "e.g. Main letterhead"}
            style={field}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <label style={lab}>{tr ? "Tür" : "Type"}</label>
          <select
            value={docType}
            disabled={!!editingId}
            onChange={(e) => setDocType(e.target.value as "letter" | "rfi")}
            style={field}
          >
            <option value="letter">Letter</option>
            <option value="rfi">RFI</option>
          </select>
        </div>
        {editingId && (
          <button type="button" disabled={busy} onClick={resetEditor} style={ghostBtn}>
            {tr ? "İptal" : "Cancel"}
          </button>
        )}
        <Button
          type="button"
          size="sm"
          disabled={busy || !name.trim()}
          loading={busy}
          loadingText={tr ? "Kaydediliyor…" : "Saving…"}
          onClick={() => void handleSave()}
        >
          {editingId
            ? tr
              ? "Güncelle"
              : "Update"
            : tr
              ? "Şablonu kaydet"
              : "Save template"}
        </Button>
      </div>

      <FormatRibbon
        tr={tr}
        selected={selected}
        layout={layout}
        hasImage={selected?.kind === "image" ? !!preview[selected.slot] : false}
        onPatchSlot={patchSlot}
        onPickImage={openPicker}
        onClearLocalImage={(slot) => setChromeFile(slot, null)}
      />

      <InteractivePaper
        tr={tr}
        layout={layout}
        preview={preview}
        headerText={headerText}
        footerText={footerText}
        selected={selected}
        onSelect={setSelected}
        onPickZone={openPicker}
        onHeaderText={setHeaderText}
        onFooterText={setFooterText}
        onPatchSlot={patchSlot}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        style={{ display: "none" }}
        onChange={(e) => {
          const slot = pickSlotRef.current;
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (slot && file) setChromeFile(slot, file);
        }}
      />

      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--color-text-secondary)",
          fontFamily: "var(--font-ui)",
          margin: "28px 0 10px",
        }}
      >
        {tr ? "Kayıtlı şablonlar" : "Saved templates"}
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>…</p>
      ) : templates.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", fontStyle: "italic" }}>
          {tr ? "Henüz şablon yok." : "No templates yet."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              style={{
                padding: 12,
                background: "var(--color-bg-secondary)",
                borderLeft:
                  editingId === tpl.id
                    ? "3px solid var(--color-accent)"
                    : tpl.is_active
                      ? "3px solid var(--color-accent-light)"
                      : "3px solid transparent",
                display: "flex",
                gap: 14,
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 13, fontFamily: "var(--font-ui)", color: "var(--color-text-primary)" }}>
                {tpl.name}{" "}
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                  ({tpl.doc_type}) ·{" "}
                  {tpl.is_active ? (tr ? "Aktif" : "Active") : tr ? "Pasif" : "Inactive"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={busy} onClick={() => void startEdit(tpl)} style={ghostBtn}>
                  {tr ? "Düzenle" : "Edit"}
                </button>
                {!tpl.is_active && (
                  <button type="button" disabled={busy} onClick={() => void setActive(tpl)} style={ghostBtn}>
                    {tr ? "Aktifleştir" : "Activate"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingDelete(tpl)}
                  style={{ ...ghostBtn, color: "var(--color-alert-red)" }}
                >
                  {tr ? "Sil" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={pendingDelete != null}
        variant="destructive"
        message={
          pendingDelete
            ? tr
              ? `"${pendingDelete.name}" şablonunu silmek istediğinize emin misiniz?`
              : `Delete template “${pendingDelete.name}”?`
            : ""
        }
        confirmLabel={tr ? "Sil" : "Delete"}
        cancelLabel={tr ? "İptal" : "Cancel"}
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

const ghostBtn: CSSProperties = {
  fontSize: 11,
  border: "1px solid var(--color-border-medium)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  padding: "5px 10px",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
};

function AlignGroup({
  value,
  onChange,
  label,
  tr,
}: {
  value: Align;
  onChange: (a: Align) => void;
  label: string;
  tr: boolean;
}) {
  const opts: Align[] = ["left", "center", "right"];
  const title = (a: Align) =>
    a === "left" ? (tr ? "Sol" : "Left") : a === "right" ? (tr ? "Sağ" : "Right") : tr ? "Orta" : "Center";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <div style={{ display: "inline-flex", border: "1px solid var(--color-border-medium)" }}>
        {opts.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onChange(a)}
            style={{
              minWidth: 44,
              height: 28,
              border: "none",
              borderRight: a !== "right" ? "1px solid var(--color-border-medium)" : "none",
              background: value === a ? "var(--color-accent-wash)" : "var(--color-bg-primary)",
              color: value === a ? "var(--color-accent-text)" : "var(--color-text-primary)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: value === a ? 600 : 400,
              fontFamily: "var(--font-ui)",
            }}
          >
            {title(a)}
          </button>
        ))}
      </div>
    </div>
  );
}

function FormatRibbon({
  tr,
  selected,
  layout,
  hasImage,
  onPatchSlot,
  onPickImage,
  onClearLocalImage,
}: {
  tr: boolean;
  selected: Selection;
  layout: ChromeLayout;
  hasImage: boolean;
  onPatchSlot: (slot: ChromeSlot, patch: Partial<SlotLayout>) => void;
  onPickImage: (slot: ChromeSlot) => void;
  onClearLocalImage: (slot: ChromeSlot) => void;
}) {
  const idle = !selected;
  const slot: ChromeSlot | null = selected ? selected.slot : null;
  const cfg = slot ? layout[slot] : null;
  const isText = selected?.kind === "text";
  const isImage = selected?.kind === "image";
  const isBand = selected?.kind === "band";
  const isWm = isImage && selected.slot === "watermark";
  const isBandSlot = slot === "header" || slot === "footer";

  const label = idle
    ? tr
      ? "Seçim yok"
      : "Nothing selected"
    : isBand
      ? selected.slot === "header"
        ? tr
          ? "Üst bilgi bandı"
          : "Header band"
        : tr
          ? "Alt bilgi bandı"
          : "Footer band"
      : isText
        ? selected.slot === "header"
          ? tr
            ? "Üst metin"
            : "Header text"
          : tr
            ? "Alt metin"
            : "Footer text"
        : selected.slot === "header"
          ? tr
            ? "Üst görsel"
            : "Header image"
          : selected.slot === "footer"
            ? tr
              ? "Alt görsel"
              : "Footer image"
            : tr
              ? "Filigran"
              : "Watermark";

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
        padding: "10px 12px",
        background: "var(--color-bg-secondary)",
        border: "1px solid var(--color-border-medium)",
        borderBottom: "none",
        fontFamily: "var(--font-ui)",
        minHeight: 52,
      }}
    >
      <strong style={{ fontSize: 12, color: "var(--color-text-primary)", minWidth: 100 }}>
        {label}
      </strong>

      {isText && cfg && isBandSlot && (
        <AlignGroup
          tr={tr}
          label={tr ? "Hiza" : "Align"}
          value={cfg.text_align}
          onChange={(a) => onPatchSlot(slot!, { text_align: a })}
        />
      )}

      {(isBand || isImage) && cfg && isBandSlot && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--color-text-secondary)" }}>
          {tr ? "Bant yüksekliği" : "Band height"}
          <input
            type="range"
            min={72}
            max={320}
            value={cfg.band_height_px}
            onChange={(e) => onPatchSlot(slot!, { band_height_px: Number(e.target.value) })}
          />
          <span style={{ minWidth: 40 }}>{cfg.band_height_px}px</span>
        </label>
      )}

      {(isBand || isText || isImage) && cfg && isBandSlot && (
        <button
          type="button"
          style={ghostBtn}
          onClick={() =>
            onPatchSlot(slot!, {
              stack: cfg.stack === "image_first" ? "text_first" : "image_first",
            })
          }
        >
          {tr
            ? cfg.stack === "image_first"
              ? "Sıra: Görsel → Metin (değiştir)"
              : "Sıra: Metin → Görsel (değiştir)"
            : cfg.stack === "image_first"
              ? "Order: Image → Text (swap)"
              : "Order: Text → Image (swap)"}
        </button>
      )}

      {isImage && cfg && slot && (
        <>
          <AlignGroup
            tr={tr}
            label={tr ? "Görsel konumu" : "Picture"}
            value={cfg.align}
            onChange={(a) => onPatchSlot(slot, { align: a, offset_x_pct: 0 })}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--color-text-secondary)" }}>
            {tr ? "Boyut" : "Size"}
            <input
              type="range"
              min={8}
              max={100}
              value={cfg.width_pct}
              onChange={(e) => onPatchSlot(slot, { width_pct: Number(e.target.value) })}
            />
            <span style={{ minWidth: 36 }}>{cfg.width_pct}%</span>
          </label>
          <div style={{ display: "flex", gap: 4 }}>
            {(["←", "→"] as const).map((arrow, i) => (
              <button
                key={arrow}
                type="button"
                style={ghostBtn}
                onClick={() =>
                  onPatchSlot(slot, {
                    offset_x_pct: clamp(cfg.offset_x_pct + (i === 0 ? -3 : 3), -45, 45),
                  })
                }
              >
                {arrow}
              </button>
            ))}
            {isWm &&
              (["↑", "↓"] as const).map((arrow, i) => (
                <button
                  key={arrow}
                  type="button"
                  style={ghostBtn}
                  onClick={() =>
                    onPatchSlot(slot, {
                      offset_y_pct: clamp(cfg.offset_y_pct + (i === 0 ? -3 : 3), -40, 40),
                    })
                  }
                >
                  {arrow}
                </button>
              ))}
          </div>
          {isWm && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--color-text-secondary)" }}>
              {tr ? "Opaklık" : "Opacity"}
              <input
                type="range"
                min={5}
                max={40}
                value={Math.round(cfg.opacity * 100)}
                onChange={(e) => onPatchSlot(slot, { opacity: Number(e.target.value) / 100 })}
              />
              <span>{Math.round(cfg.opacity * 100)}%</span>
            </label>
          )}
          <button type="button" style={ghostBtn} onClick={() => onPickImage(slot)}>
            {hasImage ? (tr ? "Değiştir" : "Replace") : tr ? "Resim ekle" : "Insert"}
          </button>
          {hasImage && (
            <button
              type="button"
              style={{ ...ghostBtn, color: "var(--color-alert-red)" }}
              onClick={() => onClearLocalImage(slot)}
            >
              {tr ? "Kaldır" : "Remove"}
            </button>
          )}
        </>
      )}

      {idle && (
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontStyle: "italic" }}>
          {tr
            ? "Üst/alt banda, metne, logoya veya filigrana tıklayın."
            : "Click a band, text, logo, or watermark."}
        </span>
      )}
    </div>
  );
}

function BandBlock({
  tr,
  slot,
  cfg,
  previewUrl,
  text,
  selected,
  onSelect,
  onPickZone,
  onText,
  onPointerDownImg,
  onPointerMove,
  onPointerUp,
}: {
  tr: boolean;
  slot: BandSlot;
  cfg: SlotLayout;
  previewUrl?: string;
  text: string;
  selected: Selection;
  onSelect: (s: Selection) => void;
  onPickZone: (s: ChromeSlot) => void;
  onText: (v: string) => void;
  onPointerDownImg: (slot: ChromeSlot, e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
}) {
  const selBand = selected?.kind === "band" && selected.slot === slot;
  const selImg = selected?.kind === "image" && selected.slot === slot;
  const selTxt = selected?.kind === "text" && selected.slot === slot;

  // Padding + gap + text reserve — editor chrome is not in the band flow
  const imgMaxH = Math.max(32, cfg.band_height_px - 8 - 8 - 4 - 52);

  const imageBlock = (
    <div
      key="img"
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        outline: selImg ? "2px solid var(--color-accent)" : "none",
        outlineOffset: 2,
        padding: 4,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        overflow: "hidden",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ kind: "image", slot });
      }}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          draggable={false}
          onPointerDown={(e) => onPointerDownImg(slot, e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={imageStyle(cfg, { maxHeightPx: imgMaxH })}
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect({ kind: "image", slot });
            onPickZone(slot);
          }}
          style={{
            border: "1px dashed var(--color-print-edge)",
            background: "transparent",
            color: "var(--color-print-muted)",
            fontSize: 11,
            padding: "10px 12px",
            cursor: "pointer",
            width: "100%",
            textAlign: cfg.align,
            fontFamily: "var(--font-ui)",
          }}
        >
          {tr ? "Resim Ekle" : "Insert Picture"}
        </button>
      )}
    </div>
  );

  const textBlock = (
    <textarea
      key="txt"
      value={text}
      rows={2}
      onChange={(e) => onText(e.target.value)}
      onFocus={() => onSelect({ kind: "text", slot })}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ kind: "text", slot });
      }}
      placeholder={tr ? "Metin yazın…" : "Type text…"}
      style={{
        width: "100%",
        boxSizing: "border-box",
        resize: "none",
        flex: "0 0 auto",
        minHeight: 40,
        maxHeight: 52,
        border: selTxt ? "1px solid var(--color-accent)" : "1px solid transparent",
        background: selTxt ? "var(--color-print-text-wash)" : "transparent",
        padding: "6px 4px",
        fontSize: 12,
        lineHeight: 1.35,
        color: "var(--color-print-body)",
        outline: "none",
        fontFamily: "var(--font-ui)",
        textAlign: cfg.text_align,
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
      }}
    />
  );

  const kids =
    cfg.stack === "image_first" ? [imageBlock, textBlock] : [textBlock, imageBlock];

  return (
    <div
      style={{
        position: "relative",
        height: cfg.band_height_px,
        minHeight: cfg.band_height_px,
        maxHeight: cfg.band_height_px,
        overflow: "hidden",
        borderBottom: slot === "header" ? "1px solid var(--color-print-rule)" : undefined,
        borderTop: slot === "footer" ? "1px solid var(--color-print-rule)" : undefined,
        padding: "8px 4px",
        flexShrink: 0,
        outline: selBand ? "2px solid var(--color-accent)" : "none",
        outlineOffset: 2,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ kind: "band", slot });
      }}
    >
      {kids}
    </div>
  );
}

function InteractivePaper({
  tr,
  layout,
  preview,
  headerText,
  footerText,
  selected,
  onSelect,
  onPickZone,
  onHeaderText,
  onFooterText,
  onPatchSlot,
}: {
  tr: boolean;
  layout: ChromeLayout;
  preview: ChromeUrls;
  headerText: string;
  footerText: string;
  selected: Selection;
  onSelect: (s: Selection) => void;
  onPickZone: (s: ChromeSlot) => void;
  onHeaderText: (v: string) => void;
  onFooterText: (v: string) => void;
  onPatchSlot: (slot: ChromeSlot, patch: Partial<SlotLayout>) => void;
}) {
  const paperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    slot: ChromeSlot;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  function onPointerDownImg(slot: ChromeSlot, e: ReactPointerEvent) {
    if (!preview[slot]) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect({ kind: "image", slot });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      slot,
      startX: e.clientX,
      startY: e.clientY,
      origX: layout[slot].offset_x_pct,
      origY: layout[slot].offset_y_pct,
    };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const drag = dragRef.current;
    const paper = paperRef.current;
    if (!drag || !paper) return;
    const rect = paper.getBoundingClientRect();
    const dx = ((e.clientX - drag.startX) / rect.width) * 100;
    const dy = ((e.clientY - drag.startY) / rect.height) * 100;
    onPatchSlot(drag.slot, {
      offset_x_pct: clamp(drag.origX + dx, -45, 45),
      offset_y_pct:
        drag.slot === "watermark"
          ? clamp(drag.origY + dy, -40, 40)
          : clamp(drag.origY + dy * 0.4, -20, 20),
    });
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  const selWm = selected?.kind === "image" && selected.slot === "watermark";

  return (
    <div
      ref={paperRef}
      onClick={() => onSelect(null)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: "relative",
        background: "var(--color-print-paper)",
        color: "var(--color-print-ink)",
        // A4 portrait aspect (210×297) — matches docx_builder page size
        width: "100%",
        maxWidth: 640,
        marginInline: "auto",
        aspectRatio: "210 / 297",
        minHeight: 0,
        height: "auto",
        padding: "5% 7% 4%",
        border: "1px solid var(--color-border-medium)",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <BandBlock
        tr={tr}
        slot="header"
        cfg={layout.header}
        previewUrl={preview.header}
        text={headerText}
        selected={selected}
        onSelect={onSelect}
        onPickZone={onPickZone}
        onText={onHeaderText}
        onPointerDownImg={onPointerDownImg}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />

      {/* Body + watermark — auto-fit; ~body share of A4 between bands */}
      <div
        style={{
          position: "relative",
          flex: "1 1 auto",
          minHeight: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "12px 8px",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p
          style={{
            position: "absolute",
            inset: 12,
            margin: 0,
            fontSize: 12,
            color: "var(--color-print-hint)",
            lineHeight: 1.65,
            fontStyle: "italic",
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          {tr
            ? "Gövde — yazışma / RFI editöründe yazılır."
            : "Body — written in the letter / RFI editor."}
        </p>

        <div
          style={{
            position: "relative",
            zIndex: 2,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {preview.watermark ? (
            <img
              src={preview.watermark}
              alt=""
              draggable={false}
              onClick={() => onSelect({ kind: "image", slot: "watermark" })}
              onPointerDown={(e) => onPointerDownImg("watermark", e)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              style={{
                ...imageStyle(layout.watermark, {
                  opacity: layout.watermark.opacity,
                  // ~45% of A4 preview body zone
                  maxHeightPx: 200,
                }),
                outline: selWm ? "2px solid var(--color-accent)" : "none",
                outlineOffset: 4,
              }}
            />
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ kind: "image", slot: "watermark" });
                onPickZone("watermark");
              }}
              style={{
                display: "block",
                border: "1px dashed var(--color-print-edge)",
                background: "var(--color-print-paper-wash)",
                color: "var(--color-print-muted)",
                fontSize: 11,
                padding: "12px 18px",
                cursor: "pointer",
                fontFamily: "var(--font-ui)",
                position: "relative",
                zIndex: 3,
              }}
            >
              {tr ? "+ Filigran ekle" : "+ Add watermark"}
            </button>
          )}
        </div>
      </div>

      <BandBlock
        tr={tr}
        slot="footer"
        cfg={layout.footer}
        previewUrl={preview.footer}
        text={footerText}
        selected={selected}
        onSelect={onSelect}
        onPickZone={onPickZone}
        onText={onFooterText}
        onPointerDownImg={onPointerDownImg}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}
