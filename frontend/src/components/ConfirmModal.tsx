interface Props {
  open: boolean;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open, message,
  confirmLabel = "Onayla",
  cancelLabel  = "İptal",
  onConfirm, onCancel,
}: Props) {
  if (!open) return null;
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center",
        justifyContent: "center", zIndex: 1500,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-light)",
          borderLeft: "3px solid var(--color-accent)",
          padding: "24px 28px", maxWidth: 400, width: "100%",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <p style={{
          fontSize: 13, color: "var(--color-text-primary)",
          margin: "0 0 20px", lineHeight: 1.6,
        }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              fontSize: 12, padding: "7px 18px",
              background: "none",
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border-light)",
              borderRadius: 0, cursor: "pointer",
              fontFamily: "Inter, sans-serif",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              fontSize: 12, padding: "7px 18px",
              background: "var(--color-accent)",
              color: "var(--color-bg-primary)",
              border: "1px solid var(--color-accent)",
              borderRadius: 0, cursor: "pointer",
              fontWeight: 500, fontFamily: "Inter, sans-serif",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
