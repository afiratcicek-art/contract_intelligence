import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import LanguageToggle from "../components/LanguageToggle";
import Button from "../components/Button";
import { getAuth } from "../store/auth";
import { useLanguage } from "../context/LanguageContext";
import { useUnsavedGuard } from "../hooks/useUnsavedGuard";
import { createDispute, type DisputeOrigin } from "../services/api";

const ORIGINS: DisputeOrigin[] = ["change", "correspondence", "mixed", "manual"];

export default function NewDispute() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t } = useLanguage();
  const auth = getAuth();

  const changeId = params.get("changeId") || "";
  const correspondenceId = params.get("correspondenceId") || "";

  const prefilledOrigin: DisputeOrigin = useMemo(() => {
    if (changeId && correspondenceId) return "mixed";
    if (changeId) return "change";
    if (correspondenceId) return "correspondence";
    return "manual";
  }, [changeId, correspondenceId]);

  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [origin, setOrigin] = useState(prefilledOrigin);
  const [summary, setSummary] = useState("");
  useUnsavedGuard(dirty && !loading);

  const bg = "var(--color-bg-primary)";
  const cardBg = "var(--color-bg-secondary)";
  const border = "var(--color-border-light)";
  const textPrimary = "var(--color-text-primary)";
  const textSecond = "var(--color-text-secondary)";

  const inputStyle = {
    width: "100%",
    backgroundColor: cardBg,
    border: `1px solid ${border}`,
    color: textPrimary,
    fontSize: 13,
    fontFamily: "var(--font-ui)",
    padding: "10px 12px",
    borderRadius: 0,
    outline: "none",
  } as const;

  const labelStyle = {
    fontSize: 11,
    fontWeight: 500 as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: textSecond,
    display: "block",
    marginBottom: 6,
  };

  const handleSubmit = async () => {
    if (!projectId) return;
    if (!title.trim()) {
      setError(t("dispute.err.title"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const created = await createDispute(projectId, {
        title: title.trim(),
        origin,
        summary: summary.trim() || undefined,
        source_change_id: changeId || undefined,
        source_correspondence_id: correspondenceId || undefined,
      });
      setDirty(false);
      navigate(`/projects/${projectId}/workspace/disputes/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("dispute.err.save"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }} onChangeCapture={() => setDirty(true)}>
      <nav className="app-chrome-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecond }}>
          <div className="gold-line gold-line-compact" />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=disputes`)}>{t("module.disputes")}</span>
          <span>/</span>
          <span style={{ color: textPrimary, fontWeight: 500 }}>{t("dispute.new")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: textSecond }}>{auth?.full_name}</span>
          <LanguageToggle />
        </div>
      </nav>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
        <p style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-h1)", color: textPrimary, fontWeight: 500, marginBottom: 8 }}>
          {t("dispute.new")}
        </p>
        <p style={{ fontSize: 13, color: textSecond, marginBottom: 28 }}>{t("dispute.newhint")}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>{t("dispute.field.title")}</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>{t("col.origin")}</label>
            <select style={inputStyle} value={origin} onChange={(e) => setOrigin(e.target.value as DisputeOrigin)}>
              {ORIGINS.map((o) => (
                <option key={o} value={o}>{t(`dispute.origin.${o}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("dispute.field.summary")}</label>
            <textarea style={{ ...inputStyle, minHeight: 96 }} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          {error && <p style={{ fontSize: 12, color: "var(--color-alert-red)" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="secondary" onClick={() => navigate(`/projects/${projectId}/workspace?module=disputes`)}>
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
