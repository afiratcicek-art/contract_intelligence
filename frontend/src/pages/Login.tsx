import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../services/api";
import { saveAuth } from "../store/auth";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      saveAuth({
        user_id: res.user_id,
        full_name: res.full_name,
        access_token: res.access_token,
      });
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Giriş başarısız.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex"
      style={{ backgroundColor: "#F5F2ED" }}
    >
      {/* Sol panel — marka */}
      <div
        className="hidden lg:flex flex-col justify-between w-2/5 p-12"
        style={{ backgroundColor: "#E7E3DC" }}
      >
        {/* Üst — logo ve imza çizgisi */}
        <div className="flex items-start gap-6">
          <div
            className="shrink-0 mt-1"
            style={{
              width: "2px",
              height: "72px",
              background:
                "linear-gradient(to bottom, transparent 0%, #A8936A 20%, #A8936A 80%, transparent 100%)",
            }}
          />
          <div>
            <h1
              className="text-3xl font-semibold tracking-tight"
              style={{ fontFamily: "Playfair Display, Georgia, serif", color: "#1C1917" }}
            >
              ClauseIQ
            </h1>
            <p
              className="mt-1 text-sm"
              style={{ color: "#44403C", fontFamily: "Inter, sans-serif" }}
            >
              Contract & Operational Intelligence
            </p>
          </div>
        </div>

        {/* Alt — tagline */}
        <div>
          <p
            className="text-xs uppercase tracking-widest mb-3"
            style={{ color: "#A8936A", fontFamily: "Inter, sans-serif" }}
          >
            Built for FIDIC & NEC
          </p>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "#44403C", fontFamily: "Inter, sans-serif" }}
          >
            Her notice, her deadline, her correspondence — contractual
            precision at your fingertips.
          </p>
        </div>
      </div>

      {/* Sağ panel — form */}
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-10 flex items-center gap-4">
            <div
              style={{
                width: "2px",
                height: "48px",
                background:
                  "linear-gradient(to bottom, transparent 0%, #A8936A 20%, #A8936A 80%, transparent 100%)",
              }}
            />
            <h1
              className="text-2xl font-semibold"
              style={{ fontFamily: "Playfair Display, Georgia, serif", color: "#1C1917" }}
            >
              ClauseIQ
            </h1>
          </div>

          <h2
            className="text-xl font-semibold mb-1"
            style={{ fontFamily: "Playfair Display, Georgia, serif", color: "#1C1917" }}
          >
            Oturum Aç
          </h2>
          <p className="text-sm mb-8" style={{ color: "#44403C" }}>
            Devam etmek için giriş yapın.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* E-posta */}
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium mb-1 uppercase tracking-wide"
                style={{ color: "#44403C" }}
              >
                E-posta
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 text-sm outline-none transition-colors"
                style={{
                  backgroundColor: "#E7E3DC",
                  border: "1px solid #C4AD87",
                  color: "#1C1917",
                  fontFamily: "Inter, sans-serif",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#A8936A")}
                onBlur={(e) => (e.target.style.borderColor = "#C4AD87")}
              />
            </div>

            {/* Şifre */}
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium mb-1 uppercase tracking-wide"
                style={{ color: "#44403C" }}
              >
                Şifre
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 text-sm outline-none transition-colors"
                style={{
                  backgroundColor: "#E7E3DC",
                  border: "1px solid #C4AD87",
                  color: "#1C1917",
                  fontFamily: "Inter, sans-serif",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#A8936A")}
                onBlur={(e) => (e.target.style.borderColor = "#C4AD87")}
              />
            </div>

            {/* Hata */}
            {error && (
              <p className="text-sm" style={{ color: "#DC2626" }}>
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 text-sm font-medium tracking-wide transition-opacity"
              style={{
                backgroundColor: loading ? "#C4AD87" : "#A8936A",
                color: "#F5F2ED",
                fontFamily: "Inter, sans-serif",
                opacity: loading ? 0.7 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
