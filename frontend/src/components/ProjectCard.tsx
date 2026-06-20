import { useProjectHealth } from "../hooks/useProjects";
import type { Project } from "../hooks/useProjects";
import { useNavigate } from "react-router-dom";
import { useDarkMode } from "../hooks/useDarkMode";

interface Props {
  project: Project;
}

function HealthBadge({
  count,
  label,
  urgency,
}: {
  count: number;
  label: string;
  urgency: "red" | "amber" | "normal";
}) {
  const dark = useDarkMode();
  const colors = {
    red:    { bg: dark ? "#3D1A1A" : "#F5E6E4", text: dark ? "#E07060" : "#A93226" },
    amber:  { bg: dark ? "#3D2E0A" : "#FEF3C7", text: dark ? "#D4956A" : "#92400E" },
    normal: { bg: dark ? "#2E3340" : "#E7E3DC",  text: dark ? "#C4B49C" : "#44403C" },
  };
  const c = colors[urgency];
  return (
    <div
      className="flex flex-col items-center px-3 py-2 rounded"
      style={{ backgroundColor: c.bg }}
    >
      <span
        className="text-lg font-semibold"
        style={{ color: c.text, fontFamily: "JetBrains Mono, monospace" }}
      >
        {count}
      </span>
      <span className="text-xs mt-0.5" style={{ color: c.text }}>
        {label}
      </span>
    </div>
  );
}

export default function ProjectCard({ project }: Props) {
  const navigate = useNavigate();
  const health = useProjectHealth(project.id);
  const dark = useDarkMode();

  const contractTypeLabel: Record<string, string> = {
    lump_sum: "Lump Sum",
    remeasure: "Remeasure",
    cost_plus: "Cost Plus",
    target_cost: "Target Cost",
    epc: "EPC",
    epcm: "EPCM",
    framework: "Framework",
    other: "Other",
  };

  return (
    <div
      className="rounded-sm cursor-pointer"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(28, 25, 23, 0.08)";
        (e.currentTarget as HTMLElement).style.transition = "box-shadow 150ms ease-out";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
      style={{
        backgroundColor: dark ? "#2E3340" : "#E7E3DC",
        borderLeft: "3px solid #6B5D3F",
        padding: "1.25rem 1.5rem",
      }}
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      {/* Üst — proje adı ve status */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2
            className="text-base font-semibold leading-snug"
            style={{
              fontFamily: "Playfair Display, Georgia, serif",
              color: dark ? "#E8E6E0" : "#1C1917",
            }}
          >
            {project.name}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: dark ? "#C4B49C" : "#44403C" }}>
            {project.employer_name} — {project.contractor_name}
          </p>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full ml-4 shrink-0"
          style={{
            backgroundColor:
              project.status === "active"
                ? (dark ? "#2E3340" : "#E7E3DC")
                : (dark ? "#3D1A1A" : "#F5E6E4"),
            color: project.status === "active"
              ? (dark ? "#4DB88A" : "#1F6B4E")
              : (dark ? "#E07060" : "#A93226"),
          }}
        >
          {project.status}
        </span>
      </div>

      {/* Orta — contract info */}
      <div className="flex gap-4 mb-4">
        {project.contract_type && (
          <span className="text-xs" style={{ color: dark ? "#C4B49C" : "#44403C" }}>
            {contractTypeLabel[project.contract_type] ?? project.contract_type}
          </span>
        )}
        {project.contract_value && (
          <span
            className="text-xs"
            style={{
              color: dark ? "#C4B49C" : "#44403C",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            {project.currency}{" "}
            {project.contract_value.toLocaleString()}
          </span>
        )}
      </div>

      {/* Alt — health indicators */}
      {health.loading ? (
        <div className="text-xs" style={{ color: dark ? "#C4B49C" : "#44403C" }}>
          Loading...
        </div>
      ) : (
        <div className="flex gap-2">
          <HealthBadge
            count={health.open_correspondences}
            label="Open Letters"
            urgency={health.open_correspondences > 0 ? "amber" : "normal"}
          />
          <HealthBadge
            count={health.overdue_rfis}
            label="Overdue RFIs"
            urgency={health.overdue_rfis > 0 ? "red" : "normal"}
          />
          <HealthBadge
            count={health.upcoming_deadlines}
            label="Due in 7d"
            urgency={health.upcoming_deadlines > 0 ? "amber" : "normal"}
          />
        </div>
      )}
    </div>
  );
}
