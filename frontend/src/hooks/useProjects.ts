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
  engineer_name: string | null;
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
    api
      .get<{ open_correspondences: number; overdue_rfis: number; upcoming_deadlines: number }>(
        `/projects/${projectId}/health`
      )
      .then((data) => {
        setHealth({
          open_correspondences: data.open_correspondences,
          overdue_rfis: data.overdue_rfis,
          upcoming_deadlines: data.upcoming_deadlines,
          loading: false,
        });
      })
      .catch(() => {
        setHealth((prev) => ({ ...prev, loading: false }));
      });
  }, [projectId]);
  return health;
}
