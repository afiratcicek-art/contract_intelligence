import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppChrome, { ChromeCrumb, ChromeSep } from "../components/AppChrome";
import Button from "../components/Button";
import { useLanguage } from "../context/LanguageContext";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";
import { api, invalidateCache } from "../services/api";

const CONTRACT_TYPES = [
  "lump_sum",
  "remeasure",
  "cost_plus",
  "target_cost",
  "epc",
  "epcm",
  "framework",
  "other",
] as const;

const CURRENCIES = ["USD", "EUR", "GBP", "SAR", "AED", "TRY"] as const;

export default function NewProject() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [employer, setEmployer] = useState("");
  const [contractor, setContractor] = useState("");
  const [engineer, setEngineer] = useState("");
  const [contractType, setContractType] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  useUnsavedGuard(dirty && !loading);

  const inputStyle = {
    width: "100%",
    backgroundColor: "var(--color-bg-secondary)",
    border: "1px solid var(--color-border-light)",
    color: "var(--color-text-primary)",
    fontSize: 13,
    fontFamily: "var(--font-ui)",
    padding: "10px 12px",
    borderRadius: 0,
    minHeight: "var(--control-height)",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    fontSize: 11,
    fontWeight: 500 as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "var(--color-text-secondary)",
    display: "block",
    marginBottom: 6,
  };

  async function handleSubmit() {
    if (!name.trim()) {
      setError(t("project.err.name"));
      return;
    }
    if (!employer.trim() || !contractor.trim()) {
      setError(t("project.err.parties"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const amount = value.trim() ? Number(value) : undefined;
      const created = await api.post<{ id: string }>("/projects", {
        name: name.trim(),
        employer_name: employer.trim(),
        contractor_name: contractor.trim(),
        engineer_name: engineer.trim() || undefined,
        contract_type: contractType || undefined,
        contract_value: amount !== undefined && Number.isFinite(amount) ? amount : undefined,
        currency,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
      invalidateCache("/projects");
      setDirty(false);
      navigate(`/projects/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("project.err.save"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{ minHeight: "100vh", backgroundColor: "var(--color-bg-primary)" }}
      onChangeCapture={() => setDirty(true)}
    >
      <AppChrome
        density="nav"
        signOut
        trail={
          <>
            <ChromeCrumb onClick={() => navigate("/dashboard")}>{t("nav.projects")}</ChromeCrumb>
            <ChromeSep />
            <ChromeCrumb current>{t("dashboard.newproject")}</ChromeCrumb>
          </>
        }
      />
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
        <p
          style={{
            fontFamily: "var(--font-brand)",
            fontSize: "var(--type-h1)",
            color: "var(--color-text-primary)",
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          {t("dashboard.newproject")}
        </p>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 28 }}>
          {t("project.newhint")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label htmlFor="project-name" style={labelStyle}>{t("project.field.name")}</label>
            <input id="project-name" className="field-input" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="project-employer" style={labelStyle}>{t("party.employer")}</label>
            <input id="project-employer" className="field-input" style={inputStyle} value={employer} onChange={(e) => setEmployer(e.target.value)} />
          </div>
          <div>
            <label htmlFor="project-contractor" style={labelStyle}>{t("party.contractor")}</label>
            <input id="project-contractor" className="field-input" style={inputStyle} value={contractor} onChange={(e) => setContractor(e.target.value)} />
          </div>
          <div>
            <label htmlFor="project-engineer" style={labelStyle}>{t("party.engineer")}</label>
            <input id="project-engineer" className="field-input" style={inputStyle} value={engineer} onChange={(e) => setEngineer(e.target.value)} />
          </div>
          <div>
            <label htmlFor="project-type" style={labelStyle}>{t("project.field.type")}</label>
            <select id="project-type" className="field-input" style={inputStyle} value={contractType} onChange={(e) => setContractType(e.target.value)}>
              <option value="">{t("project.field.typenone")}</option>
              {CONTRACT_TYPES.map((ct) => (
                <option key={ct} value={ct}>{t(`contract.type.${ct}`)}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12 }}>
            <div>
              <label htmlFor="project-value" style={labelStyle}>{t("project.field.value")}</label>
              <input
                id="project-value"
                className="field-input"
                style={inputStyle}
                type="number"
                min="0"
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="project-currency" style={labelStyle}>{t("project.field.currency")}</label>
              <select id="project-currency" className="field-input" style={inputStyle} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label htmlFor="project-start" style={labelStyle}>{t("project.field.start")}</label>
              <input id="project-start" className="field-input" style={inputStyle} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="project-end" style={labelStyle}>{t("project.field.end")}</label>
              <input id="project-end" className="field-input" style={inputStyle} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          {error && <p style={{ fontSize: 12, color: "var(--color-alert-red)" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="secondary" onClick={() => navigate("/dashboard")}>
              {t("action.cancel")}
            </Button>
            <Button type="button" loading={loading} onClick={handleSubmit}>
              {t("action.create")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
