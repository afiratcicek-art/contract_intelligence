import { invalidateCache } from "../services/api";

const USER_KEY = "clauseiq_user";
const SESSION_FLAG = "clauseiq_session_active";
const INACTIVITY_MS = 4 * 60 * 60 * 1000; // 4 hours

let _inactivityTimer: ReturnType<typeof setTimeout> | null = null;

function resetInactivityTimer(): void {
  if (_inactivityTimer) clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(() => {
    clearAuth();
    window.location.href = "/login";
  }, INACTIVITY_MS);
}

export function markSessionActive(): void {
  sessionStorage.setItem(SESSION_FLAG, "1");
  resetInactivityTimer();
}

export function isSessionActive(): boolean {
  return sessionStorage.getItem(SESSION_FLAG) === "1";
}

export interface AuthUser {
  user_id: string;
  full_name: string;
}

export function saveAuth(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  markSessionActive();
}

export function getAuth(): AuthUser | null {
  const user = localStorage.getItem(USER_KEY);
  if (!user) return null;
  try {
    return JSON.parse(user) as AuthUser;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem("theme");
  localStorage.removeItem("clauseiq_remembered_email");
  sessionStorage.removeItem(SESSION_FLAG);
  if (_inactivityTimer) clearTimeout(_inactivityTimer);
  invalidateCache("/");
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem(USER_KEY);
}

export async function verifySession(): Promise<boolean> {
  try {
    const res = await fetch(
      (import.meta.env.VITE_API_URL ?? "/api/v1") + "/auth/me",
      { method: "GET", credentials: "include" }
    );
    if (res.status === 401) {
      clearAuth();
      return false;
    }
    if (res.ok) markSessionActive();
    return res.ok;
  } catch {
    return false;
  }
}
