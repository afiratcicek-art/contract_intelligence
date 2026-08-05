/** Shared status chip — sharp corners, status tokens only. */

type StatusChipProps = {
  status: string;
  className?: string;
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open:         { bg: "var(--color-warning-bg)",   text: "var(--color-warning)" },
  pending:      { bg: "var(--color-warning-bg)",   text: "var(--color-warning)" },
  under_review: { bg: "var(--color-warning-bg)",   text: "var(--color-warning)" },
  closed:       { bg: "var(--color-success-bg)",   text: "var(--color-success)" },
  active:       { bg: "var(--color-success-bg)",   text: "var(--color-success)" },
  approved:     { bg: "var(--color-success-bg)",   text: "var(--color-success)" },
  responded:    { bg: "var(--color-success-bg)",   text: "var(--color-success)" },
  published:    { bg: "var(--color-success-bg)",   text: "var(--color-success)" },
  draft:        { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)" },
  submitted:    { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)" },
  identified:   { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)" },
  in_progress:  { bg: "var(--color-success-bg)",   text: "var(--color-success)" },
  agreed:       { bg: "var(--color-success-bg)",   text: "var(--color-success)" },
  overdue:      { bg: "var(--color-alert-red-bg)", text: "var(--color-alert-red)" },
  rejected:     { bg: "var(--color-alert-red-bg)", text: "var(--color-alert-red)" },
  disputed:     { bg: "var(--color-alert-red-bg)", text: "var(--color-alert-red)" },
  completed:    { bg: "var(--color-success-bg)",   text: "var(--color-success)" },
  not_applicable: { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)" },
  expiring_soon: { bg: "var(--color-warning-bg)", text: "var(--color-warning)" },
};

const FALLBACK = { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)" };

export default function StatusChip({ status, className = "" }: StatusChipProps) {
  const key = status.toLowerCase().replace(/\s+/g, "_");
  const c = STATUS_COLORS[key] ?? FALLBACK;
  return (
    <span
      className={`text-xs px-2 py-0.5 shrink-0 ${className}`.trim()}
      style={{
        backgroundColor: c.bg,
        color: c.text,
        borderRadius: 0,
        fontFamily: "var(--font-ui)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {status}
    </span>
  );
}
