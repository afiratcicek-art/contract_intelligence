import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import Button from "./Button";
import StatusChip from "./StatusChip";
import { useLanguage } from "../context/LanguageContext";
import { formatDateCompact } from "../utils/format";
import type { DisputeListRow } from "../services/api";

type Props = { projectId: string };

const LIST_LIMIT = 100;
const GRID = "var(--gutter-ref) 1fr 110px 90px var(--gutter-status)";

export default function DisputesModule({ projectId }: Props) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [rows, setRows] = useState<DisputeListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    let url = `/projects/${projectId}/disputes?limit=${LIST_LIMIT}`;
    if (status) url += `&status=${status}`;
    api.get<DisputeListRow[]>(url)
      .then(setRows)
      .catch(() => { setRows([]); setError(true); })
      .finally(() => setLoading(false));
  }, [projectId, status]);

  useEffect(() => { load(); }, [load]);

  const cardBg = "var(--color-bg-secondary)";
  const textPrimary = "var(--color-text-primary)";
  const textSecondary = "var(--color-text-secondary)";
  const border = "var(--color-border-light)";

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11,
        fontFamily: "var(--font-ui)",
        padding: "4px 10px",
        border: `0.5px solid ${active ? "var(--color-accent)" : border}`,
        background: active ? "var(--color-accent)" : "transparent",
        color: active ? "var(--color-bg-primary)" : textSecondary,
        cursor: "pointer",
        borderRadius: 0,
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-h1-module)", color: textPrimary, fontWeight: 500 }}>
          {t("module.disputes")}
        </div>
        <Button size="sm" type="button" onClick={() => navigate(`/projects/${projectId}/workspace/disputes/new`)}>
          {t("action.newdispute")}
        </Button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {chip(t("filter.all"), status === "", () => setStatus(""))}
        {["draft", "open", "prepared", "closed"].map((s) =>
          chip(t(`status.${s}`), status === s, () => setStatus(s))
        )}
      </div>
      {loading ? (
        <p style={{ fontSize: 12, color: textSecondary }}>{t("state.loading")}</p>
      ) : error ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--color-alert-red)" }}>{t("state.loadfailed")}</span>
          <Button size="sm" variant="secondary" onClick={load}>{t("action.retry")}</Button>
        </div>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 12, color: textSecondary, fontStyle: "italic" }}>{t("state.nodisputes")}</p>
      ) : (
        <div>
          {rows.length >= LIST_LIMIT && (
            <div style={{ fontSize: 11, fontFamily: "var(--font-meta)", color: "var(--color-warning)", padding: "6px 12px", background: "var(--color-warning-bg)", marginBottom: 2 }}>
              {t("state.truncated").replace("{n}", String(LIST_LIMIT))}
            </div>
          )}
          <div
            className="list-row"
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 8,
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: textSecondary,
              borderBottom: `0.5px solid ${border}`,
            }}
          >
            <span>{t("col.no")}</span>
            <span>{t("col.title")}</span>
            <span>{t("col.origin")}</span>
            <span>{t("col.date")}</span>
            <span>{t("col.status")}</span>
          </div>
          {rows.map((d) => (
            <div
              key={d.id}
              className="list-row"
              onClick={() => navigate(`/projects/${projectId}/workspace/disputes/${d.id}`)}
              style={{
                display: "grid",
                gridTemplateColumns: GRID,
                gap: 8,
                padding: "8px 12px",
                background: cardBg,
                marginBottom: 2,
                cursor: "pointer",
                borderLeft: `2px solid ${d.status === "open" ? "var(--color-accent)" : "transparent"}`,
              }}
            >
              <span className="ref-number">{d.dispute_number}</span>
              <p style={{ fontSize: 12, color: textPrimary, fontWeight: 500 }}>{d.title}</p>
              <span style={{ fontSize: 11, color: textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t(`dispute.origin.${d.origin}`)}
              </span>
              <span className="data-figure" style={{ color: textSecondary }}>{formatDateCompact(d.created_at)}</span>
              <StatusChip status={d.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
