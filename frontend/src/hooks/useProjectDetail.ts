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
  submitted_date: string | null;
  response_due_date: string | null;
  discipline: string | null;
  entry_mode: "authored" | "recorded";
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

import type { AlertItem } from "../types/alerts";
export type { AlertItem } from "../types/alerts";

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
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<CorrespondenceItem[]>(`/projects/${projectId}/correspondences`).catch(() => []),
      api.get<RFIItem[]>(`/projects/${projectId}/rfis`).catch(() => []),
      api.get<ChangeItem[]>(`/projects/${projectId}/changes`).catch(() => []),
      api.get<DeliverableItem[]>(`/projects/${projectId}/deliverables`).catch(() => []),
      api.get<AlertItem[]>(`/projects/${projectId}/alerts?status=pending&limit=50`).catch(() => []),
    ]).then(([corr, rfi, chng, deliv, alrt]) => {
      setCorrespondences(Array.isArray(corr) ? corr : []);
      setRFIs(Array.isArray(rfi) ? rfi : []);
      setChanges(Array.isArray(chng) ? chng : []);
      setDeliverables(Array.isArray(deliv) ? deliv : []);
      setAlerts(Array.isArray(alrt) ? alrt : []);
      setLoading(false);
    });
  }, [projectId]);

  return { correspondences, rfis, changes, deliverables, alerts, loading };
}

export interface ActivityPoint {
  date: string;
  correspondence: number;
  rfi: number;
  change: number;
  deliverable: number;
}

export interface PrePeriod {
  correspondence: number;
  rfi: number;
  change: number;
  deliverable: number;
}

export interface DeadlineItem {
  type: string;
  label: string;
  ref: string;
  subject: string;
  due_date: string | null;
  id: string;
}

export interface OverdueItem {
  type: string;
  label: string;
  ref: string;
  subject: string;
  due_date: string | null;
  id: string;
}

export function useOverviewActivity(projectId: string) {
  const [data, setData] = useState<{ today: string; start: string; end: string; days: ActivityPoint[]; pre_period: PrePeriod } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .get<{ today: string; start: string; end: string; days: ActivityPoint[]; pre_period: PrePeriod }>(
        `/projects/${projectId}/overview-activity`
      )
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [projectId]);
  return { data, loading };
}

export function useUpcomingDeadlines(projectId: string) {
  const [items, setItems] = useState<DeadlineItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .get<{ today: string; items: DeadlineItem[] }>(
        `/projects/${projectId}/upcoming-deadlines`
      )
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [projectId]);
  return { items, loading };
}

export function useOverdue(projectId: string) {
  const [items, setItems] = useState<OverdueItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .get<{ today: string; items: OverdueItem[] }>(
        `/projects/${projectId}/overdue`
      )
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [projectId]);
  return { items, loading };
}
