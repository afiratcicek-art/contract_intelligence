import { useNavigate } from "react-router-dom";
import { useProjects } from "../hooks/useProjects";
import ProjectCard from "../components/ProjectCard";
import Button from "../components/Button";
import AppChrome, { ChromeCrumb } from "../components/AppChrome";
import { useLanguage } from "../context/LanguageContext";

export default function Dashboard() {
  const navigate = useNavigate();
  const { projects, loading, error } = useProjects();
  const { t } = useLanguage();

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      <AppChrome
        density="nav"
        signOut
        trail={
          <ChromeCrumb current>
            <span className="text-lg" style={{ fontFamily: "var(--font-brand)", color: "var(--color-text-primary)" }}>
              ClauseIQ
            </span>
          </ChromeCrumb>
        }
      />
      <main style={{ maxWidth: "var(--measure-hol)", margin: "0 auto", padding: "40px 32px" }}>
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
              {t("dashboard.empty")}
            </p>
            <p className="text-sm mb-6" style={{ color: "var(--color-text-secondary)" }}>
              {t("dashboard.emptyhint")}
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
