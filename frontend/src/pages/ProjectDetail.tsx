import { lazy, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
const ActivityChart = lazy(() => import("../components/ActivityChart"));
import { useProjectDetail, useProjectTabs, useOverviewActivity, useUpcomingDeadlines, useOverdue } from "../hooks/useProjectDetail";
import { getAuth, clearAuth } from "../store/auth";
import { useState } from "react";
import ThemeToggle from "../components/ThemeToggle";
import LanguageToggle from "../components/LanguageToggle";
import Button from "../components/Button";
import StatusChip from "../components/StatusChip";
import { useLanguage } from "../context/LanguageContext";
import { formatDateCompact, formatMoney } from "../utils/format";
import { useTheme } from "../context/ThemeContext";

type Tab = "correspondence" | "rfis" | "changes" | "deliverables" | "alerts";

function MetricCard({ value, label }: { value: string | number; label: string }) {
  return (
    <div
      className="flex-1 px-6 py-5"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderTop: "2px solid var(--color-accent)",
      }}
    >
      <div
        className="text-3xl mb-1"
        style={{ fontFamily: "var(--font-meta)", color: "var(--color-text-primary)" }}
      >
        {value}
      </div>
      <div className="text-xs uppercase tracking-widest" style={{ color: "var(--color-text-secondary)" }}>
        {label}
      </div>
    </div>
  );
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const auth = getAuth();
  const [activeTab, setActiveTab] = useState<Tab>("correspondence");

  const { project, loading: projLoading } = useProjectDetail(projectId!);
  const { correspondences, rfis, changes, deliverables, alerts, loading: tabLoading } =
    useProjectTabs(projectId!);

  const openCorr = correspondences.filter((c) => c.status === "open").length;
  const overdueRFI = rfis.filter((r) => r.status === "overdue").length;
  const daysLeft = project?.end_date ? daysUntil(project.end_date) : null;
  const { dark: chartDark } = useTheme();
  const { lang, t } = useLanguage();
  // The deadline/overdue endpoints ship a short English code ("CORR", "DEL")
  // alongside the machine type. Name the record from the type and keep the
  // server code only as a fallback for types the client does not know yet.
  const itemTypeLabel = (type: string, fallback: string) => {
    const key = `entity.${type}`;
    const translated = t(key);
    return translated === key ? fallback : translated;
  };
  // Alert types are an open enum on the server; unmapped ones degrade to
  // spaced text rather than showing a raw snake_case key.
  const alertTypeLabel = (type: string) => {
    const key = `alerts.type.${type}`;
    const translated = t(key);
    return translated === key ? type.replace(/_/g, " ") : translated;
  };
  const { data: activityData } = useOverviewActivity(String(projectId));
  const { items: deadlineItems } = useUpcomingDeadlines(String(projectId));
  const { items: overdueItems } = useOverdue(String(projectId));

  function handleLogout() {
    clearAuth();
    navigate("/login");
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "correspondence", label: t("module.correspondence"), count: correspondences.length },
    { key: "rfis", label: t("module.rfis"), count: rfis.length },
    { key: "changes", label: t("module.changes"), count: changes.length },
    { key: "deliverables", label: t("module.deliverables"), count: deliverables.length },
    { key: "alerts", label: t("overview.tab.alerts"), count: alerts.filter(a => a.status === "pending").length },
  ];

  if (projLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--color-bg-primary)" }}>
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{t("state.loading")}</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--color-bg-primary)" }}>
        <p className="text-sm" style={{ color: "var(--color-alert-red)" }}>{t("project.notfound")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      {/* Nav */}
      <nav
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-8 py-4 border-b"
        style={{ borderColor: "var(--color-border-light)", backgroundColor: "var(--color-bg-primary)" }}
      >
        <div className="flex items-center gap-3">
          <div className="gold-line gold-line-nav" />
          <button
            onClick={() => navigate("/dashboard")}
            className="text-sm transition-opacity hover:opacity-70"
            style={{ color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}
          >
            {t("nav.projects")}
          </button>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
          <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{project.name}</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{auth?.full_name}</span>
          <LanguageToggle />
          <ThemeToggle />
          <button onClick={handleLogout} className="text-sm transition-opacity hover:opacity-70" style={{ color: "var(--color-text-secondary)" }}>
            {t("nav.signout")}
          </button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-8 py-10">
        {/* Project header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-2">
            <h1
              className="font-semibold leading-tight"
              style={{
                fontFamily: "var(--font-brand)",
                fontSize: "var(--type-h1)",
                color: "var(--color-text-primary)",
              }}
            >
              {project.name}
            </h1>
            <div className="flex flex-col items-end gap-2">
              <StatusChip status={project.status} />
              <Button size="sm" onClick={() => navigate(`/projects/${project.id}/workspace`)}>
                {t("overview.openworkspace")}
              </Button>
            </div>
          </div>

          <p className="text-sm mb-4" style={{ color: "var(--color-text-secondary)" }}>
            {project.employer_name}
            {project.engineer_name ? ` — ${project.engineer_name}` : ""}
            {" — "}{project.contractor_name}
          </p>

          <div className="flex gap-6 text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {project.contract_type && (
              <span>{t(`contract.type.${project.contract_type}`)}</span>
            )}
            {project.contract_value && (
              <span className="data-figure">
                {formatMoney(project.contract_value, project.currency, lang)}
              </span>
            )}
            {project.start_date && (
              <span className="data-figure">
                {formatDateCompact(project.start_date)} → {formatDateCompact(project.end_date)}
              </span>
            )}
          </div>
        </div>

        {/* Metric cards */}
        <div className="flex gap-4 mb-8">
          <MetricCard value={openCorr} label={t("overview.opencorr").toUpperCase()} />
          <MetricCard value={overdueRFI} label={t("overview.overduerfis").toUpperCase()} />
          <MetricCard
            value={daysLeft !== null ? t("unit.days").replace("{n}", String(daysLeft)) : "—"}
            label={t("overview.daystocompletion").toUpperCase()}
          />
        </div>

        {/* Activity chart ±15 gün */}
        <div
          className="mb-8 p-6"
          style={{ backgroundColor: "var(--color-bg-secondary)" }}
        >
          <p
            className="text-xs uppercase tracking-widest mb-4"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {t("overview.activitychart")}
          </p>
          <Suspense fallback={<div style={{ height: 140 }} />}>
            {activityData ? (
              <ActivityChart data={activityData.days} today={activityData.today} dark={chartDark} prePeriod={activityData.pre_period ?? { correspondence: 0, rfi: 0, change: 0, deliverable: 0 }} />
            ) : (
              <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>{t("state.loading")}</span>
              </div>
            )}
          </Suspense>
        </div>

        {/* Deadline + Overdue widgets */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {/* Önümüzdeki 15 gün */}
          <div className="p-4" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--color-text-secondary)" }}>
              {t("overview.upcoming")}
            </p>
            {deadlineItems.length === 0 ? (
              <p className="text-xs italic" style={{ color: "var(--color-text-secondary)" }}>
                {t("overview.noaction")}
              </p>
            ) : (
              deadlineItems.slice(0, 5).map((item) => {
                const daysLeft = item.due_date
                  ? Math.ceil((new Date(item.due_date).getTime() - Date.now()) / 86400000)
                  : null;
                const badgeBg = daysLeft === 0
                  ? "var(--color-alert-red-bg)"
                  : daysLeft !== null && daysLeft <= 3
                  ? "var(--color-warning-bg)"
                  : "var(--color-bg-secondary)";
                const badgeText = daysLeft === 0
                  ? "var(--color-alert-red)"
                  : daysLeft !== null && daysLeft <= 3
                  ? "var(--color-warning)"
                  : "var(--color-text-secondary)";
                return (
                  <div key={item.id} className="flex items-center justify-between py-2 border-b" style={{ borderColor: "var(--color-border-light)" }}>
                    <div>
                      <span className="ref-number">{item.ref}</span>
                      <p className="text-xs font-medium mt-0.5" style={{ color: "var(--color-text-primary)" }}>{item.subject}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>{itemTypeLabel(item.type, item.label)}</p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 ml-2 shrink-0" style={{ backgroundColor: badgeBg, color: badgeText }}>
                      {daysLeft === 0 ? t("overview.today") : daysLeft === 1 ? t("overview.tomorrow") : t("unit.days").replace("{n}", String(daysLeft))}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Kritik uyarılar */}
          <div className="p-4" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--color-text-secondary)" }}>
              {t("overview.overdue")}
            </p>
            {overdueItems.length === 0 ? (
              <p className="text-xs italic" style={{ color: "var(--color-text-secondary)" }}>
                {t("overview.nooverdue")}
              </p>
            ) : (
              overdueItems.slice(0, 5).map((item) => {
                const daysOver = item.due_date
                  ? Math.ceil((Date.now() - new Date(item.due_date).getTime()) / 86400000)
                  : null;
                return (
                  <div key={item.id} className="flex items-center justify-between py-2 border-b" style={{ borderColor: "var(--color-border-light)" }}>
                    <div className="flex items-center gap-2">
                      <div style={{ width: 2, height: 32, backgroundColor: "var(--color-alert-red)", flexShrink: 0 }} />
                      <div>
                        <span className="ref-number">{item.ref}</span>
                        <p className="text-xs font-medium mt-0.5" style={{ color: "var(--color-text-primary)" }}>{item.subject}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-alert-red)" }}>
                          {itemTypeLabel(item.type, item.label)} · {t("overview.daysoverdue").replace("{n}", String(daysOver ?? 0))}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(`/projects/${projectId}/workspace`)}
                      className="text-xs shrink-0 ml-2"
                      style={{ color: "var(--color-accent-text)", background: "none", border: "none", cursor: "pointer", fontWeight: 500 }}
                    >
                      {t("overview.workspace")}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b mb-6" style={{ borderColor: "var(--color-border-light)" }}>
          <div className="flex gap-0">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="px-4 py-2 text-sm transition-colors relative"
                style={{
                  color: activeTab === tab.key ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  fontFamily: "var(--font-ui)",
                  borderBottom: activeTab === tab.key ? "3px solid var(--color-accent)" : "3px solid transparent",
                  backgroundColor: "transparent",
                  fontWeight: activeTab === tab.key ? 600 : 400,
                }}
              >
                {tab.label}
                <span
                  className="ml-2 px-1.5 py-0.5"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    color: "var(--color-text-secondary)",
                    fontSize: 11,
                    fontFamily: "var(--font-meta)",
                    borderRadius: 0,
                  }}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {tabLoading ? (
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{t("state.loading")}</p>
        ) : (
          <div>
            {/* Correspondence */}
            {activeTab === "correspondence" && (
              <div className="flex flex-col gap-2">
                {correspondences.length === 0 && (
                  <p className="text-sm py-8 text-center" style={{ color: "var(--color-text-secondary)" }}>{t("overview.nocorrespondence")}</p>
                )}
                {correspondences.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between px-4 py-4 cursor-pointer transition-colors"
                    style={{ backgroundColor: "var(--color-bg-secondary)" }}
                    onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${c.id}`)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)")}
                  >
                    <div className="flex items-center gap-4">
                      <span className="ref-number shrink-0" style={{ width: "var(--gutter-ref)" }}>
                        {c.corr_number}
                      </span>
                      <div>
                        <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>{c.subject}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                          {c.direction === "incoming" ? t("filter.incoming") : c.direction === "outgoing" ? t("filter.outgoing") : c.direction} · {c.type?.replace(/_/g, " ")}
                          {c.response_due_date && ` · ${t("col.due")} ${formatDateCompact(c.response_due_date)}`}
                        </p>
                      </div>
                    </div>
                    <StatusChip status={c.status} />
                  </div>
                ))}
              </div>
            )}

            {/* RFIs */}
            {activeTab === "rfis" && (
              <div className="flex flex-col gap-2">
                {rfis.length === 0 && (
                  <p className="text-sm py-8 text-center" style={{ color: "var(--color-text-secondary)" }}>{t("overview.norfis")}</p>
                )}
                {rfis.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between px-4 py-4 cursor-pointer transition-colors"
                    style={{ backgroundColor: "var(--color-bg-secondary)" }}
                    onClick={() => navigate(`/projects/${projectId}/workspace/rfis/${r.id}`)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)")}
                  >
                    <div className="flex items-center gap-4">
                      <span className="ref-number shrink-0" style={{ width: "var(--gutter-ref)" }}>
                        {r.rfi_number}
                      </span>
                      <div>
                        <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>{r.subject}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                          {r.discipline ?? "—"}
                          {r.response_due_date && ` · ${t("col.due")} ${formatDateCompact(r.response_due_date)}`}
                        </p>
                      </div>
                    </div>
                    <StatusChip status={r.status} />
                  </div>
                ))}
              </div>
            )}

            {/* Changes */}
            {activeTab === "changes" && (
              <div className="flex flex-col gap-2">
                {changes.length === 0 && (
                  <p className="text-sm py-8 text-center" style={{ color: "var(--color-text-secondary)" }}>{t("overview.nochanges")}</p>
                )}
                {changes.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between px-4 py-4 cursor-pointer transition-colors"
                    style={{ backgroundColor: "var(--color-bg-secondary)" }}
                    onClick={() => navigate(`/projects/${projectId}/workspace/changes/${c.id}`)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)")}
                  >
                    <div className="flex items-center gap-4">
                      <span className="ref-number shrink-0" style={{ width: "var(--gutter-ref)" }}>
                        {c.change_number}
                      </span>
                      <div>
                        <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>{c.title}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                          {c.origin}
                          {c.notice_due_date && ` · ${t("col.noticedue")} ${formatDateCompact(c.notice_due_date)}`}
                        </p>
                      </div>
                    </div>
                    <StatusChip status={c.status} />
                  </div>
                ))}
              </div>
            )}

            {/* Deliverables */}
            {activeTab === "deliverables" && (
              <div className="flex flex-col gap-2">
                {deliverables.length === 0 && (
                  <p className="text-sm py-8 text-center" style={{ color: "var(--color-text-secondary)" }}>{t("overview.nodeliverables")}</p>
                )}
                {deliverables.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between px-4 py-4 cursor-pointer transition-colors"
                    style={{ backgroundColor: "var(--color-bg-secondary)" }}
                    onClick={() => navigate(`/projects/${projectId}/workspace/deliverables/${d.id}`)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)")}
                  >
                    <div>
                      <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>{d.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                        {(d.category ?? "—").replace("_", " ")}
                        {d.kind ? ` · ${d.kind}` : ""}
                        {d.pending_detail ? ` · ${t("state.pendingdetail")}` : ""}
                        {d.due_date && ` · ${t("col.due")} ${formatDateCompact(d.due_date)}`}
                        {d.time_status === "overdue" ? ` · ${t("status.overdue")}` : d.time_status === "expiring_soon" ? ` · ${t("status.expiring_soon")}` : ""}
                      </p>
                    </div>
                    <StatusChip status={d.status} />
                  </div>
                ))}
              </div>
            )}
            {/* Alerts & Actions */}
            {activeTab === "alerts" && (
              <div className="flex flex-col gap-2">
                {alerts.length === 0 && (
                  <p className="text-sm py-8 text-center" style={{ color: "var(--color-text-secondary)" }}>{t("overview.noalerts")}</p>
                )}
                {alerts.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between px-4 py-4 cursor-pointer transition-colors"
                    style={{
                      backgroundColor: "var(--color-bg-secondary)",
                      borderLeft: a.priority === "critical"
                        ? "3px solid var(--color-alert-red)"
                        : a.priority === "high"
                        ? "3px solid var(--color-warning)"
                        : "3px solid var(--color-accent)",
                    }}
                    onClick={() => navigate(`/projects/${projectId}/workspace?module=alerts`)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)")}
                  >
                    <div className="flex items-center gap-4">
                      <span
                        className="text-xs shrink-0"
                        style={{ width: "var(--gutter-ref)", fontFamily: "var(--font-ui)", color: "var(--color-text-secondary)" }}
                      >
                        {itemTypeLabel(a.source_entity_type ?? "system", a.source_entity_type ?? "system")}
                      </span>
                      <div>
                        <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>
                          {a.narrative
                            ? a.narrative.length > 80
                              ? a.narrative.slice(0, 80) + "…"
                              : a.narrative
                            : "—"}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                          {alertTypeLabel(a.alert_type)}
                          {a.notice_deadline && ` · ${t("col.duedate")}: ${formatDateCompact(a.notice_deadline)}`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(`/projects/${projectId}/workspace?module=alerts`)}
                      className="text-xs shrink-0 ml-2"
                      style={{ color: "var(--color-accent-text)", background: "none", border: "none", cursor: "pointer", fontWeight: 500, fontFamily: "var(--font-ui)" }}
                    >
                      {t("overview.review")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
