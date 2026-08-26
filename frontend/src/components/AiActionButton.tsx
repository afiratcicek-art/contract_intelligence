/**
 * Intelligence-layer CTA — product-wide canonical control.
 * Tokens: --color-ai / --color-ai-bg. Shape: non-rect (borderRadius 6), not admin sharp (0).
 * Use for every equivalent AI generate/assist action (authoring, chronology, future).
 * Hover / active / focus live in `.ai-action-btn` (index.css) — do not restyle per call site.
 */
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

function SparkIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.5-1.5 4.5-3 6l-1 1H9l-1-1C6.5 13.5 5 11.5 5 9a7 7 0 0 1 7-7z" />
    </svg>
  );
}

export default function AiActionButton({
  children,
  disabled,
  className = "",
  style: styleOverride,
  ...props
}: Props) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled}
      className={`ai-action-btn ${className}`.trim()}
      style={styleOverride as CSSProperties | undefined}
    >
      <SparkIcon />
      {children}
    </button>
  );
}
