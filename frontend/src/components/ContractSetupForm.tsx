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
 * contract_type: ProjectDetail CONTRACT_LABEL ile aynı enum; boş bırakılırsa
 * backend projects.contract_type'tan DEFAULT eder (TB-28).
 */
import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { api, createContract, type ContractParty, type ContractRoot } from "../services/api";
import Button from "./Button";
import { useLanguage } from "../context/LanguageContext";

interface Props {
  projectId: string;
  onCreated: (contract: ContractRoot) => void;
}

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

const FIELD: CSSProperties = { flex: "1 1 160px", minWidth: 140 };

const CONTRACT_TYPE_VALUES = [
  "lump_sum", "remeasure", "cost_plus", "target_cost", "epc", "epcm", "framework", "other",
] as const;

const PARTY_ROLES: ContractParty["role"][] = ["employer", "contractor", "engineer"];

export default function ContractSetupForm({ projectId, onCreated }: Props) {
  const { t } = useLanguage();
  const [title, setTitle] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [contractType, setContractType] = useState("");
  const [commencement, setCommencement] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [dlpDays, setDlpDays] = useState("");
  const [partyNames, setPartyNames] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from project's contract_type (continuity; backend also defaults).
  useEffect(() => {
    api
      .get<{ contract_type: string | null }>(`/projects/${projectId}`)
      .then((p) => {
        if (p.contract_type) setContractType(p.contract_type);
      })
      .catch(() => {});
  }, [projectId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createContract(projectId, {
        title: title.trim(),
        ...(contractNumber.trim() && { contract_number: contractNumber.trim() }),
        ...(contractType && { contract_type: contractType }),
        ...(commencement && { commencement_date: commencement }),
        ...(durationDays && { duration_days: Number(durationDays) }),
        ...(dlpDays && { dlp_days: Number(dlpDays) }),
        parties: PARTY_ROLES
          .filter((role) => (partyNames[role] ?? "").trim())
          .map((role) => ({ role, name: partyNames[role].trim() })),
      });
      onCreated(created);
    } catch {
      setError(t("inforce.setup.savefailed"));
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
          fontFamily: "var(--font-ui)",
        }}>
          {t("inforce.setup.title")}
        </span>
        <span style={{
          fontSize: 12, color: "var(--color-text-secondary)",
          fontFamily: "var(--font-ui)", lineHeight: 1.5,
        }}>
          {t("inforce.setup.body")}
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ ...FIELD, flex: "2 1 240px" }}>
          <label style={LABEL}>{t("inforce.setup.name")}</label>
          <input style={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div style={FIELD}>
          <label style={LABEL}>{t("inforce.setup.number")}</label>
          <input style={INPUT} value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} />
        </div>
        <div style={FIELD}>
          <label style={LABEL}>{t("inforce.setup.ctype")}</label>
          <select
            style={INPUT}
            value={contractType}
            onChange={(e) => setContractType(e.target.value)}
          >
            <option value="">{t("inforce.setup.fromproject")}</option>
            {CONTRACT_TYPE_VALUES.map((value) => (
              <option key={value} value={value}>{t(`contract.type.${value}`)}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {PARTY_ROLES.map((role) => (
          <div key={role} style={FIELD}>
            <label style={LABEL}>{t(`party.${role}`)}</label>
            <input
              style={INPUT}
              value={partyNames[role] ?? ""}
              onChange={(e) => setPartyNames((prev) => ({ ...prev, [role]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={FIELD}>
          <label style={LABEL}>{t("inforce.commencement")}</label>
          <input type="date" style={INPUT} value={commencement} onChange={(e) => setCommencement(e.target.value)} />
        </div>
        <div style={FIELD}>
          <label style={LABEL}>{t("inforce.setup.durationdays")}</label>
          <input type="number" min={1} style={INPUT} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
        </div>
        <div style={FIELD}>
          <label style={LABEL}>{t("inforce.setup.dlpdays")}</label>
          <input type="number" min={1} style={INPUT} value={dlpDays} onChange={(e) => setDlpDays(e.target.value)} />
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-alert-red)", fontFamily: "var(--font-ui)", margin: 0 }}>
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="sm"
        disabled={submitting || !title.trim()}
        loading={submitting}
        loadingText={t("state.saving")}
        style={{ alignSelf: "flex-start" }}
      >
        {t("inforce.setup.save")}
      </Button>
    </form>
  );
}
