/**
 * ContractDocumentsSection — sözleşme belgeleri + satır satır ekler (ADR-014).
 *
 * Kök kartın belge alanı: mevcut bağlı belgeler (precedence_rank'e göre
 * sıralı), CM-only ▲▼ yeniden sıralama, site stiline uyumlu "Dosya Seç",
 * ve satır satır ek girdileri.
 *
 * Yazma yolu CM-only (backend require_cm_role + contract_documents_* RLS).
 * CM gate: /projects/{id}/members + getAuth().user_id → project_role === 'cm'
 * (repo'da ayrı frontend CM hook yok; SetupForm backend'e dayanır, burada
 * sıralama kontrolü görünürlük için mirror edilir). Non-CM yalnızca rank okur.
 */
import { useEffect, useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import {
  addContractDocument,
  api,
  unlinkContractDocument,
  updateContractDocument,
  uploadContractPdf,
  type ContractDocumentRef,
  type ContractRoot,
} from "../services/api";
import { getAuth } from "../store/auth";
import { useLanguage } from "../context/LanguageContext";
import DocumentLink from "./DocumentLink";
import Button from "./Button";
import ConfirmModal from "./ConfirmModal";

interface Props {
  projectId: string;
  contract: ContractRoot;
  onChanged: () => void;
}

const MONO: CSSProperties = {
  fontFamily: "var(--font-meta)",
  fontSize: 11,
  color: "var(--color-text-secondary)",
};

const LABEL: CSSProperties = {
  fontSize: 11, fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-meta)",
  marginBottom: 3, display: "block",
};

const INPUT: CSSProperties = {
  fontSize: 12, padding: "6px 8px",
  fontFamily: "var(--font-ui)",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-primary)",
  border: "0.5px solid var(--color-border-light)",
  borderRadius: 0, outline: "none", width: "100%",
  boxSizing: "border-box",
};

// Mirrors NewCorrespondence.tsx "Dosya Seç" label-as-button (borderRadius 0).
const FILE_BTN: CSSProperties = {
  padding: "8px 16px",
  backgroundColor: "var(--color-bg-primary)",
  border: "1px solid var(--color-border-light)",
  color: "var(--color-text-secondary)",
  fontSize: 12,
  fontFamily: "var(--font-ui)",
  cursor: "pointer",
  borderRadius: 0,
  whiteSpace: "nowrap",
  display: "inline-block",
};

const ARROW_BTN: CSSProperties = {
  padding: "2px 6px",
  backgroundColor: "var(--color-bg-primary)",
  border: "1px solid var(--color-border-light)",
  color: "var(--color-text-secondary)",
  fontSize: 10,
  fontFamily: "var(--font-ui)",
  cursor: "pointer",
  borderRadius: 0,
  lineHeight: 1.2,
};

const ACCEPT =
  ".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.jpg,.jpeg,.png,.dwg,.dxf,.txt,.csv";

interface DraftRow {
  key: string;
  label: string;
  file: File | null;
}

let draftSeq = 0;
const newDraft = (): DraftRow => ({ key: `d-${++draftSeq}`, label: "", file: null });

/** Rank 1 first; NULL/unranked last. Stable by id for equal ranks. */
function sortByPrecedence(docs: ContractDocumentRef[]): ContractDocumentRef[] {
  return [...docs].sort((a, b) => {
    const aNull = a.precedence_rank == null;
    const bNull = b.precedence_rank == null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && !bNull && a.precedence_rank !== b.precedence_rank) {
      return (a.precedence_rank as number) - (b.precedence_rank as number);
    }
    return a.id.localeCompare(b.id);
  });
}

export default function ContractDocumentsSection({
  projectId,
  contract,
  onChanged,
}: Props) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([newDraft()]);
  const [isCm, setIsCm] = useState(false);
  const [pendingUnlink, setPendingUnlink] = useState<ContractDocumentRef | null>(null);

  useEffect(() => {
    const me = getAuth()?.user_id;
    if (!me) {
      setIsCm(false);
      return;
    }
    api
      .get<{ user_id: string; project_role: string }[]>(`/projects/${projectId}/members`)
      .then((members) => {
        const row = members.find((m) => m.user_id === me);
        setIsCm(row?.project_role === "cm");
      })
      .catch(() => setIsCm(false));
  }, [projectId]);

  const fail = (msg: string) => {
    setError(msg);
    setBusy(false);
  };

  const ordered = sortByPrecedence(contract.documents);

  // Reassign 1..N over the new order; persist each changed rank via existing
  // CM-only updateContractDocument. Survives reload because ranks are written.
  const persistOrder = async (next: ContractDocumentRef[]) => {
    setBusy(true);
    setError(null);
    try {
      const updates = next.map((d, i) => {
        const rank = i + 1;
        if (d.precedence_rank === rank) return null;
        return updateContractDocument(projectId, contract.id, d.id, {
          precedence_rank: rank,
        });
      }).filter(Boolean);
      if (updates.length > 0) await Promise.all(updates);
      onChanged();
      setBusy(false);
    } catch {
      fail(t("inforce.docs.err.order"));
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    if (busy || !isCm) return;
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    void persistOrder(next);
  };

  // Quick-add: pick file → upload as contract_document → link (label = filename).
  const handleQuickUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy || !isCm) return;
    setBusy(true);
    setError(null);
    try {
      const docId = await uploadContractPdf(projectId, file);
      await addContractDocument(projectId, contract.id, {
        pdf_document_id: docId,
        label: file.name,
      });
      onChanged();
      setBusy(false);
    } catch {
      fail(t("inforce.docs.err.upload"));
    }
  };

  const submitDraft = async (row: DraftRow) => {
    const label = row.label.trim();
    if (busy || !isCm || (!label && !row.file)) return;
    setBusy(true);
    setError(null);
    try {
      let pdfId: string | undefined;
      if (row.file) {
        pdfId = await uploadContractPdf(projectId, row.file);
      }
      await addContractDocument(projectId, contract.id, {
        ...(label && { label }),
        ...(pdfId && { pdf_document_id: pdfId }),
        ...(!label && row.file ? { label: row.file.name } : {}),
      });
      setDrafts((prev) => {
        const next = prev.filter((d) => d.key !== row.key);
        return next.length === 0 ? [newDraft()] : next;
      });
      onChanged();
      setBusy(false);
    } catch {
      fail(t("inforce.docs.err.appendix"));
    }
  };

  const attachToExisting = async (link: ContractDocumentRef, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy || !isCm) return;
    setBusy(true);
    setError(null);
    try {
      const docId = await uploadContractPdf(projectId, file);
      await updateContractDocument(projectId, contract.id, link.id, {
        pdf_document_id: docId,
      });
      onChanged();
      setBusy(false);
    } catch {
      fail(t("inforce.docs.err.attach"));
    }
  };

  const handleUnlink = async (link: ContractDocumentRef) => {
    if (busy || !isCm) return;
    setBusy(true);
    setError(null);
    try {
      await unlinkContractDocument(projectId, contract.id, link.id);
      onChanged();
      setBusy(false);
    } catch {
      fail(t("inforce.docs.err.unlink"));
    } finally {
      setPendingUnlink(null);
    }
  };

  const docLine = (d: ContractDocumentRef, index: number) => {
    const name = d.label ?? d.original_filename ?? t("inforce.docs.fallback");
    return (
      <div
        key={d.id}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "4px 0", flexWrap: "wrap",
        }}
      >
        <span style={MONO}>{d.precedence_rank != null ? `#${d.precedence_rank}` : "—"}</span>
        {isCm && ordered.length > 1 && (
          <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
            <button
              type="button"
              disabled={busy || index === 0}
              onClick={() => move(index, -1)}
              title={t("inforce.docs.rankup")}
              style={{
                ...ARROW_BTN,
                opacity: busy || index === 0 ? 0.4 : 1,
                cursor: busy || index === 0 ? "default" : "pointer",
              }}
            >
              ▲
            </button>
            <button
              type="button"
              disabled={busy || index === ordered.length - 1}
              onClick={() => move(index, 1)}
              title={t("inforce.docs.rankdown")}
              style={{
                ...ARROW_BTN,
                opacity: busy || index === ordered.length - 1 ? 0.4 : 1,
                cursor: busy || index === ordered.length - 1 ? "default" : "pointer",
              }}
            >
              ▼
            </button>
          </span>
        )}
        {d.pdf_document_id ? (
          <DocumentLink
            projectId={projectId}
            docId={d.pdf_document_id}
            style={{
              ...MONO,
              color: "var(--color-accent-text)",
              textDecoration: "underline",
              textUnderlineOffset: 2,
            }}
            title={t("inforce.opendoc")}
          >
            {name}
          </DocumentLink>
        ) : (
          <>
            <span style={{ fontSize: 12, color: "var(--color-text-primary)", fontFamily: "var(--font-ui)" }}>
              {name}
            </span>
            <span style={{ ...MONO, fontStyle: "italic" }}>{t("inforce.docs.waiting")}</span>
            {isCm && (
              <label style={{ ...FILE_BTN, padding: "4px 10px", fontSize: 11, opacity: busy ? 0.6 : 1 }}>
                {t("inforce.docs.choosefile")}
                <input
                  type="file"
                  accept={ACCEPT}
                  style={{ display: "none" }}
                  disabled={busy}
                  onChange={(e) => attachToExisting(d, e)}
                />
              </label>
            )}
          </>
        )}
        {d.pdf_document_id && d.original_filename && d.label && d.label !== d.original_filename && (
          <span style={MONO}>({d.original_filename})</span>
        )}
        {isCm && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setPendingUnlink(d)}
            title={t("inforce.docs.remove")}
            style={{
              background: "none", border: "none",
              color: "var(--color-text-secondary)",
              cursor: busy ? "default" : "pointer",
              fontSize: 14, padding: "0 4px", lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ ...MONO, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {t("inforce.docs.title")}
        </span>
        {ordered.length === 0 ? (
          <p style={{ fontSize: 12, fontStyle: "italic", color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)", margin: 0 }}>
            {t("inforce.docs.empty")}
          </p>
        ) : (
          ordered.map((d, i) => docLine(d, i))
        )}
      </div>

      {isCm && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label style={{ ...FILE_BTN, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}>
              {t("inforce.docs.choosefile")}
              <input
                type="file"
                accept={ACCEPT}
                style={{ display: "none" }}
                disabled={busy}
                onChange={handleQuickUpload}
              />
            </label>
            <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontStyle: "italic", fontFamily: "var(--font-ui)" }}>
              {t("inforce.docs.formats")}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ ...MONO, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {t("inforce.docs.appendices")}
            </span>
            {drafts.map((row) => (
              <div
                key={row.key}
                style={{
                  display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap",
                  padding: "8px 10px",
                  background: "var(--color-bg-primary)",
                  borderLeft: "3px solid var(--color-border-light)",
                }}
              >
                <div style={{ flex: "2 1 180px", minWidth: 140 }}>
                  <label style={LABEL}>{t("inforce.docs.appendname")}</label>
                  <input
                    style={INPUT}
                    value={row.label}
                    placeholder={t("inforce.docs.appendph")}
                    disabled={busy}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((d) => (d.key === row.key ? { ...d, label: e.target.value } : d))
                      )
                    }
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={LABEL}>{t("inforce.docs.file")}</span>
                  <label style={{ ...FILE_BTN, opacity: busy ? 0.6 : 1 }}>
                    {row.file ? row.file.name : t("inforce.docs.choosefile")}
                    <input
                      type="file"
                      accept={ACCEPT}
                      style={{ display: "none" }}
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        e.target.value = "";
                        setDrafts((prev) =>
                          prev.map((d) => (d.key === row.key ? { ...d, file } : d))
                        );
                      }}
                    />
                  </label>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || (!row.label.trim() && !row.file)}
                  onClick={() => submitDraft(row)}
                >
                  {t("inforce.docs.add")}
                </Button>
                {drafts.length > 1 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDrafts((prev) => prev.filter((d) => d.key !== row.key))}
                    style={{
                      background: "none", border: "none",
                      color: "var(--color-text-secondary)",
                      cursor: "pointer", fontSize: 16, padding: "4px 6px",
                    }}
                    title={t("inforce.docs.removerow")}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => setDrafts((prev) => [...prev, newDraft()])}
              style={{
                alignSelf: "flex-start",
                fontSize: 12, padding: "6px 12px",
                fontFamily: "var(--font-ui)",
                background: "transparent",
                color: "var(--color-accent-text)",
                border: "1px solid var(--color-border-light)",
                borderRadius: 0, cursor: busy ? "default" : "pointer",
              }}
            >
              {t("inforce.docs.addrow")}
            </button>
          </div>
        </>
      )}

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-alert-red)", fontFamily: "var(--font-ui)", margin: 0 }}>
          {error}
        </p>
      )}
      {busy && (
        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)", margin: 0 }}>
          {t("state.saving")}
        </p>
      )}
      <ConfirmModal
        open={pendingUnlink != null}
        variant="destructive"
        message={
          pendingUnlink
            ? t("inforce.docs.unlinkconfirm").replace(
                "{n}",
                pendingUnlink.label ?? pendingUnlink.original_filename ?? t("inforce.docs.fallback"),
              )
            : ""
        }
        confirmLabel={t("action.remove")}
        cancelLabel={t("action.cancel")}
        onConfirm={() => {
          if (pendingUnlink) void handleUnlink(pendingUnlink);
        }}
        onCancel={() => setPendingUnlink(null)}
      />
    </div>
  );
}
