import { lazy, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
const ActivityChart = lazy(() => import("../components/ActivityChart"));
import { useProjectDetail, useProjectTabs, useOverviewActivity, useUpcomingDeadlines, useOverdue } from "../hooks/useProjectDetail";
import { getAuth, clearAuth } from "../store/auth";
import { useState } from "react";
import ThemeToggle from "../components/ThemeToggle";
import { useLanguage } from "../context/LanguageContext";
import { useTheme } from "../context/ThemeContext";

type Tab = "correspondence" | "rfis" | "changes" | "deliverables" | "alerts";

const CONTRACT_LABEL: Record<string, string> = {
  lump_sum: "Lump Sum", remeasure: "Remeasure", cost_plus: "Cost Plus",
  target_cost: "Target Cost", epc: "EPC", epcm: "EPCM",
  framework: "Framework", other: "Other",
};

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
        style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-primary)" }}
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

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    open:      { bg: "var(--color-warning-bg)",   text: "var(--color-warning)" },
    pending:   { bg: "var(--color-warning-bg)",   text: "var(--color-warning)" },
    closed:    { bg: "var(--color-success-bg)",   text: "var(--color-success)" },
    active:    { bg: "var(--color-success-bg)",   text: "var(--color-success)" },
    approved:  { bg: "var(--color-success-bg)",   text: "var(--color-success)" },
    draft:     { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)" },
    overdue:   { bg: "var(--color-alert-red-bg)", text: "var(--color-alert-red)" },
    rejected:  { bg: "var(--color-alert-red-bg)", text: "var(--color-alert-red)" },
    submitted: { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)" },
  };
  const c = colors[status] ?? { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)" };
  return (
    <span
      className="text-xs px-2 py-0.5"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {status}
    </span>
  );
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
  const { lang, toggle: toggleLang, t } = useLanguage();
  const { data: activityData } = useOverviewActivity(String(projectId));
  const { items: deadlineItems } = useUpcomingDeadlines(String(projectId));
  const { items: overdueItems } = useOverdue(String(projectId));

  function handleLogout() {
    clearAuth();
    navigate("/login");
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "correspondence", label: "Correspondence", count: correspondences.length },
    { key: "rfis", label: "RFIs", count: rfis.length },
    { key: "changes", label: "Changes", count: changes.length },
    { key: "deliverables", label: "Deliverables", count: deliverables.length },
    { key: "alerts", label: "Alerts & Actions", count: alerts.filter(a => a.status === "pending").length },
  ];

  if (projLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--color-bg-primary)" }}>
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>Loading...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--color-bg-primary)" }}>
        <p className="text-sm" style={{ color: "var(--color-alert-red)" }}>{lang === "tr" ? "Proje bulunamadı." : "Project not found."}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-8 py-4 border-b"
        style={{ borderColor: "var(--color-border-light)", backgroundColor: "var(--color-bg-primary)" }}
      >
        <div className="flex items-center gap-3">
          <div style={{ width: "2px", height: "32px", background: "linear-gradient(to bottom, transparent 0%, var(--color-accent) 20%, var(--color-accent) 80%, transparent 100%)" }} />
          <button
            onClick={() => navigate("/dashboard")}
            className="text-sm transition-opacity hover:opacity-70"
            style={{ color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}
          >
            {t("nav.projects")}
          </button>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
          <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{project.name}</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: "1px solid var(--color-border-light)", cursor: "pointer", fontSize: 11, color: "var(--color-text-secondary)", padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 500, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
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
              className="text-3xl font-semibold leading-tight"
              style={{ fontFamily: "Playfair Display, Georgia, serif", color: "var(--color-text-primary)" }}
            >
              {project.name}
            </h1>
            <div className="flex flex-col items-end gap-2">
              <StatusPill status={project.status} />
              <button
                onClick={() => navigate(`/projects/${project.id}/workspace`)}
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "var(--color-bg-primary)",
                  border: "none",
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: 500,
                  letterSpacing: "0.5px",
                  cursor: "pointer",
                  borderRadius: 0,
                  fontFamily: "Inter, sans-serif",
                }}
              >
                {t("overview.openworkspace")}
              </button>
            </div>
          </div>

          <p className="text-sm mb-4" style={{ color: "var(--color-text-secondary)" }}>
            {project.employer_name}
            {project.engineer_name ? ` — ${project.engineer_name}` : ""}
            {" — "}{project.contractor_name}
          </p>

          <div className="flex gap-6 text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {project.contract_type && (
              <span>{CONTRACT_LABEL[project.contract_type] ?? project.contract_type}</span>
            )}
            {project.contract_value && (
              <span style={{ fontFamily: "JetBrains Mono, monospace" }}>
                {project.currency} {project.contract_value.toLocaleString()}
              </span>
            )}
            {project.start_date && (
              <span>{project.start_date} → {project.end_date ?? "—"}</span>
            )}
          </div>
        </div>

        {/* Metric cards */}
        <div className="flex gap-4 mb-8">
          <MetricCard value={openCorr} label={t("overview.opencorr").toUpperCase()} />
          <MetricCard value={overdueRFI} label={t("overview.overduerfis").toUpperCase()} />
          <MetricCard
            value={daysLeft !== null ? `${daysLeft}d` : "—"}
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
                <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Veri yükleniyor...</span>
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
                      <span className="text-xs font-mono" style={{ color: "var(--color-text-secondary)" }}>{item.ref}</span>
                      <p className="text-xs font-medium mt-0.5" style={{ color: "var(--color-text-primary)" }}>{item.subject}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>{item.label}</p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 ml-2 shrink-0" style={{ backgroundColor: badgeBg, color: badgeText }}>
                      {daysLeft === 0 ? t("overview.today") : daysLeft === 1 ? t("overview.tomorrow") : `${daysLeft}g`}
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
                        <span className="text-xs font-mono" style={{ color: "var(--color-text-secondary)" }}>{item.ref}</span>
                        <p className="text-xs font-medium mt-0.5" style={{ color: "var(--color-text-primary)" }}>{item.subject}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-alert-red)" }}>
                          {item.label} · {daysOver}g gecikmiş
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
                  fontFamily: "Inter, sans-serif",
                  borderBottom: activeTab === tab.key ? "2px solid var(--color-accent)" : "2px solid transparent",
                  backgroundColor: "transparent",
                  fontWeight: activeTab === tab.key ? 500 : 400,
                }}
              >
                {tab.label}
                <span
                  className="ml-2 text-xs px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: "var(--color-bg-secondary)", color: "var(--color-text-secondary)" }}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {tabLoading ? (
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>Loading...</p>
        ) : (
          <div>
            {/* Correspondence */}
            {activeTab === "correspondence" && (
              <div className="flex flex-col gap-2">
                {correspondences.length === 0 && (
                  <p className="text-sm py-8 text-center" style={{ color: "var(--color-text-secondary)" }}>No correspondence yet.</p>
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
                      <span
                        className="text-xs w-24 shrink-0"
                        style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-secondary)" }}
                      >
                        {c.corr_number}
                      </span>
                      <div>
                        <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>{c.subject}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                          {c.direction} · {c.type}
                          {c.response_due_date && ` · Due ${c.response_due_date}`}
                        </p>
                      </div>
                    </div>
                    <StatusPill status={c.status} />
                  </div>
                ))}
              </div>
            )}

            {/* RFIs */}
            {activeTab === "rfis" && (
              <div className="flex flex-col gap-2">
                {rfis.length === 0 && (
                  <p className="text-sm py-8 text-center" style={{ color: "var(--color-text-secondary)" }}>No RFIs yet.</p>
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
                      <span
                        className="text-xs w-24 shrink-0"
                        style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-secondary)" }}
                      >
                        {r.rfi_number}
                      </span>
                      <div>
                        <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>{r.subject}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                          {r.discipline ?? "General"}
                          {r.response_due_date && ` · Due ${r.response_due_date}`}
                        </p>
                      </div>
                    </div>
                    <StatusPill status={r.status} />
                  </div>
                ))}
              </div>
            )}

            {/* Changes */}
            {activeTab === "changes" && (
              <div className="flex flex-col gap-2">
                {changes.length === 0 && (
                  <p className="text-sm py-8 text-center" style={{ color: "var(--color-text-secondary)" }}>No changes yet.</p>
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
                      <span
                        className="text-xs w-24 shrink-0"
                        style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-secondary)" }}
                      >
                        {c.change_number}
                      </span>
                      <div>
                        <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>{c.title}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                          {c.origin}
                          {c.notice_due_date && ` · Notice due ${c.notice_due_date}`}
                        </p>
                      </div>
                    </div>
                    <StatusPill status={c.status} />
                  </div>
                ))}
              </div>
            )}

            {/* Deliverables */}
            {activeTab === "deliverables" && (
              <div className="flex flex-col gap-2">
                {deliverables.length === 0 && (
                  <p className="text-sm py-8 text-center" style={{ color: "var(--color-text-secondary)" }}>No deliverables yet.</p>
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
                        {d.is_pre_completion ? "Pre-completion" : "Post-completion"}
                        {d.due_date && ` · Due ${d.due_date}`}
                      </p>
                    </div>
                    <StatusPill status={d.status} />
                  </div>
                ))}
              </div>
            )}
            {/* Alerts & Actions */}
            {activeTab === "alerts" && (
              <div className="flex flex-col gap-2">
                {alerts.length === 0 && (
                  <p className="text-sm py-8 text-center" style={{ color: "var(--color-text-secondary)" }}>No pending alerts.</p>
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
                        className="text-xs w-24 shrink-0 uppercase"
                        style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--color-text-secondary)", letterSpacing: "0.05em" }}
                      >
                        {a.source_entity_type ?? "system"}
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
                          {a.alert_type.replace("_", " ")}
                          {a.notice_deadline && ` · Deadline: ${a.notice_deadline}`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(`/projects/${projectId}/workspace?module=alerts`)}
                      className="text-xs shrink-0 ml-2"
                      style={{ color: "var(--color-accent-text)", background: "none", border: "none", cursor: "pointer", fontWeight: 500, fontFamily: "Inter, sans-serif" }}
                    >
                      Review →
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
