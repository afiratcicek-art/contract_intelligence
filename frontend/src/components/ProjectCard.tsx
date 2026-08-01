import { useProjectHealth } from "../hooks/useProjects";
import type { Project } from "../hooks/useProjects";
import { useNavigate } from "react-router-dom";
import StatusChip from "./StatusChip";

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
  const colors = {
    red:    { bg: "var(--color-alert-red-bg)",  text: "var(--color-alert-red)" },
    amber:  { bg: "var(--color-warning-bg)",    text: "var(--color-warning)" },
    normal: { bg: "var(--color-bg-secondary)",  text: "var(--color-text-secondary)" },
  };
  const c = colors[urgency];
  return (
    <div
      className="flex flex-col items-center px-3 py-2"
      style={{ backgroundColor: c.bg }}
    >
      <span
        className="text-lg"
        style={{ color: c.text, fontFamily: "var(--font-meta)", fontWeight: 500 }}
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
      className="rounded-none cursor-pointer"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px var(--color-shadow)";
        (e.currentTarget as HTMLElement).style.transition = "box-shadow 150ms ease-out";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderLeft: "3px solid var(--color-accent)",
        padding: "1.25rem 1.5rem",
      }}
      onClick={() => navigate(`/projects/${project.id}`)}
    >
      {/* Üst — proje adı ve status */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2
            className="font-semibold leading-snug"
            style={{
              fontFamily: "var(--font-brand)",
              fontSize: "var(--type-title-card)",
              color: "var(--color-text-primary)",
            }}
          >
            {project.name}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
            {project.employer_name} — {project.contractor_name}
          </p>
        </div>
        <StatusChip status={project.status} className="ml-4" />
      </div>

      {/* Orta — contract info */}
      <div className="flex gap-4 mb-4">
        {project.contract_type && (
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {contractTypeLabel[project.contract_type] ?? project.contract_type}
          </span>
        )}
        {project.contract_value && (
          <span
            className="text-xs"
            style={{
              color: "var(--color-text-secondary)",
              fontFamily: "var(--font-meta)",
            }}
          >
            {project.currency}{" "}
            {project.contract_value.toLocaleString()}
          </span>
        )}
      </div>

      {/* Alt — health indicators */}
      {health.loading ? (
        <div className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
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
