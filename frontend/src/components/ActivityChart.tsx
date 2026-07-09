import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import type { ActivityPoint, PrePeriod } from "../hooks/useProjectDetail";

interface Props {
  data: ActivityPoint[];
  today: string;
  dark: boolean;
  prePeriod?: PrePeriod;
}

const COLORS = {
  correspondence: "#6B5D3F",
  rfi:            "#A0714A",
  change:         "#C4B49C",
  deliverable:    "#44403C",
};

const COLORS_DARK = {
  correspondence: "#C4AD87",
  rfi:            "#A0714A",
  change:         "#8B9AAF",
  deliverable:    "#C4B49C",
};

export default function ActivityChart({ data, today, dark, prePeriod }: Props) {
  const c = dark ? COLORS_DARK : COLORS;

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
          <text x={0} y={0} dy={12} textAnchor="middle" fill={dark ? "#E07060" : "#A93226"} fontSize={11} fontFamily="Inter">
            ≤-15g
          </text>
        </g>
      );
    }
    if (payload.value === today) {
      return (
        <g transform={`translate(${x},${y})`}>
          <text x={0} y={0} dy={12} textAnchor="middle" fill={dark ? "#E07060" : "#A93226"} fontSize={11} fontFamily="Inter">
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
              fontFamily: "Inter, sans-serif",
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
              stroke={dark ? "#E07060" : "#A93226"}
              strokeDasharray="3 3"
              strokeWidth={1}
            />
          )}
          <ReferenceLine
            x={today}
            stroke={dark ? "#E07060" : "#A93226"}
            strokeWidth={1.5}
          />
          <Bar dataKey="correspondence" name="Correspondence" stackId="a" fill={c.correspondence} radius={[0,0,0,0]} />
          <Bar dataKey="rfi" name="RFI" stackId="a" fill={c.rfi} radius={[0,0,0,0]} />
          <Bar dataKey="change" name="Change" stackId="a" fill={c.change} radius={[0,0,0,0]} />
          <Bar dataKey="deliverable" name="Deliverable" stackId="a" fill={c.deliverable} radius={[2,2,0,0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-6 mt-2 flex-wrap items-center">
        {Object.entries(c).map(([key, color]) => (
          <div key={key} className="flex items-center gap-2">
            <div className="w-3 h-3" style={{ backgroundColor: color }} />
            <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <div style={{ width: 2, height: 12, backgroundColor: "#A93226" }} />
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>Bugün</span>
        </div>
        {hasPrePeriod && (
          <div className="flex items-center gap-2">
            <div style={{ width: 12, height: 2, backgroundColor: dark ? "#E07060" : "#A93226", borderTop: "1px dashed" }} />
            <span className="text-xs" style={{ color: dark ? "#E07060" : "#A93226" }}>Chart öncesi overdue</span>
          </div>
        )}
      </div>
    </>
  );
}
