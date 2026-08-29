import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import LanguageToggle from "./LanguageToggle";
import ThemeToggle from "./ThemeToggle";
import { getAuth, clearAuth } from "../store/auth";
import { useLanguage } from "../context/LanguageContext";

type Density = "nav" | "compact";

type Props = {
  density?: Density;
  trail: ReactNode;
  signOut?: boolean;
};

export default function AppChrome({
  density = "compact",
  trail,
  signOut = false,
}: Props) {
  const navigate = useNavigate();
  const auth = getAuth();
  const { t } = useLanguage();
  const hol = density === "nav";

  function handleLogout() {
    clearAuth();
    navigate("/login");
  }

  return (
    <nav className={hol ? "app-chrome-nav app-chrome-nav-hol" : "app-chrome-nav"}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: "var(--color-text-secondary)",
          minWidth: 0,
        }}
      >
        <div className={hol ? "gold-line gold-line-nav" : "gold-line gold-line-compact"} />
        {trail}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 12,
          color: "var(--color-text-secondary)",
          flexShrink: 0,
        }}
      >
        <span>{auth?.full_name}</span>
        <LanguageToggle />
        <ThemeToggle />
        {signOut && (
          <button
            type="button"
            onClick={handleLogout}
            className="transition-opacity hover:opacity-70"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              color: "var(--color-text-secondary)",
              fontFamily: "var(--font-ui)",
            }}
          >
            {t("nav.signout")}
          </button>
        )}
      </div>
    </nav>
  );
}

export function ChromeCrumb({
  onClick,
  current,
  children,
}: {
  onClick?: () => void;
  current?: boolean;
  children: ReactNode;
}) {
  if (!onClick) {
    return (
      <span style={{ color: current ? "var(--color-text-primary)" : undefined, fontWeight: current ? 500 : undefined }}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        fontSize: 13,
        fontFamily: "var(--font-ui)",
        color: current ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        fontWeight: current ? 500 : 400,
      }}
    >
      {children}
    </button>
  );
}

export function ChromeSep() {
  return <span style={{ color: "var(--color-text-secondary)" }}>/</span>;
}
