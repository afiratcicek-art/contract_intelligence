import { useNavigate } from "react-router-dom";
import { useProjects } from "../hooks/useProjects";
import ProjectCard from "../components/ProjectCard";
import { getAuth, clearAuth } from "../store/auth";

export default function Dashboard() {
  const navigate = useNavigate();
  const { projects, loading, error } = useProjects();
  const auth = getAuth();

  function handleLogout() {
    clearAuth();
    navigate("/login");
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F5F2ED" }}>
      {/* Top nav */}
      <nav
        className="flex items-center justify-between px-8 py-4 border-b"
        style={{ borderColor: "#E7E3DC", backgroundColor: "#F5F2ED" }}
      >
        <div className="flex items-center gap-4">
          <div
            style={{
              width: "2px",
              height: "32px",
              background:
                "linear-gradient(to bottom, transparent 0%, #A8936A 20%, #A8936A 80%, transparent 100%)",
            }}
          />
          <span
            className="text-lg font-semibold"
            style={{
              fontFamily: "Playfair Display, Georgia, serif",
              color: "#1C1917",
            }}
          >
            ClauseIQ
          </span>
        </div>

        <div className="flex items-center gap-6">
          <span className="text-sm" style={{ color: "#44403C" }}>
            {auth?.full_name}
          </span>
          <button
            onClick={handleLogout}
            className="text-sm transition-opacity hover:opacity-70"
            style={{ color: "#A8936A" }}
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1
              className="text-2xl font-semibold"
              style={{
                fontFamily: "Playfair Display, Georgia, serif",
                color: "#1C1917",
              }}
            >
              Projects
            </h1>
            <p className="text-sm mt-1" style={{ color: "#44403C" }}>
              Select a project to continue.
            </p>
          </div>
          <button
            onClick={() => navigate("/projects/new")}
            className="text-sm px-4 py-2 transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "#A8936A",
              color: "#F5F2ED",
              fontFamily: "Inter, sans-serif",
            }}
          >
            + New Project
          </button>
        </div>

        {/* States */}
        {loading && (
          <p className="text-sm" style={{ color: "#44403C" }}>
            Loading projects...
          </p>
        )}

        {error && (
          <p className="text-sm" style={{ color: "#DC2626" }}>
            {error}
          </p>
        )}

        {!loading && !error && projects.length === 0 && (
          <div
            className="text-center py-16 rounded-sm"
            style={{ backgroundColor: "#E7E3DC" }}
          >
            <p
              className="text-base font-semibold mb-1"
              style={{
                fontFamily: "Playfair Display, Georgia, serif",
                color: "#1C1917",
              }}
            >
              No projects yet
            </p>
            <p className="text-sm mb-6" style={{ color: "#44403C" }}>
              Create your first project to get started.
            </p>
            <button
              onClick={() => navigate("/projects/new")}
              className="text-sm px-6 py-2 transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "#A8936A",
                color: "#F5F2ED",
                fontFamily: "Inter, sans-serif",
              }}
            >
              + New Project
            </button>
          </div>
        )}

        {/* Project list */}
        {!loading && !error && projects.length > 0 && (
          <div className="flex flex-col gap-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
