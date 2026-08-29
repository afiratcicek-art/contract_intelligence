type Props = {
  label: string;
  active: boolean;
  onClick: () => void;
};

/** Warhol series for query facets — not language toggle, not letterframe. */
export default function FilterStamp({ label, active, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 10px",
        minHeight: "var(--control-height)",
        border: `0.5px solid ${active ? "var(--color-accent)" : "var(--color-border-light)"}`,
        fontSize: 11,
        color: active ? "var(--color-bg-primary)" : "var(--color-text-secondary)",
        background: active ? "var(--color-accent)" : "var(--color-bg-secondary)",
        cursor: "pointer",
        borderRadius: 0,
        fontFamily: "var(--font-ui)",
      }}
    >
      {label}
    </button>
  );
}
