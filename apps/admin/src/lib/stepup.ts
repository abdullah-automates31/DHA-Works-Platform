// Step-up: sensitive actions need a code typed in the last 15 minutes (migration 0048). The database answers
// "confirm with a new code" (P0001); the portal then sends the person to /confirm and back to the page they were on.

/** The exact refusal text the database raises when the session is verified but not fresh. */
export const STEP_UP_MESSAGE = 'confirm with a new code';

export function isStepUpRefusal(error: { code?: string | null; message?: string | null } | null): boolean {
  return !!error && error.code === 'P0001' && error.message === STEP_UP_MESSAGE;
}

/**
 * Where to return after confirming. Only a path inside the portal is accepted: it must start with one slash, contain no
 * second slash at the start, no backslash, no control characters and no scheme, and must not be the sign-in or confirm
 * pages. Anything else falls back to the dashboard, so the parameter cannot be used as an open redirect.
 */
export function safeNext(value: unknown): string {
  const fallback = '/dashboard';
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (/^\/(signin|confirm|accept-invite)(\/|\?|$)/.test(value)) return fallback;
  try {
    const url = new URL(value, 'http://portal.invalid');
    if (url.origin !== 'http://portal.invalid') return fallback;
  } catch {
    return fallback;
  }
  return value;
}

/** The page a form lives on, taken from the Referer header of the action request (same site only). */
export function pathFromReferer(referer: string | null, host: string | null): string {
  if (!referer || !host) return '/dashboard';
  try {
    const url = new URL(referer);
    if (url.host !== host) return '/dashboard';
    return safeNext(url.pathname + url.search);
  } catch {
    return '/dashboard';
  }
}
