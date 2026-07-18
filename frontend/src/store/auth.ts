import { invalidateCache } from "../services/api";

const USER_KEY = "clauseiq_user";
const INACTIVITY_MS = 4 * 60 * 60 * 1000; // 4 hours

let _inactivityTimer: ReturnType<typeof setTimeout> | null = null;

function resetInactivityTimer(): void {
  if (_inactivityTimer) clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(() => {
    clearAuth();
    window.location.href = loginRedirectUrl();
  }, INACTIVITY_MS);
}

/**
 * Where to send a user whose session ended WITHOUT them asking for it:
 * the guard in router.tsx, the 401 handlers in services/api.ts, and the
 * inactivity timer below. Returns "/login?next=<current path>" so that
 * Login can put them back where they were going.
 *
 * Reads window.location rather than useLocation on purpose: two of the three
 * callers (api.ts, the timer) run outside the React Router tree, where
 * useLocation does not exist. One helper, three callers, no duplication.
 *
 * NOT FOR LOGOUT. A user who pressed "log out" must get a bare "/login" —
 * see handleLogout in Workspace.tsx / RFIDetail.tsx / ChangeDetail.tsx. On a
 * shared machine, carrying the target would drop the next person onto the
 * previous user's document the moment they sign in.
 */
export function loginRedirectUrl(): string {
  const { pathname, search, hash } = window.location;
  if (pathname === "/login") return "/login";
  const target = pathname + search + hash;
  if (target === "/dashboard") return "/login";
  return "/login?next=" + encodeURIComponent(target);
}

/**
 * Validate a "?next=" value before navigating to it.
 *
 * SECURITY — this validation is the reason this function exists. "next" comes
 * from the URL, which means it comes from anyone who can get a user to click a
 * link. An unvalidated redirect fires immediately after the user authenticates,
 * which is the moment they trust the screen most:
 *     ?next=https://evil.example/  -> credential phishing on a lookalike page
 *     ?next=//evil.example         -> protocol-relative, same result
 *     ?next=/\evil.example         -> some browsers normalise this to //
 *     ?next=javascript:...         -> script execution
 * Only same-origin, absolute-path, relative targets pass. Everything else
 * falls back to /dashboard. Fail closed: when in doubt, dashboard.
 */
export function safeNextPath(raw: string | null): string {
  const FALLBACK = "/dashboard";
  if (!raw) return FALLBACK;
  // raw arrives ALREADY DECODED — the only caller is
  // Login.tsx's URLSearchParams.get("next"), and URLSearchParams decodes for
  // you. Do not add decodeURIComponent here: that would be a second decode and
  // would corrupt any path containing a literal % (e.g. "/x?f=a%25b" would
  // become "/x?f=a%b"). If you ever call this with a raw, still-encoded value,
  // decode it at the call site, not here.
  const value = raw;
  if (!value.startsWith("/")) return FALLBACK;     // absolute URL or a scheme
  if (value.startsWith("//")) return FALLBACK;     // protocol-relative
  if (value.startsWith("/\\")) return FALLBACK;    // normalised to // by some browsers
  if (value.startsWith("/login")) return FALLBACK; // no redirect loop
  return value;
}

export function markSessionActive(): void {
  resetInactivityTimer();
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
