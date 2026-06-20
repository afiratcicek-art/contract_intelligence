import { useNavigate } from "react-router-dom";
import { useProjects } from "../hooks/useProjects";
import ProjectCard from "../components/ProjectCard";
import { getAuth, clearAuth } from "../store/auth";
import Button from "../components/Button";
import ThemeToggle from "../components/ThemeToggle";
import { useDarkMode } from "../hooks/useDarkMode";
import { useLanguage } from "../context/LanguageContext";

export default function Dashboard() {
  const navigate = useNavigate();
  const { projects, loading, error } = useProjects();
  const auth = getAuth();
  const dark = useDarkMode();
  const { lang, toggle: toggleLang, t } = useLanguage();

  function handleLogout() {
    clearAuth();
    navigate("/login");
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: dark ? "#1F2228" : "#F5F2ED" }}>
      <nav
        className="flex items-center justify-between px-8 py-4 border-b"
        style={{ borderColor: dark ? "#3D4456" : "#E7E3DC", backgroundColor: dark ? "#1F2228" : "#F5F2ED" }}
      >
        <div className="flex items-center gap-4">
          <div style={{ width: "2px", height: "32px", background: "linear-gradient(to bottom, transparent 0%, #6B5D3F 20%, #6B5D3F 80%, transparent 100%)" }} />
          <span className="text-lg font-semibold" style={{ fontFamily: "Playfair Display, Georgia, serif", color: dark ? "#E8E6E0" : "#1C1917" }}>
            ClauseIQ
          </span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-sm" style={{ color: dark ? "#C4B49C" : "#44403C" }}>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: `1px solid ${dark ? "#3D4456" : "#E7E3DC"}`, cursor: "pointer", fontSize: 11, color: dark ? "#C4B49C" : "#44403C", padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 600, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
          <ThemeToggle />
          <button onClick={handleLogout} className="text-sm transition-opacity hover:opacity-70" style={{ color: dark ? "#C4B49C" : "#44403C" }}>
            {t("nav.signout")}
          </button>
        </div>
      </nav>
      <main className="max-w-4xl mx-auto px-8 py-10">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold" style={{ fontFamily: "Playfair Display, Georgia, serif", color: dark ? "#E8E6E0" : "#1C1917" }}>
              {t("dashboard.title")}
            </h1>
            <p className="text-sm mt-1" style={{ color: dark ? "#C4B49C" : "#44403C" }}>
              {t("dashboard.subtitle")}
            </p>
          </div>
          <Button onClick={() => navigate("/projects/new")} className="px-4">
            {t("dashboard.newproject")}
          </Button>
        </div>
        {loading && <p className="text-sm" style={{ color: dark ? "#C4B49C" : "#44403C" }}>{t("state.loading")}</p>}
        {error && <p className="text-sm" style={{ color: "#A93226" }}>{error}</p>}
        {!loading && !error && projects.length === 0 && (
          <div className="text-center py-16 rounded-sm" style={{ backgroundColor: dark ? "#2E3340" : "#E7E3DC" }}>
            <p className="text-base font-semibold mb-1" style={{ fontFamily: "Playfair Display, Georgia, serif", color: dark ? "#E8E6E0" : "#1C1917" }}>
              {lang === "tr" ? "Henüz proje yok" : "No projects yet"}
            </p>
            <p className="text-sm mb-6" style={{ color: dark ? "#C4B49C" : "#44403C" }}>
              {lang === "tr" ? "Başlamak için ilk projenizi oluşturun." : "Create your first project to get started."}
            </p>
            <Button onClick={() => navigate("/projects/new")}>{t("dashboard.newproject")}</Button>
          </div>
        )}
        {!loading && !error && projects.length > 0 && (
          <div className="flex flex-col gap-4">
            {projects.map((project) => (<ProjectCard key={project.id} project={project} />))}
          </div>
        )}
      </main>
    </div>
  );
}
