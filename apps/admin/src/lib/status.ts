export type SessionStatus = 'verified' | 'needs_code' | 'not_admin';

/** Only the two known statuses are trusted; anything else is treated as "not an admin". */
export function parseStatus(value: unknown): SessionStatus {
  return value === 'verified' || value === 'needs_code' ? value : 'not_admin';
}

/**
 * What to do when asking the database for the session status itself FAILED (as opposed to it answering "not_admin").
 * A rejected or expired token means "sign in again"; anything else (database or network trouble) is a temporary fault,
 * shown as "try again" instead of the misleading "that account cannot use the portal".
 */
export function statusFailure(error: { code?: string | null } | null | undefined): 'signin' | 'unavailable' | null {
  if (!error) return null;
  const code = error.code ?? '';
  if (code === '42501' || code.startsWith('PGRST3') || code === '28000') return 'signin';
  return 'unavailable';
}
