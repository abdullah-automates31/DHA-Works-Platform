// Idle logout: a signed-in staff member who does nothing for 30 minutes is signed out (Supabase's own session
// timebox needs a paid plan). Pure rules here; src/proxy.ts applies them with an HttpOnly cookie.

/** No idle logout (user decision, 14 Nov 2026): staff stay signed in until they sign out. A finite IDLE_LIMIT_SECONDS (5 or more) turns it back on for tests. */
export const IDLE_LIMIT_MS = Number.POSITIVE_INFINITY;
/** The activity cookie is refreshed at most once a minute, so ordinary browsing does not rewrite it on every request. */
export const IDLE_TOUCH_MS = 60 * 1000;
export const ACTIVE_COOKIE = 'dha_active';

/** The idle limit in milliseconds: the default, or a smaller test value from IDLE_LIMIT_SECONDS (never larger than the default). */
export function idleLimitMs(env: string | undefined): number {
  const n = Number(env);
  if (!env || !Number.isFinite(n) || n < 5) return IDLE_LIMIT_MS;
  return Math.min(IDLE_LIMIT_MS, n * 1000);
}

/** True when the last recorded activity is older than the limit. A missing or unreadable value is treated as "not idle yet" (the first request after sign-in sets it). */
export function idleExpired(lastMs: number | null, nowMs: number, limitMs: number = IDLE_LIMIT_MS): boolean {
  if (lastMs === null || !Number.isFinite(lastMs)) return false;
  return nowMs - lastMs > limitMs;
}

export function parseActive(value: string | undefined): number | null {
  if (!value || !/^[0-9]{10,15}$/.test(value)) return null;
  return Number(value);
}

/** True when a leftover activity cookie belongs to a session that is already over (manual sign-out, expired session): it must be cleared, or the next sign-in would read the old time and be signed straight out. */
export function staleActive(signedIn: boolean, lastMs: number | null): boolean {
  return !signedIn && lastMs !== null;
}

/** How often the activity cookie is rewritten: once a minute, or a third of a shorter limit (so a short test limit still works). */
export function touchIntervalMs(limitMs: number): number {
  return Math.min(IDLE_TOUCH_MS, Math.floor(limitMs / 3));
}

/** True when the cookie should be written again. */
export function shouldTouch(lastMs: number | null, nowMs: number, intervalMs: number = IDLE_TOUCH_MS): boolean {
  return lastMs === null || nowMs - lastMs >= intervalMs;
}

/**
 * True when a signed-in session has no readable activity cookie. Signing in sets it, so a missing (deleted) or damaged
 * one means the idle clock cannot be trusted: the session ends and the person signs in again. Without this, deleting
 * the cookie would have restarted the 30 minutes.
 */
export function activityMissing(signedIn: boolean, lastMs: number | null): boolean {
  return signedIn && (lastMs === null || !Number.isFinite(lastMs));
}
