import { useNavigate } from "react-router-dom";
import LanguageToggle from "../components/LanguageToggle";
import { useProjects } from "../hooks/useProjects";
import ProjectCard from "../components/ProjectCard";
import { getAuth, clearAuth } from "../store/auth";
import Button from "../components/Button";
import ThemeToggle from "../components/ThemeToggle";
import { useLanguage } from "../context/LanguageContext";

export default function Dashboard() {
  const navigate = useNavigate();
  const { projects, loading, error } = useProjects();
  const auth = getAuth();
  const { lang, t } = useLanguage();

  function handleLogout() {
    clearAuth();
    navigate("/login");
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      <nav
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-8 py-4 border-b"
        style={{ borderColor: "var(--color-border-light)", backgroundColor: "var(--color-bg-primary)" }}
      >
        <div className="flex items-center gap-4">
          <div className="gold-line gold-line-nav" />
          <span className="text-lg" style={{ fontFamily: "var(--font-brand)", color: "var(--color-text-primary)" }}>
            ClauseIQ
          </span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{auth?.full_name}</span>
          <LanguageToggle />
          <ThemeToggle />
          <button onClick={handleLogout} className="text-sm transition-opacity hover:opacity-70" style={{ color: "var(--color-text-secondary)" }}>
            {t("nav.signout")}
          </button>
        </div>
      </nav>
      <main className="max-w-4xl mx-auto px-8 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1
              className="font-semibold"
              style={{
                fontFamily: "var(--font-brand)",
                fontSize: "var(--type-h1)",
                color: "var(--color-text-primary)",
              }}
            >
              {t("dashboard.title")}
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-secondary)" }}>
              {t("dashboard.subtitle")}
            </p>
          </div>
          <Button onClick={() => navigate("/projects/new")} className="px-4">
            {t("dashboard.newproject")}
          </Button>
        </div>
        {loading && <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{t("state.loading")}</p>}
        {error && <p className="text-sm" style={{ color: "var(--color-alert-red)" }}>{error}</p>}
        {!loading && !error && projects.length === 0 && (
          <div className="text-center py-16 rounded-none" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
            <p className="mb-1" style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-title-card)", color: "var(--color-text-primary)" }}>
              {lang === "tr" ? "Henüz proje yok" : "No projects yet"}
            </p>
            <p className="text-sm mb-6" style={{ color: "var(--color-text-secondary)" }}>
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
