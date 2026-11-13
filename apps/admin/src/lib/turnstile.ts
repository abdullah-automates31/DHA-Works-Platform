// Cloudflare Turnstile check for the password step, done on the server (docs/SECURITY.md section 18).
// Supabase's own CAPTCHA setting is project-wide and would also block the worker and customer apps, so it stays off;
// the portal verifies the widget's token itself before it calls Supabase. Limit: someone who calls Supabase's auth API
// directly skips this form, but a password alone opens nothing (the emailed code is needed) and Supabase rate-limits it.

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileMode = 'off' | 'required';

/**
 * 'required' when a secret is configured. With no secret it is 'off' in development and on a build that is not
 * production; a production build with no secret also counts as 'required' so a missing setting fails closed
 * (everyone is refused until it is set) instead of silently skipping the check.
 */
export function turnstileMode(secret: string | undefined, nodeEnv: string | undefined): TurnstileMode {
  if (secret && secret.length > 0) return 'required';
  return nodeEnv === 'production' ? 'required' : 'off';
}

/**
 * The visitor's address for Cloudflare's risk check, or null. Only headers that the hosting platform sets itself are
 * used (Vercel overwrites x-vercel-forwarded-for and x-real-ip; a visitor cannot choose them there). The first entry of
 * x-forwarded-for is NOT used: a visitor can send that header, and an invented address would skew the check. The value
 * must look like an IPv4 or IPv6 address, or it is dropped. The address is optional for Cloudflare, so null is safe.
 */
export function clientIp(get: (name: string) => string | null | undefined): string | null {
  for (const name of ['x-vercel-forwarded-for', 'x-real-ip']) {
    const v = get(name)?.split(',')[0]?.trim();
    if (v && v.length <= 45 && (/^\d{1,3}(\.\d{1,3}){3}$/.test(v) || /^[0-9a-f:]+$/i.test(v) && v.includes(':'))) return v;
  }
  return null;
}

export type SiteverifyResult = { ok: boolean };

/** Reads Cloudflare's answer. Anything that is not an explicit `success: true` counts as a failure. */
export function parseSiteverify(body: unknown): SiteverifyResult {
  if (body !== null && typeof body === 'object' && (body as { success?: unknown }).success === true) return { ok: true };
  return { ok: false };
}

export async function verifyTurnstile(
  deps: { fetch: typeof fetch; secret: string | undefined; nodeEnv: string | undefined },
  token: unknown,
  remoteIp: string | null,
): Promise<boolean> {
  const mode = turnstileMode(deps.secret, deps.nodeEnv);
  if (mode === 'off') return true;
  if (!deps.secret) return false; // production without a secret: closed
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;
  try {
    const form = new URLSearchParams({ secret: deps.secret, response: token });
    if (remoteIp) form.set('remoteip', remoteIp);
    const res = await deps.fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    return parseSiteverify(await res.json()).ok;
  } catch {
    return false; // unreachable or malformed: closed
  }
}
