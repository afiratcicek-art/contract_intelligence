import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../services/api";
import { saveAuth } from "../store/auth";
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
      navigate("/dashboard");
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
      {/* Sol panel — marka */}
      <div
        className="hidden lg:flex flex-col justify-between w-2/5 p-12"
        style={{ backgroundColor: "var(--color-bg-secondary)" }}
      >
        {/* Üst — logo ve imza çizgisi */}
        <div className="flex items-start gap-6">
          <div
            className="shrink-0 mt-1"
            style={{
              width: "2px",
              height: "72px",
              background:
                "linear-gradient(to bottom, transparent 0%, var(--color-accent) 20%, var(--color-accent) 80%, transparent 100%)",
            }}
          />
          <div>
            <h1
              className="text-3xl tracking-tight"
              style={{ fontFamily: "Playfair Display, Georgia, serif", color: "var(--color-text-primary)" }}
            >
              ClauseIQ
            </h1>
            <p
              className="mt-1 text-sm"
              style={{ color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}
            >
              Contract & Operational Intelligence
            </p>
          </div>
        </div>

        {/* Alt — tagline */}
        <div>
          <p
            className="text-xs uppercase tracking-widest mb-3"
            style={{ color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}
          >
            Precision. Compliance. Control.
          </p>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "var(--color-text-secondary)", fontFamily: "Inter, sans-serif" }}
          >
            Every notice, every deadline, every correspondence —
            managed with contractual precision.
          </p>
        </div>
      </div>

      {/* Sağ panel — form */}
      <div className="relative flex flex-1 items-center justify-center px-8">
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <button onClick={toggleLang} style={{ background: "none", border: "1px solid var(--color-border-light)", cursor: "pointer", fontSize: 11, color: "var(--color-text-secondary)", padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 500, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
          <ThemeToggle />
        </div>
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10 flex items-center gap-4">
            <div
              style={{
                width: "2px",
                height: "48px",
                background:
                  "linear-gradient(to bottom, transparent 0%, var(--color-accent) 20%, var(--color-accent) 80%, transparent 100%)",
              }}
            />
            <h1
              className="text-2xl"
              style={{ fontFamily: "Playfair Display, Georgia, serif", color: "var(--color-text-primary)" }}
            >
              ClauseIQ
            </h1>
          </div>

          <h2
            className="text-xl mb-1"
            style={{ fontFamily: "Playfair Display, Georgia, serif", color: "var(--color-text-primary)" }}
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
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border-light)",
                  color: "var(--color-text-primary)",
                  fontFamily: "Inter, sans-serif",
                }}
                onFocus={(e) => (e.target.style.borderColor = "var(--color-accent)")}
                onBlur={(e) => (e.target.style.borderColor = "var(--color-border-light)")}
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
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border-light)",
                  color: "var(--color-text-primary)",
                  fontFamily: "Inter, sans-serif",
                }}
                onFocus={(e) => (e.target.style.borderColor = "var(--color-accent)")}
                onBlur={(e) => (e.target.style.borderColor = "var(--color-border-light)")}
              />
            </div>

            {/* Hata */}
            {/* Beni hatırla */}
            <div className="flex items-center gap-3 mt-1">
              <input
                id="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 cursor-pointer accent-gold"
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
