/**
 * LanguageToggle — segmented EN / TR / AR control for the app chrome.
 *
 * Replaces the two-state toggle button that was duplicated across 12 pages;
 * with three languages a "show the other one" button is no longer legible.
 */
import { LANGS, LANG_CODES, LANG_NAMES, useLanguage } from "../context/LanguageContext";

export default function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <div
      dir="ltr"
      style={{
        display: "flex",
        border: "1px solid var(--color-border-light)",
        unicodeBidi: "isolate",
      }}
    >
      {LANGS.map((code) => {
        const active = code === lang;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLang(code)}
            aria-pressed={active}
            title={LANG_NAMES[code]}
            style={{
              background: active ? "var(--color-accent)" : "none",
              color: active ? "var(--color-bg-primary)" : "var(--color-text-secondary)",
              border: "none",
              borderRadius: 0,
              cursor: "pointer",
              fontSize: 11,
              padding: "2px 7px",
              fontFamily: "var(--font-meta)",
              fontWeight: 500,
              letterSpacing: "0.5px",
            }}
          >
            {LANG_CODES[code]}
          </button>
        );
      })}
    </div>
  );
}
