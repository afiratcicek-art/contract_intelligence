/**
 * ContractDocumentsSection — sözleşme belgeleri + satır satır ekler (ADR-014).
 *
 * Kök kartın belge alanı: mevcut bağlı belgeler, site stiline uyumlu
 * "Dosya Seç" butonu (NewCorrespondence ile aynı chip), ve satır satır
 * ek (annex) girdileri — her satırda etiket + dosya.
 *
 * Yazma yolu CM-only (backend require_cm_role + contract_documents_cm_write
 * RLS). Akış: dosya → mevcut /documents/upload (entity_type=contract_document)
 * → addContractDocument / updateContractDocument ile link. Label-only satır
 * migration 040 ile dosyasız kayıt edilebilir (dosya sonra gelir).
 */
import { useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import {
  addContractDocument,
  unlinkContractDocument,
  updateContractDocument,
  uploadContractPdf,
  type ContractDocumentRef,
  type ContractRoot,
} from "../services/api";
import DocumentLink from "./DocumentLink";

interface Props {
  projectId: string;
  contract: ContractRoot;
  onChanged: () => void;
}

const MONO: CSSProperties = {
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 11,
  color: "var(--color-text-secondary)",
};

const LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--color-text-secondary)",
  fontFamily: "JetBrains Mono, monospace",
  marginBottom: 3, display: "block",
};

const INPUT: CSSProperties = {
  fontSize: 12, padding: "6px 8px",
  fontFamily: "Inter, sans-serif",
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
  fontFamily: "Inter, sans-serif",
  cursor: "pointer",
  borderRadius: 0,
  whiteSpace: "nowrap",
  display: "inline-block",
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

export default function ContractDocumentsSection({
  projectId,
  contract,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([newDraft()]);

  const fail = (msg: string) => {
    setError(msg);
    setBusy(false);
  };

  // Quick-add: pick file → upload as contract_document → link (label = filename).
  const handleQuickUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
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
      fail("Belge yüklenemedi. CM yetkinizi ve dosya formatını kontrol edin.");
    }
  };

  const submitDraft = async (row: DraftRow) => {
    const label = row.label.trim();
    if (busy || (!label && !row.file)) return;
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
      fail("Ek kaydedilemedi. CM yetkinizi ve alanları kontrol edin.");
    }
  };

  // Attach a file to an existing label-only annex row.
  const attachToExisting = async (link: ContractDocumentRef, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
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
      fail("Dosya eklenemedi.");
    }
  };

  // Unlink from the contract composition — PDF itself stays in Documents.
  const handleUnlink = async (link: ContractDocumentRef) => {
    if (busy) return;
    const name = link.label ?? link.original_filename ?? "bu belge";
    if (!window.confirm(`"${name}" sözleşmeden kaldırılsın mı?\n(Dosya Documents'ta kalır — yalnızca bağ kopar.)`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unlinkContractDocument(projectId, contract.id, link.id);
      onChanged();
      setBusy(false);
    } catch {
      fail("Belge kaldırılamadı. CM yetkinizi kontrol edin.");
    }
  };

  const docLine = (d: ContractDocumentRef) => {
    const name = d.label ?? d.original_filename ?? "Belge";
    return (
      <div
        key={d.id}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "4px 0", flexWrap: "wrap",
        }}
      >
        <span style={MONO}>{d.precedence_rank != null ? `#${d.precedence_rank}` : "—"}</span>
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
            title="Belgeyi aç"
          >
            {name}
          </DocumentLink>
        ) : (
          <>
            <span style={{ fontSize: 12, color: "var(--color-text-primary)", fontFamily: "Inter, sans-serif" }}>
              {name}
            </span>
            <span style={{ ...MONO, fontStyle: "italic" }}>dosya bekleniyor</span>
            <label style={{ ...FILE_BTN, padding: "4px 10px", fontSize: 11, opacity: busy ? 0.6 : 1 }}>
              Dosya Seç
              <input
                type="file"
                accept={ACCEPT}
                style={{ display: "none" }}
                disabled={busy}
                onChange={(e) => attachToExisting(d, e)}
              />
            </label>
          </>
        )}
        {d.pdf_document_id && d.original_filename && d.label && d.label !== d.original_filename && (
          <span style={MONO}>({d.original_filename})</span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => handleUnlink(d)}
          title="Sözleşmeden kaldır"
          style={{
            background: "none", border: "none",
            color: "var(--color-text-secondary)",
            cursor: busy ? "default" : "pointer",
            fontSize: 14, padding: "0 4px", lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Existing linked / pending documents */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ ...MONO, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Sözleşme belgeleri (öncelik sırası)
        </span>
        {contract.documents.length === 0 ? (
          <p style={{ fontSize: 12, fontStyle: "italic", color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif", margin: 0 }}>
            Henüz bağlı belge yok
          </p>
        ) : (
          contract.documents.map(docLine)
        )}
      </div>

      {/* Quick-add — site-matching Dosya Seç */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ ...FILE_BTN, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}>
          Dosya Seç
          <input
            type="file"
            accept={ACCEPT}
            style={{ display: "none" }}
            disabled={busy}
            onChange={handleQuickUpload}
          />
        </label>
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontStyle: "italic", fontFamily: "Inter, sans-serif" }}>
          PDF, Word, Excel, PowerPoint, Görsel, DWG, DXF, TXT, CSV
        </span>
      </div>

      {/* Line-by-line ekler */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ ...MONO, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Ekler
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
              <label style={LABEL}>Ek adı</label>
              <input
                style={INPUT}
                value={row.label}
                placeholder="ör. EK-1 Özel Şartname"
                disabled={busy}
                onChange={(e) =>
                  setDrafts((prev) =>
                    prev.map((d) => (d.key === row.key ? { ...d, label: e.target.value } : d))
                  )
                }
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={LABEL}>Dosya</span>
              <label style={{ ...FILE_BTN, opacity: busy ? 0.6 : 1 }}>
                {row.file ? row.file.name : "Dosya Seç"}
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
            <button
              type="button"
              disabled={busy || (!row.label.trim() && !row.file)}
              onClick={() => submitDraft(row)}
              style={{
                fontSize: 12, fontWeight: 500, padding: "7px 14px",
                fontFamily: "Inter, sans-serif",
                background: "var(--color-accent)",
                color: "var(--color-bg-primary)",
                border: "none", borderRadius: 0,
                cursor: busy || (!row.label.trim() && !row.file) ? "default" : "pointer",
                opacity: busy || (!row.label.trim() && !row.file) ? 0.6 : 1,
              }}
            >
              Ekle
            </button>
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
                title="Satırı kaldır"
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
            fontFamily: "Inter, sans-serif",
            background: "transparent",
            color: "var(--color-accent-text)",
            border: "1px solid var(--color-border-light)",
            borderRadius: 0, cursor: busy ? "default" : "pointer",
          }}
        >
          + Satır ekle
        </button>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-alert-red)", fontFamily: "Inter, sans-serif", margin: 0 }}>
          {error}
        </p>
      )}
      {busy && (
        <p style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif", margin: 0 }}>
          Kaydediliyor...
        </p>
      )}
    </div>
  );
}
