import { useState, useEffect } from "react";
import { api } from "../services/api";

export interface Project {
  id: string;
  name: string;
  contract_type: string | null;
  contract_value: number | null;
  currency: string;
  employer_name: string;
  contractor_name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

export interface ProjectHealth {
  open_correspondences: number;
  overdue_rfis: number;
  upcoming_deadlines: number;
  loading: boolean;
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Project[]>("/projects")
      .then(setProjects)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { projects, loading, error };
}

export function useProjectHealth(projectId: string): ProjectHealth {
  const [health, setHealth] = useState<ProjectHealth>({
    open_correspondences: 0,
    overdue_rfis: 0,
    upcoming_deadlines: 0,
    loading: true,
  });

  useEffect(() => {
    Promise.all([
      api
        .get<unknown[]>(`/projects/${projectId}/correspondences?status=open`)
        .catch(() => []),
      api
        .get<unknown[]>(`/projects/${projectId}/rfis?status=overdue`)
        .catch(() => []),
      api
        .get<unknown[]>(`/projects/${projectId}/rfis/deadlines?days=7`)
        .catch(() => []),
    ]).then(([corr, rfis, deadlines]) => {
      setHealth({
        open_correspondences: Array.isArray(corr) ? corr.length : 0,
        overdue_rfis: Array.isArray(rfis) ? rfis.length : 0,
        upcoming_deadlines: Array.isArray(deadlines) ? deadlines.length : 0,
        loading: false,
      });
    });
  }, [projectId]);

  return health;
}
