import { useParams, useNavigate } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useProjectDetail, useProjectTabs } from "../hooks/useProjectDetail";
import { getAuth, clearAuth } from "../store/auth";
import { useState } from "react";

type Tab = "correspondence" | "rfis" | "changes" | "deliverables";

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
        backgroundColor: "#E7E3DC",
        borderTop: "2px solid #A8936A",
      }}
    >
      <div
        className="text-3xl font-semibold mb-1"
        style={{ fontFamily: "JetBrains Mono, monospace", color: "#1C1917" }}
      >
        {value}
      </div>
      <div className="text-xs uppercase tracking-widest" style={{ color: "#44403C" }}>
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
    open:       { bg: "#FEF3C7", text: "#92400E" },
    closed:     { bg: "#D1FAE5", text: "#065F46" },
    draft:      { bg: "#E7E3DC", text: "#44403C" },
    overdue:    { bg: "#FEE2E2", text: "#DC2626" },
    active:     { bg: "#D1FAE5", text: "#065F46" },
    approved:   { bg: "#D1FAE5", text: "#065F46" },
    rejected:   { bg: "#FEE2E2", text: "#DC2626" },
    pending:    { bg: "#FEF3C7", text: "#92400E" },
    submitted:  { bg: "#EDE9FE", text: "#4C1D95" },
  };
  const c = colors[status] ?? { bg: "#E7E3DC", text: "#44403C" };
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full"
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
  const { correspondences, rfis, changes, deliverables, trend, loading: tabLoading } =
    useProjectTabs(projectId!);

  const openCorr = correspondences.filter((c) => c.status === "open" || c.status === "draft").length;
  const overdueRFI = rfis.filter((r) => r.status === "overdue").length;
  const daysLeft = project?.end_date ? daysUntil(project.end_date) : null;

  function handleLogout() {
    clearAuth();
    navigate("/login");
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "correspondence", label: "Correspondence", count: correspondences.length },
    { key: "rfis", label: "RFIs", count: rfis.length },
    { key: "changes", label: "Changes", count: changes.length },
    { key: "deliverables", label: "Deliverables", count: deliverables.length },
  ];

  if (projLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F5F2ED" }}>
        <p className="text-sm" style={{ color: "#44403C" }}>Loading...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F5F2ED" }}>
        <p className="text-sm" style={{ color: "#DC2626" }}>Project not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F5F2ED" }}>
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-8 py-4 border-b"
        style={{ borderColor: "#E7E3DC", backgroundColor: "#F5F2ED" }}
      >
        <div className="flex items-center gap-3">
          <div style={{ width: "2px", height: "32px", background: "linear-gradient(to bottom, transparent 0%, #A8936A 20%, #A8936A 80%, transparent 100%)" }} />
          <button
            onClick={() => navigate("/dashboard")}
            className="text-sm transition-opacity hover:opacity-70"
            style={{ color: "#44403C", fontFamily: "Inter, sans-serif" }}
          >
            Projects
          </button>
          <span style={{ color: "#A8936A" }}>/</span>
          <span className="text-sm" style={{ color: "#1C1917" }}>{project.name}</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-sm" style={{ color: "#44403C" }}>{auth?.full_name}</span>
          <button onClick={handleLogout} className="text-sm transition-opacity hover:opacity-70" style={{ color: "#A8936A" }}>
            Sign out
          </button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-8 py-10">
        {/* Project header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-2">
            <h1
              className="text-3xl font-semibold leading-tight"
              style={{ fontFamily: "Playfair Display, Georgia, serif", color: "#1C1917" }}
            >
              {project.name}
            </h1>
            <StatusPill status={project.status} />
          </div>

          <p className="text-sm mb-4" style={{ color: "#44403C" }}>
            {project.employer_name}
            {project.engineer_name ? ` — ${project.engineer_name}` : ""}
            {" — "}{project.contractor_name}
          </p>

          <div className="flex gap-6 text-xs" style={{ color: "#44403C" }}>
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
          <MetricCard value={openCorr} label="Open Correspondence" />
          <MetricCard value={overdueRFI} label="Overdue RFIs" />
          <MetricCard
            value={daysLeft !== null ? `${daysLeft}d` : "—"}
            label="Days to Completion"
          />
        </div>

        {/* Trend chart */}
        <div
          className="mb-8 p-6"
          style={{ backgroundColor: "#E7E3DC" }}
        >
          <p
            className="text-xs uppercase tracking-widest mb-4"
            style={{ color: "#A8936A" }}
          >
            Correspondence — Last 30 Days
          </p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={trend} barSize={8} barGap={2}>
              <XAxis
                dataKey="date"
                tick={false}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#F5F2ED",
                  border: "1px solid #E7E3DC",
                  borderRadius: 0,
                  fontSize: 12,
                  fontFamily: "Inter, sans-serif",
                }}
                labelFormatter={(v) => v}
              />
              <Bar dataKey="outgoing" name="Outgoing" fill="#A8936A" radius={[2, 2, 0, 0]} />
              <Bar dataKey="incoming" name="Incoming" fill="#44403C" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-6 mt-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#A8936A" }} />
              <span className="text-xs" style={{ color: "#44403C" }}>Outgoing</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#44403C" }} />
              <span className="text-xs" style={{ color: "#44403C" }}>Incoming</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b mb-6" style={{ borderColor: "#E7E3DC" }}>
          <div className="flex gap-0">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="px-5 py-3 text-sm transition-colors relative"
                style={{
                  color: activeTab === tab.key ? "#1C1917" : "#44403C",
                  fontFamily: "Inter, sans-serif",
                  borderBottom: activeTab === tab.key ? "2px solid #A8936A" : "2px solid transparent",
                  backgroundColor: "transparent",
                  fontWeight: activeTab === tab.key ? 500 : 400,
                }}
              >
                {tab.label}
                <span
                  className="ml-2 text-xs px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: "#E7E3DC", color: "#44403C" }}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {tabLoading ? (
          <p className="text-sm" style={{ color: "#44403C" }}>Loading...</p>
        ) : (
          <div>
            {/* Correspondence */}
            {activeTab === "correspondence" && (
              <div className="flex flex-col gap-2">
                {correspondences.length === 0 && (
                  <p className="text-sm py-8 text-center" style={{ color: "#44403C" }}>No correspondence yet.</p>
                )}
                {correspondences.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between px-5 py-4 cursor-pointer transition-colors"
                    style={{ backgroundColor: "#E7E3DC" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#DDD9D1")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#E7E3DC")}
                  >
                    <div className="flex items-center gap-4">
                      <span
                        className="text-xs w-24 shrink-0"
                        style={{ fontFamily: "JetBrains Mono, monospace", color: "#A8936A" }}
                      >
                        {c.corr_number}
                      </span>
                      <div>
                        <p className="text-sm" style={{ color: "#1C1917" }}>{c.subject}</p>
                        <p className="text-xs mt-0.5" style={{ color: "#44403C" }}>
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
                  <p className="text-sm py-8 text-center" style={{ color: "#44403C" }}>No RFIs yet.</p>
                )}
                {rfis.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between px-5 py-4 cursor-pointer transition-colors"
                    style={{ backgroundColor: "#E7E3DC" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#DDD9D1")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#E7E3DC")}
                  >
                    <div className="flex items-center gap-4">
                      <span
                        className="text-xs w-24 shrink-0"
                        style={{ fontFamily: "JetBrains Mono, monospace", color: "#A8936A" }}
                      >
                        {r.rfi_number}
                      </span>
                      <div>
                        <p className="text-sm" style={{ color: "#1C1917" }}>{r.subject}</p>
                        <p className="text-xs mt-0.5" style={{ color: "#44403C" }}>
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
                  <p className="text-sm py-8 text-center" style={{ color: "#44403C" }}>No changes yet.</p>
                )}
                {changes.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between px-5 py-4 cursor-pointer transition-colors"
                    style={{ backgroundColor: "#E7E3DC" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#DDD9D1")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#E7E3DC")}
                  >
                    <div className="flex items-center gap-4">
                      <span
                        className="text-xs w-24 shrink-0"
                        style={{ fontFamily: "JetBrains Mono, monospace", color: "#A8936A" }}
                      >
                        {c.change_number}
                      </span>
                      <div>
                        <p className="text-sm" style={{ color: "#1C1917" }}>{c.title}</p>
                        <p className="text-xs mt-0.5" style={{ color: "#44403C" }}>
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
                  <p className="text-sm py-8 text-center" style={{ color: "#44403C" }}>No deliverables yet.</p>
                )}
                {deliverables.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between px-5 py-4 cursor-pointer transition-colors"
                    style={{ backgroundColor: "#E7E3DC" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#DDD9D1")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#E7E3DC")}
                  >
                    <div>
                      <p className="text-sm" style={{ color: "#1C1917" }}>{d.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: "#44403C" }}>
                        {d.is_pre_completion ? "Pre-completion" : "Post-completion"}
                        {d.due_date && ` · Due ${d.due_date}`}
                      </p>
                    </div>
                    <StatusPill status={d.status} />
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
