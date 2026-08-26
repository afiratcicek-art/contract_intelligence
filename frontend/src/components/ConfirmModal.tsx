import { useEffect } from "react";
import Button from "./Button";

interface Props {
  open: boolean;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Delete / irreversible — destructive Button. Approve / proceed stays primary. */
  variant?: "primary" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open, message,
  confirmLabel = "Onayla",
  cancelLabel  = "İptal",
  variant = "primary",
  onConfirm, onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      onClick={onCancel}
      role="presentation"
      style={{
        position: "fixed", inset: 0,
        backgroundColor: "var(--color-overlay)",
        display: "flex", alignItems: "center",
        justifyContent: "center", zIndex: "var(--z-confirm)" as unknown as number,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-describedby="confirm-modal-message"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-light)",
          borderLeft: variant === "destructive"
            ? "3px solid var(--color-alert-red)"
            : "3px solid var(--color-accent)",
          padding: "24px 32px",
          maxWidth: 400,
          width: "min(400px, calc(100% - 32px))",
          boxSizing: "border-box",
          fontFamily: "var(--font-ui)",
        }}
      >
        <p
          id="confirm-modal-message"
          style={{
            fontSize: 13, color: "var(--color-text-primary)",
            margin: "0 0 20px", lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {message}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === "destructive" ? "destructive" : "primary"}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
