// Checks for the settings form. The database repeats them (migration 0042).
export const HELPLINE_PATTERN = /^[0-9+ -]{3,20}$/;
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type Check = { ok: true } | { ok: false; hint: string };

export function checkSettings(v: { number: string; enabled: boolean; reportDays: number; reviewDays: number }): Check {
  const n = v.number.trim();
  if (n !== '' && !HELPLINE_PATTERN.test(n)) return { ok: false, hint: 'The helpline number can only have digits, spaces, + and - (3 to 20 characters).' };
  if (v.enabled && n === '') return { ok: false, hint: 'Enter the helpline number before showing it in the apps.' };
  if (!Number.isInteger(v.reportDays) || v.reportDays < 1 || v.reportDays > 30) return { ok: false, hint: 'The report window must be 1 to 30 days.' };
  if (!Number.isInteger(v.reviewDays) || v.reviewDays < 1 || v.reviewDays > 30) return { ok: false, hint: 'The review window must be 1 to 30 days.' };
  return { ok: true };
}

export function checkInviteEmail(email: string): Check {
  const e = email.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_PATTERN.test(e)) return { ok: false, hint: 'Enter a valid email address.' };
  return { ok: true };
}

/**
 * The page a new staff member opens to create their password. The token is shown once to the inviter. It sits after
 * the "#" on purpose: a browser never sends that part to the server, so it cannot end up in hosting or proxy logs.
 */
export function inviteLink(origin: string, email: string, token: string): string {
  return `${origin}/accept-invite?${new URLSearchParams({ email }).toString()}#${new URLSearchParams({ token }).toString()}`;
}

const TOKEN_PATTERN = /^[0-9a-f]{20,100}$/i;

/** The invitation token from a URL fragment ("#token=..."), or null when it is missing or not a plain hex token. */
export function tokenFromHash(hash: string | null | undefined): string | null {
  if (typeof hash !== 'string' || hash.length > 300) return null;
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return value !== null && TOKEN_PATTERN.test(value) ? value : null;
}

export const PASSWORD_MIN = 12;

export function checkNewPassword(password: string, confirm: string): Check {
  if (password.length < PASSWORD_MIN) return { ok: false, hint: `Use at least ${PASSWORD_MIN} characters.` };
  if (password.length > 72) return { ok: false, hint: 'Use 72 characters at most.' };
  if (password !== confirm) return { ok: false, hint: 'The two passwords are not the same.' };
  return { ok: true };
}
