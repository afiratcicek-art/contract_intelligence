/**
 * useUnsavedGuard — warns before the tab is closed, reloaded or hard-redirected
 * while a form still holds work the server has not accepted.
 *
 * Covers the session-expiry path too: api.ts sends the user to the login screen
 * with window.location.href, which fires beforeunload.
 *
 * In-app <Link>/navigate() transitions are NOT intercepted — BrowserRouter is not
 * a data router, so useBlocker is unavailable.
 *
 * Usage:
 *   useUnsavedGuard(dirty && !saving);
 */
import { useEffect } from "react";

export function useUnsavedGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers key off returnValue; the string itself is never shown.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
