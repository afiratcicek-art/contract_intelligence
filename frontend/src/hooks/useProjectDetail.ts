import { useState, useEffect } from "react";
import { api } from "../services/api";
import type { Project } from "./useProjects";

export interface CorrespondenceItem {
  id: string;
  corr_number: string;
  subject: string;
  direction: string;
  type: string;
  status: string;
  correspondence_date: string;
  response_due_date: string | null;
}

export interface RFIItem {
  id: string;
  rfi_number: string;
  subject: string;
  status: string;
  submitted_date: string;
  response_due_date: string | null;
  discipline: string | null;
}

export interface ChangeItem {
  id: string;
  change_number: string;
  title: string;
  status: string;
  origin: string;
  notice_due_date: string | null;
  notice_sent: boolean;
}

export interface DeliverableItem {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  is_pre_completion: boolean;
}

export interface TrendPoint {
  date: string;
  incoming: number;
  outgoing: number;
}

export function useProjectDetail(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Project>(`/projects/${projectId}`)
      .then(setProject)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  return { project, loading, error };
}

export function useProjectTabs(projectId: string) {
  const [correspondences, setCorrespondences] = useState<CorrespondenceItem[]>([]);
  const [rfis, setRFIs] = useState<RFIItem[]>([]);
  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverableItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<CorrespondenceItem[]>(`/projects/${projectId}/correspondences`).catch(() => []),
      api.get<RFIItem[]>(`/projects/${projectId}/rfis`).catch(() => []),
      api.get<ChangeItem[]>(`/projects/${projectId}/changes`).catch(() => []),
      api.get<DeliverableItem[]>(`/projects/${projectId}/deliverables`).catch(() => []),
    ]).then(([corr, rfi, chng, deliv]) => {
      setCorrespondences(Array.isArray(corr) ? corr : []);
      setRFIs(Array.isArray(rfi) ? rfi : []);
      setChanges(Array.isArray(chng) ? chng : []);
      setDeliverables(Array.isArray(deliv) ? deliv : []);
      setLoading(false);
    });
  }, [projectId]);

  // Correspondence trend — son 30 gun, gun bazli outgoing/incoming
  const trend: TrendPoint[] = (() => {
    const days: Record<string, TrendPoint> = {};
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days[key] = { date: key, incoming: 0, outgoing: 0 };
    }
    correspondences.forEach((c) => {
      const day = c.correspondence_date?.slice(0, 10);
      if (day && days[day]) {
        if (c.direction === "incoming") days[day].incoming += 1;
        else days[day].outgoing += 1;
      }
    });
    return Object.values(days);
  })();

  return { correspondences, rfis, changes, deliverables, trend, loading };
}
