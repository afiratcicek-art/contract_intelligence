import type { Toast, ToastType } from "../hooks/useToast";
import { useLanguage } from "../context/LanguageContext";

const TYPE_STYLES: Record<ToastType, { border: string; color: string; bg: string }> = {
  success: {
    border: "var(--color-success)",
    color:  "var(--color-success)",
    bg:     "var(--color-success-bg, var(--color-bg-secondary))",
  },
  error: {
    border: "var(--color-danger)",
    color:  "var(--color-danger)",
    bg:     "var(--color-bg-secondary)",
  },
  warning: {
    border: "var(--color-warning)",
    color:  "var(--color-warning)",
    bg:     "var(--color-bg-secondary)",
  },
  info: {
    border: "var(--color-accent)",
    color:  "var(--color-accent-text)",
    bg:     "var(--color-bg-secondary)",
  },
};

interface Props {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export default function ToastContainer({ toasts, onDismiss }: Props) {
  const { t } = useLanguage();
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24,
      display: "flex", flexDirection: "column", gap: 8,
      zIndex: "var(--z-toast)" as unknown as number, maxWidth: 360,
    }}>
      {toasts.map((toast) => {
        const s = TYPE_STYLES[toast.type];
        return (
          <div
            key={toast.id}
            style={{
              display: "flex", alignItems: "flex-start",
              justifyContent: "space-between", gap: 12,
              padding: "10px 14px",
              background: s.bg,
              border: `1px solid ${s.border}`,
              borderLeft: `3px solid ${s.border}`,
              fontFamily: "var(--font-ui)",
            }}
          >
            <span style={{ fontSize: 12, color: "var(--color-text-primary)", flex: 1, lineHeight: 1.5 }}>
              {toast.message}
            </span>
            <button
              onClick={() => onDismiss(toast.id)}
              aria-label={t("action.close")}
              style={{
                background: "none", border: "none",
                cursor: "pointer", fontSize: 14,
                color: "var(--color-text-secondary)",
                padding: 0, flexShrink: 0, lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
