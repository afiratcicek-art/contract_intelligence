import type { AlertItem, AlertAction, AlertDocument } from "../types/alerts";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api/v1";

// ── In-memory GET cache ──────────────────────────────────────────────────
interface CacheEntry<T> { data: T; expiresAt: number; }
const _cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const entry = _cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.data;
}

function cacheSet<T>(key: string, data: T, ttl: number): void {
  _cache.set(key, { data, expiresAt: Date.now() + ttl * 1000 });
}

export function invalidateCache(prefix: string): void {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

// TTL config (seconds)
const TTL: Record<string, number> = {
  "/projects": 60,
};
function getTTL(path: string): number {
  if (TTL[path]) return TTL[path];
  if (path.includes("/health")) return 30;
  if (path.match(/^\/projects\/[^/]+$/)) return 30;
  return 0; // no cache
}

// ── HTTP client ──────────────────────────────────────────────────────────
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (method === "GET") {
    const ttl = getTTL(path);
    if (ttl > 0) {
      const cached = cacheGet<T>(path);
      if (cached !== null) return cached;
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
    });
    if (!res.ok) {
      if (res.status === 401) {
        const { clearAuth } = await import("../store/auth");
        clearAuth();
        window.location.href = "/login";
        throw new Error("Oturum süresi doldu");
      }
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? "Sunucu hatası");
    }
    const data = await res.json() as T;
    if (ttl > 0) cacheSet(path, data, ttl);
    const { markSessionActive } = await import("../store/auth");
    markSessionActive();
    return data;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    if (res.status === 401) {
      const { clearAuth } = await import("../store/auth");
      clearAuth();
      window.location.href = "/login";
      throw new Error("Oturum süresi doldu");
    }
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Sunucu hatası");
  }
  const { markSessionActive } = await import("../store/auth");
  markSessionActive();
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  postForm: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      credentials: "include",
      body: formData,
      // Content-Type intentionally omitted — browser sets multipart boundary
    });
    if (!res.ok) {
      if (res.status === 401) {
        const { clearAuth } = await import("../store/auth");
        clearAuth();
        window.location.href = "/login";
        throw new Error("Oturum süresi doldu");
      }
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? "Sunucu hatası");
    }
    const { markSessionActive } = await import("../store/auth");
    markSessionActive();
    return res.json();
  },
};

export interface LoginResponse {
  user_id: string;
  full_name: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return api.post<LoginResponse>("/auth/login", { email, password });
}

export async function fetchAlerts(
  projectId: string,
  status = "pending",
  limit = 50
): Promise<AlertItem[]> {
  return api.get(
    `/projects/${projectId}/alerts?status=${status}&limit=${limit}`
  );
}

export async function fetchAlertActions(
  projectId: string,
  alertId: string
): Promise<AlertAction[]> {
  return api.get(
    `/projects/${projectId}/alerts/${alertId}/actions`
  );
}

export async function createAlertAction(
  projectId: string,
  alertId: string,
  body: {
    action_type: string;
    note?: string;
    assigned_to_role?: string;
    due_date?: string;
  }
): Promise<AlertAction> {
  return api.post(
    `/projects/${projectId}/alerts/${alertId}/actions`,
    body
  );
}

export async function fetchAlertDocuments(
  projectId: string,
  alertId: string
): Promise<AlertDocument[]> {
  return api.get(
    `/projects/${projectId}/alerts/${alertId}/documents`
  );
}
