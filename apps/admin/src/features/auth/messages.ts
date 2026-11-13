// Pure rules for the staff sign-in: what is accepted as input and what each refusal says.
// Messages are deliberately vague about WHY a sign-in failed, so the form cannot be used to learn which emails are staff.

export const GENERIC_SIGN_IN_ERROR = 'Email or password is not correct, or this account cannot use the portal.';

export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200;
}

export function cleanCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.replace(/\s+/g, '');
  return /^[0-9]{6}$/.test(v) ? v : null;
}

/** What the database said about a code ('ok', 'wrong', 'locked', 'expired', 'none'). Anything else counts as wrong. */
export function codeMessage(status: unknown): string {
  switch (status) {
    case 'locked':
      return 'Too many wrong codes. Ask for a new code (you can do this once a minute).';
    case 'expired':
      return 'That code has expired. Ask for a new one.';
    case 'none':
      return 'There is no open code. Ask for a new one.';
    default:
      return 'That code is not right. Check the email and try again.';
  }
}

/** What the admin-2fa function answered when asked to email a code. */
export function sendMessage(httpStatus: number): string {
  if (httpStatus === 429) return 'A code was sent a moment ago. Wait a minute, then ask again. If you asked five times this hour, try later.';
  if (httpStatus === 403 || httpStatus === 401) return 'This session cannot request a code. Sign in again.';
  return 'The code could not be sent. Try again in a minute, or ask another administrator for help.';
}

/** What `admin_mark_session_verified` answered after a good authenticator code ('ok', 'locked', 'not_ready'). Anything else counts as "try again". */
export function markMessage(status: unknown): string {
  switch (status) {
    case 'locked':
      return 'Too many wrong codes. Wait 15 minutes, then try again.';
    case 'not_ready':
      return 'That code could not be used for this session. Wait for a new code in your app and try again.';
    default:
      return 'That could not be completed. Try again.';
  }
}

/** What Supabase Auth said when an authenticator code was checked. A wrong code and an unknown factor read the same. */
export function totpVerifyMessage(error: { code?: string | null; status?: number | null } | null | undefined): string {
  if (error && (error.status === 429 || error.code === 'over_request_rate_limit' || error.code === 'over_email_send_rate_limit')) {
    return 'Too many tries. Wait a minute, then try again.';
  }
  return 'That code is not right. Open your authenticator app and use the current code.';
}

/** What `admin_register_totp` answered ('ok', 'proof', 'invalid'). */
export function registerMessage(status: unknown): string {
  if (status === 'proof') return 'The emailed code has run out. Ask for a new code and start again.';
  return 'The authenticator could not be saved. Start the setup again.';
}

/** A name for a new authenticator entry: unique per attempt, because Supabase refuses two factors with the same name. */
export function factorName(now: number = Date.now()): string {
  return `DHA Works ${now.toString(36)}`;
}
