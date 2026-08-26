import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "destructive" | "warning";
type Size = "default" | "sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  loadingText?: string;
  children: ReactNode;
}

const styles: Record<Variant, string> = {
  primary: [
    "bg-[var(--color-accent)] text-[var(--color-bg-primary)]",
    "hover:bg-[var(--color-accent-hover)]",
    "active:bg-[var(--color-accent-active)] active:scale-[0.98]",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
    "disabled:opacity-40 disabled:cursor-not-allowed",
  ].join(" "),
  secondary: [
    "bg-transparent border border-[var(--color-accent)] text-[var(--color-accent-text)]",
    "hover:bg-[var(--color-accent-wash)]",
    "active:scale-[0.98]",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
    "disabled:opacity-40 disabled:cursor-not-allowed",
  ].join(" "),
  destructive: [
    "bg-transparent border border-[var(--color-alert-red)] text-[var(--color-alert-red)]",
    "hover:bg-[var(--color-alert-wash)]",
    "active:scale-[0.98]",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-alert-red)]",
    "disabled:opacity-40 disabled:cursor-not-allowed",
  ].join(" "),
  warning: [
    "bg-transparent border border-[var(--color-warning)] text-[var(--color-warning)]",
    "hover:bg-[var(--color-warning-wash)]",
    "active:scale-[0.98]",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-warning)]",
    "disabled:opacity-40 disabled:cursor-not-allowed",
  ].join(" "),
};

const sizes: Record<Size, string> = {
  default: "px-6 py-2 text-[13px]",
  sm: "px-3 py-1.5 text-xs",
};

const base =
  "inline-flex items-center justify-center font-medium tracking-[0.5px] rounded-none transition-all duration-150 select-none";

export default function Button({
  variant = "primary",
  size = "default",
  loading = false,
  loadingText,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${base} ${sizes[size]} ${styles[variant]} ${className}`}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12" cy="12" r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          {loadingText ?? "Processing..."}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
