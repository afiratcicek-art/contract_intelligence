import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../services/api";
import { saveAuth, safeNextPath } from "../store/auth";
import Button from "../components/Button";
import ThemeToggle from "../components/ThemeToggle";
import { useLanguage } from "../context/LanguageContext";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const { lang, toggle: toggleLang, t } = useLanguage();

  useEffect(() => {
    const saved = localStorage.getItem("clauseiq_remembered_email");
    if (saved) {
      setEmail(saved);
      setRememberMe(true);
    }
  }, []);

  const inputStyle = {
    backgroundColor: "var(--color-bg-primary)",
    border: "1px solid var(--color-border-medium)",
    color: "var(--color-text-primary)",
    fontFamily: "var(--font-ui)",
    borderRadius: 0,
  } as const;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      saveAuth({
        user_id: res.user_id,
        full_name: res.full_name,
      });
      if (rememberMe) {
        localStorage.setItem("clauseiq_remembered_email", email);
      } else {
        localStorage.removeItem("clauseiq_remembered_email");
      }
      navigate(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : (lang === "tr" ? "Giriş başarısız." : "Login failed."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
    >
      {/* Sol panel — antetli kağıt: letterhead / gövde bildiri / dip meta */}
      <div
        className="hidden lg:flex flex-col w-2/5 p-12"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderRight: "1px solid var(--color-border-medium)",
        }}
      >
        {/* Üst — letterhead */}
        <div className="flex items-start gap-6 shrink-0">
          <div className="gold-line gold-line-stage mt-2" />
          <div>
            <h1
              className="tracking-tight"
              style={{
                fontFamily: "var(--font-brand)",
                fontSize: "var(--type-brand-stage)",
                color: "var(--color-text-primary)",
                fontWeight: 600,
                lineHeight: 1.1,
              }}
            >
              ClauseIQ
            </h1>
            <p
              className="mt-2 text-base"
              style={{ color: "var(--color-text-secondary)", fontFamily: "var(--font-ui)" }}
            >
              {t("brand.tagline")}
            </p>
          </div>
        </div>

        {/* Orta — resmi bildiri (dikey merkez) */}
        <div className="flex-1 flex flex-col justify-center min-h-0 py-8">
          <p
            className="text-xl tracking-widest mb-4"
            lang={lang === "tr" ? "tr" : "en"}
            style={{
              color: "var(--color-text-primary)",
              fontFamily: "var(--font-ui)",
              fontWeight: 500,
              letterSpacing: "0.12em",
            }}
          >
            {t("brand.motto")}
          </p>
          <p
            className="text-base leading-relaxed"
            style={{
              color: "var(--color-text-secondary)",
              fontFamily: "var(--font-ui)",
              maxWidth: "26em",
            }}
          >
            {t("brand.motto_body")}
          </p>
        </div>

        {/* Alt — sayfa meta (motto değil) */}
        <p
          className="shrink-0 text-xs"
          style={{
            color: "var(--color-text-tertiary)",
            fontFamily: "var(--font-meta)",
            letterSpacing: "0.04em",
          }}
        >
          {t("brand.footer")}
        </p>
      </div>

      {/* Sağ panel — form */}
      <div className="relative flex flex-1 items-center justify-center px-8">
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <button onClick={toggleLang} style={{ background: "none", border: "1px solid var(--color-border-light)", cursor: "pointer", fontSize: 11, color: "var(--color-text-secondary)", padding: "2px 8px", fontFamily: "var(--font-meta)", fontWeight: 500, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
          <ThemeToggle />
        </div>
        <div className="w-full max-w-sm">
          {/* Mobile brand + short motto */}
          <div className="lg:hidden mb-10">
            <div className="flex items-center gap-4">
              <div className="gold-line gold-line-nav" style={{ height: 64 }} />
              <h1
                className="text-4xl tracking-tight"
                style={{
                  fontFamily: "var(--font-brand)",
                  color: "var(--color-text-primary)",
                  fontWeight: 600,
                  lineHeight: 1.1,
                }}
              >
                ClauseIQ
              </h1>
            </div>
            <p
              className="mt-4 text-xs uppercase tracking-widest"
              style={{
                color: "var(--color-text-secondary)",
                fontFamily: "var(--font-ui)",
                fontWeight: 500,
                letterSpacing: "0.1em",
              }}
            >
              {t("brand.motto")}
            </p>
          </div>

          <h2
            className="mb-1"
            style={{
              fontFamily: "var(--font-brand)",
              fontSize: "var(--type-h1)",
              color: "var(--color-text-primary)",
            }}
          >
            {t("login.title")}
          </h2>
          <p className="text-sm mb-8" style={{ color: "var(--color-text-secondary)" }}>
            {t("login.subtitle")}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* E-posta */}
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium mb-1 uppercase tracking-wide"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {t("login.email")}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-4 text-sm outline-none transition-colors"
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "var(--color-accent)")}
                onBlur={(e) => (e.target.style.borderColor = "var(--color-border-medium)")}
              />
            </div>

            {/* Şifre */}
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium mb-1 uppercase tracking-wide"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {t("login.password")}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-4 text-sm outline-none transition-colors"
                style={inputStyle}
                onFocus={(e) => (e.target.style.borderColor = "var(--color-accent)")}
                onBlur={(e) => (e.target.style.borderColor = "var(--color-border-medium)")}
              />
            </div>

            {/* Beni hatırla */}
            <div className="flex items-center gap-3 mt-1">
              <input
                id="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 cursor-pointer"
                style={{ accentColor: "var(--color-accent)" }}
              />
              <label
                htmlFor="rememberMe"
                className="text-xs cursor-pointer select-none"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {t("login.remember")}
              </label>
            </div>

            {error && (
              <p className="text-sm" style={{ color: "var(--color-alert-red)" }}>
                {error}
              </p>
            )}

            {/* Submit */}
            <Button
              type="submit"
              loading={loading}
              loadingText={t("login.loading") ?? "..."}
              className="w-full"
            >
              {t("login.button")}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
