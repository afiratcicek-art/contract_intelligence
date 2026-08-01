import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import type { ActivityPoint, PrePeriod } from "../hooks/useProjectDetail";

interface Props {
  data: ActivityPoint[];
  today: string;
  dark: boolean;
  prePeriod?: PrePeriod;
}

const SERIES = [
  { key: "correspondence", label: "Correspondence", fill: "var(--color-chart-correspondence)" },
  { key: "rfi", label: "RFI", fill: "var(--color-chart-rfi)" },
  { key: "change", label: "Change", fill: "var(--color-chart-change)" },
  { key: "deliverable", label: "Deliverable", fill: "var(--color-chart-deliverable)" },
] as const;

export default function ActivityChart({ data, today, dark: _dark, prePeriod }: Props) {
  const safePre = prePeriod ?? { correspondence: 0, rfi: 0, change: 0, deliverable: 0 };
  const hasPrePeriod = Object.values(safePre).some((v) => v > 0);

  const preBar: ActivityPoint = {
    date: "pre",
    correspondence: safePre.correspondence,
    rfi: safePre.rfi,
    change: safePre.change,
    deliverable: safePre.deliverable,
  };

  const chartData = hasPrePeriod ? [preBar, ...data] : data;

  const CustomXAxisTick = (props: { x?: number; y?: number; payload?: { value: string } }) => {
    const { x, y, payload } = props;
    if (!payload) return null;
    if (payload.value === "pre") {
      return (
        <g transform={`translate(${x},${y})`}>
          <text x={0} y={0} dy={12} textAnchor="middle" fill="var(--color-alert-red)" fontSize={11} fontFamily="var(--font-ui)">
            ≤-15g
          </text>
        </g>
      );
    }
    if (payload.value === today) {
      return (
        <g transform={`translate(${x},${y})`}>
          <text x={0} y={0} dy={12} textAnchor="middle" fill="var(--color-alert-red)" fontSize={11} fontFamily="var(--font-ui)">
            Bugün
          </text>
        </g>
      );
    }
    return null;
  };

  return (
    <>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={chartData} barSize={6} barGap={1} barCategoryGap={2}>
          <XAxis
            dataKey="date"
            tick={<CustomXAxisTick />}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-light)",
              borderRadius: 0,
              fontSize: 11,
              fontFamily: "var(--font-ui)",
            }}
            formatter={(value, name) => {
              const nameStr = String(name ?? "");
              return [value, nameStr.charAt(0).toUpperCase() + nameStr.slice(1)];
            }}
            labelFormatter={(label) => {
              if (label === "pre") return "Chart başlangıcından önce overdue";
              if (label === today) return "Bugün";
              return label;
            }}
          />
          {hasPrePeriod && (
            <ReferenceLine
              x="pre"
              stroke="var(--color-alert-red)"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
          )}
          <ReferenceLine
            x={today}
            stroke="var(--color-alert-red)"
            strokeWidth={1.5}
          />
          {SERIES.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="a"
              fill={s.fill}
              radius={i === SERIES.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-6 mt-2 flex-wrap items-center">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className="w-3 h-3" style={{ backgroundColor: s.fill }} />
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              {s.label}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <div style={{ width: 2, height: 12, backgroundColor: "var(--color-alert-red)" }} />
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Bugün</span>
        </div>
        {hasPrePeriod && (
          <div className="flex items-center gap-2">
            <div style={{ width: 12, height: 2, backgroundColor: "var(--color-alert-red)", borderTop: "1px dashed" }} />
            <span className="text-xs" style={{ color: "var(--color-alert-red)" }}>Chart öncesi overdue</span>
          </div>
        )}
      </div>
    </>
  );
}
