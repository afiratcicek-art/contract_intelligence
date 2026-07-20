/**
 * ContractSetupForm — sözleşme kaydı (HITL proje kurulumu, ADR-014).
 *
 * In-Force hiyerarşisinin KÖK slotunda, contract === null iken görünür:
 * sözleşme projenin çıpasıdır — yürürlük hiyerarşisi ve ileride RAG bu kayda
 * dayanır; form metni bu önemi kullanıcıya hissettirir.
 *
 * Yazma yolu CM-only'dir (backend require_cm_role + contracts_cm_write RLS);
 * CM olmayan bir kullanıcı submit ederse backend hatası burada gösterilir —
 * frontend rol saklamaz, yetki tek kaynaktan (backend) gelir.
 *
 * Taraflar Faz-1'de kayıt anında yazılır ve sonradan düzenlenmez (039: DELETE
 * policy yok — forensic arşiv). DLP yalnızca UZUNLUK olarak alınır; bitiş
 * tarihi sorulmaz, çünkü DLP penceresi fiili tamamlanmadan türetilir.
 */
import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { createContract, type ContractParty, type ContractRoot } from "../services/api";

interface Props {
  projectId: string;
  onCreated: (contract: ContractRoot) => void;
}

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

const FIELD: CSSProperties = { flex: "1 1 160px", minWidth: 140 };

// Pilot: üç ana rol sabit satır olarak sorulur; boş bırakılan gönderilmez.
const PARTY_ROWS: { role: ContractParty["role"]; label: string }[] = [
  { role: "employer",   label: "İşveren" },
  { role: "contractor", label: "Yüklenici" },
  { role: "engineer",   label: "Mühendis" },
];

export default function ContractSetupForm({ projectId, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [commencement, setCommencement] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [dlpDays, setDlpDays] = useState("");
  const [partyNames, setPartyNames] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createContract(projectId, {
        title: title.trim(),
        ...(contractNumber.trim() && { contract_number: contractNumber.trim() }),
        ...(commencement && { commencement_date: commencement }),
        ...(durationDays && { duration_days: Number(durationDays) }),
        ...(dlpDays && { dlp_days: Number(dlpDays) }),
        parties: PARTY_ROWS
          .filter((p) => (partyNames[p.role] ?? "").trim())
          .map((p) => ({ role: p.role, name: partyNames[p.role].trim() })),
      });
      onCreated(created);
    } catch {
      setError("Sözleşme kaydedilemedi. Yetkinizi (CM) ve alanları kontrol edin.");
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        padding: "14px 16px",
        background: "var(--color-bg-secondary)",
        borderLeft: "5px solid var(--color-warning)",
        display: "flex", flexDirection: "column", gap: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{
          fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)",
          fontFamily: "Inter, sans-serif",
        }}>
          Sözleşme henüz kaydedilmedi
        </span>
        <span style={{
          fontSize: 12, color: "var(--color-text-secondary)",
          fontFamily: "Inter, sans-serif", lineHeight: 1.5,
        }}>
          Sözleşme bu projenin çıpasıdır: yürürlük hiyerarşisi, amendment'lar ve
          ileride yapay zekâ (RAG) analizleri bu kayda dayanır. Kaydı Contract
          Manager yapar — bilgiler asıl sözleşme belgesinden aktarılır.
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ ...FIELD, flex: "2 1 240px" }}>
          <label style={LABEL}>Sözleşme adı *</label>
          <input style={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div style={FIELD}>
          <label style={LABEL}>Sözleşme no</label>
          <input style={INPUT} value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {PARTY_ROWS.map((p) => (
          <div key={p.role} style={FIELD}>
            <label style={LABEL}>{p.label}</label>
            <input
              style={INPUT}
              value={partyNames[p.role] ?? ""}
              onChange={(e) => setPartyNames((prev) => ({ ...prev, [p.role]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={FIELD}>
          <label style={LABEL}>Commencement</label>
          <input type="date" style={INPUT} value={commencement} onChange={(e) => setCommencement(e.target.value)} />
        </div>
        <div style={FIELD}>
          <label style={LABEL}>Süre (gün)</label>
          <input type="number" min={1} style={INPUT} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
        </div>
        <div style={FIELD}>
          <label style={LABEL}>DLP süresi (gün)</label>
          <input type="number" min={1} style={INPUT} value={dlpDays} onChange={(e) => setDlpDays(e.target.value)} />
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-alert-red)", fontFamily: "Inter, sans-serif", margin: 0 }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !title.trim()}
        style={{
          alignSelf: "flex-start",
          fontSize: 12, fontWeight: 500, padding: "7px 16px",
          fontFamily: "Inter, sans-serif",
          background: "var(--color-accent)",
          color: "var(--color-bg-primary)",
          border: "none", borderRadius: 0,
          cursor: submitting || !title.trim() ? "default" : "pointer",
          opacity: submitting || !title.trim() ? 0.6 : 1,
        }}
      >
        {submitting ? "Kaydediliyor..." : "Sözleşmeyi Kaydet"}
      </button>
    </form>
  );
}
