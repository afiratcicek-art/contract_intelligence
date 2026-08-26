import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import type { ActivityPoint, PrePeriod } from "../hooks/useProjectDetail";
import { useLanguage } from "../context/LanguageContext";

interface Props {
  data: ActivityPoint[];
  today: string;
  dark: boolean;
  prePeriod?: PrePeriod;
}

// Series names come from the module.* dictionary so the legend matches the
// sidebar rather than introducing a second set of terms for the same records.
const SERIES = [
  { key: "correspondence", labelKey: "module.correspondence", fill: "var(--color-chart-correspondence)" },
  { key: "rfi", labelKey: "module.rfis", fill: "var(--color-chart-rfi)" },
  { key: "change", labelKey: "module.changes", fill: "var(--color-chart-change)" },
  { key: "deliverable", labelKey: "module.deliverables", fill: "var(--color-chart-deliverable)" },
] as const;

export default function ActivityChart({ data, today, dark: _dark, prePeriod }: Props) {
  const { t } = useLanguage();
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
            {t("chart.prebucket")}
          </text>
        </g>
      );
    }
    if (payload.value === today) {
      return (
        <g transform={`translate(${x},${y})`}>
          <text x={0} y={0} dy={12} textAnchor="middle" fill="var(--color-alert-red)" fontSize={11} fontFamily="var(--font-ui)">
            {t("overview.today")}
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
            labelFormatter={(label) => {
              if (label === "pre") return t("chart.pretooltip");
              if (label === today) return t("overview.today");
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
              name={t(s.labelKey)}
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
              {t(s.labelKey)}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <div style={{ width: 2, height: 12, backgroundColor: "var(--color-alert-red)" }} />
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>{t("overview.today")}</span>
        </div>
        {hasPrePeriod && (
          <div className="flex items-center gap-2">
            <div style={{ width: 12, height: 2, backgroundColor: "var(--color-alert-red)", borderTop: "1px dashed" }} />
            <span className="text-xs" style={{ color: "var(--color-alert-red)" }}>{t("chart.prelegend")}</span>
          </div>
        )}
      </div>
    </>
  );
}
