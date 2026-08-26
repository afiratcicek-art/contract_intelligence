/** Shared status chip — sharp corners, status tokens only. */

import { useLanguage } from "../context/LanguageContext";

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
  const { t, lang } = useLanguage();
  const key = status.toLowerCase().replace(/\s+/g, "_");
  const c = STATUS_COLORS[key] ?? FALLBACK;

  // Unmapped values fall back to the raw enum with underscores softened, so a
  // new backend status degrades to readable text rather than "under_review".
  const translated = t(`status.${key}`);
  const label = translated === `status.${key}` ? key.replace(/_/g, " ") : translated;

  return (
    <span
      className={`px-2 py-0.5 shrink-0 ${className}`.trim()}
      style={{
        backgroundColor: c.bg,
        color: c.text,
        borderRadius: 0,
        fontSize: 11,
        fontFamily: "var(--font-ui)",
        // Turkish and Arabic do not survive CSS uppercasing; keep the wide-set
        // treatment only where the script supports it.
        textTransform: lang === "en" ? "uppercase" : "none",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        // In a fixed status column the longest translated label ("UNDER REVIEW")
        // would otherwise run past the row edge. Colour still carries the state,
        // so clipping the word is the acceptable failure here.
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label}
    </span>
  );
}
