/**
 * Register | Create chooser for new / response / followup / revision entry.
 * Same mental model as Workspace module dropdowns.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "./Button";
import { useLanguage } from "../context/LanguageContext";

type Props = {
  label: string;
  registerPath: string;
  createPath: string;
  variant?: "primary" | "secondary";
};

export default function EntryModeMenu({
  label,
  registerPath,
  createPath,
  variant = "primary",
}: Props) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const itemStyle = {
    display: "block" as const,
    width: "100%",
    padding: "10px 16px",
    textAlign: "left" as const,
    fontSize: 12,
    color: "var(--color-text-primary)",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    borderRadius: 0,
  };

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <Button
        size="sm"
        type="button"
        variant={variant}
        onClick={() => setOpen((v) => !v)}
        style={{ whiteSpace: "nowrap" }}
      >
        {label} ▾
      </Button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            zIndex: "var(--z-dropdown)" as unknown as number,
            backgroundColor: "var(--color-bg-primary)",
            border: "1px solid var(--color-border-medium)",
            minWidth: 180,
            marginTop: 2,
            borderRadius: 0,
          }}
        >
          <button
            type="button"
            style={{ ...itemStyle, borderBottom: "0.5px solid var(--color-border-light)" }}
            onClick={() => {
              setOpen(false);
              navigate(registerPath);
            }}
          >
            {t("action.register")}
          </button>
          <button
            type="button"
            style={itemStyle}
            onClick={() => {
              setOpen(false);
              navigate(createPath);
            }}
          >
            {t("action.create")}
          </button>
        </div>
      )}
    </div>
  );
}
