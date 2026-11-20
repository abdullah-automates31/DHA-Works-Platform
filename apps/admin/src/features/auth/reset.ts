// Pure rules for "Forgot password?" (migration 0068): what each answer from the admin-password-reset function says.
import { PASSWORD_MIN } from '../settings/rules.ts';

/** The HttpOnly cookie that carries the email between the "ask for a code" page and the "enter the code" page. */
export const RESET_COOKIE = 'dha_reset_email';
export const RESET_COOKIE_SECONDS = 15 * 60;

export type ResetRequestOutcome = { ok: true } | { ok: false; error: string };

/** What the function said when asked to email a code. `httpStatus` is used when the body has no usable status. */
export function requestOutcome(status: unknown, httpStatus: number): ResetRequestOutcome {
  if (httpStatus === 403) return { ok: false, error: 'Complete the security check and try again.' };
  if (httpStatus === 400) return { ok: false, error: 'Enter a valid email address.' };
  if (httpStatus === 200 && status === 'sent') return { ok: true };
  if (httpStatus === 200 && status === 'not_admin') return { ok: false, error: 'This email is not registered as an admin account.' };
  if (httpStatus === 200 && status === 'wait') return { ok: false, error: 'A code was sent a moment ago. Wait a minute, then ask again.' };
  if (httpStatus === 200 && status === 'limit') return { ok: false, error: 'Too many codes were requested this hour. Try again later.' };
  return { ok: false, error: 'The code could not be sent. Try again in a minute, or ask another administrator for help.' };
}

export type ResetConfirmOutcome = { done: true } | { done: false; error: string; restart?: boolean };

/** What the function said about the code and the new password. */
export function confirmOutcome(status: unknown, httpStatus: number): ResetConfirmOutcome {
  if (httpStatus === 200 && status === 'ok') return { done: true };
  if (httpStatus === 200 && status === 'wrong') return { done: false, error: 'That code is not right. Check the email and try again.' };
  if (httpStatus === 200 && status === 'locked') return { done: false, error: 'Too many wrong codes. Ask for a new code and try again.', restart: true };
  if (httpStatus === 200 && status === 'expired') return { done: false, error: 'That code has expired. Ask for a new one.', restart: true };
  if (httpStatus === 200 && status === 'none') return { done: false, error: 'There is no open code for this email. Ask for a new one.', restart: true };
  if (httpStatus === 200 && status === 'weak') {
    return { done: false, error: `That password cannot be used. Use ${PASSWORD_MIN} to 72 characters, and not your email address.` };
  }
  return { done: false, error: 'The password could not be changed. Try again in a minute.' };
}

/** The new password and its repeat, checked before anything is sent. Null means fine. The database checks again. */
export function checkResetPassword(password: unknown, confirm: unknown): string | null {
  if (typeof password !== 'string' || typeof confirm !== 'string') return 'Enter the new password twice.';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(password).length > 72) return 'Use 72 characters at most.';
  if (password !== confirm) return 'The two passwords are not the same.';
  return null;
}
