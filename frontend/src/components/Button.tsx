import { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "destructive";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  loadingText?: string;
  children: ReactNode;
}

const styles: Record<Variant, string> = {
  primary: [
    "bg-gold text-stone-paper",
    "hover:bg-[#5C5038]",
    "active:bg-[#4A3D28] active:scale-[0.98]",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
    "dark:bg-copper dark:text-off-white",
    "dark:hover:bg-[#A0714A]",
    "dark:focus-visible:outline-copper",
    "disabled:opacity-40 disabled:cursor-not-allowed",
  ].join(" "),
  secondary: [
    "bg-transparent border border-gold text-gold",
    "hover:bg-[rgba(92,80,56,0.08)]",
    "active:scale-[0.98]",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
    "dark:border-copper dark:text-copper",
    "dark:hover:bg-[rgba(160,113,74,0.08)]",
    "dark:focus-visible:outline-copper",
    "disabled:opacity-40 disabled:cursor-not-allowed",
  ].join(" "),
  destructive: [
    "bg-transparent border border-alert-red text-alert-red",
    "hover:bg-[rgba(169,50,38,0.08)]",
    "active:scale-[0.98]",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alert-red",
    "dark:border-alert-red-dark dark:text-alert-red-dark",
    "dark:hover:bg-[rgba(224,112,96,0.08)]",
    "dark:focus-visible:outline-alert-red-dark",
    "disabled:opacity-40 disabled:cursor-not-allowed",
  ].join(" "),
};

const base =
  "inline-flex items-center justify-center px-6 py-2 text-sm font-medium tracking-[0.5px] rounded-none transition-all duration-150 select-none";

export default function Button({
  variant = "primary",
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
      className={`${base} ${styles[variant]} ${className}`}
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
