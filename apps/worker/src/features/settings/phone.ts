// Changing the sign-in phone number from Settings (migration 0066). Two steps, both proven by a code sent to the NEW number:
// 1. updateUser({ phone }) stores the pending number and sends the code; 2. verifyOtp({ type: 'phone_change' }) moves the
// account only when the code is right. Nothing changes if the worker stops half way. Injectable client for unit tests.
import { authErrorKey } from '../auth/errors.ts';
import { normalizePhone } from '../auth/validation.ts';

type AuthError = { name?: string; code?: string; status?: number; message?: string } | null;
export type PhoneClient = {
  updatePhone(phone: string): PromiseLike<{ error: AuthError }>;
  verifyChange(phone: string, token: string): PromiseLike<{ error: AuthError }>;
};

export type PhoneErrorKey =
  | 'settings.errors.phoneInvalid'
  | 'settings.errors.phoneSame'
  | 'settings.errors.phoneTaken'
  | 'auth.errors.tooManyRequests'
  | 'auth.errors.wrongOrExpiredCode'
  | 'auth.errors.sendFailed'
  | 'auth.errors.network'
  | 'auth.errors.generic';
export type PhoneResult = { ok: true; phone: string } | { ok: false; key: PhoneErrorKey };

function keyFor(error: NonNullable<AuthError>): PhoneErrorKey {
  const text = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  if (error.code === 'phone_exists' || text.includes('already been registered') || text.includes('phone_exists')) return 'settings.errors.phoneTaken';
  return authErrorKey(error);
}

async function run(call: () => PromiseLike<{ error: AuthError }>): Promise<AuthError> {
  try {
    return (await call()).error;
  } catch (thrown) {
    return { name: thrown instanceof Error ? thrown.name : 'Error', message: 'network request failed' };
  }
}

/** Step 1. `typed` is what the worker typed (any common way of writing a mobile); `current` is the number now on the account. */
export async function requestPhoneChange(client: PhoneClient, typed: string, current: string | null | undefined): Promise<PhoneResult> {
  const phone = normalizePhone(typed);
  if (!phone) return { ok: false, key: 'settings.errors.phoneInvalid' };
  if (phone === (current ?? '').trim()) return { ok: false, key: 'settings.errors.phoneSame' };
  const error = await run(() => client.updatePhone(phone));
  return error ? { ok: false, key: keyFor(error) } : { ok: true, phone };
}

/** Step 2. The server moves the account only if the code is right. */
export async function confirmPhoneChange(client: PhoneClient, phone: string, code: string): Promise<PhoneResult> {
  if (!/^\d{6}$/.test(code)) return { ok: false, key: 'auth.errors.wrongOrExpiredCode' };
  const error = await run(() => client.verifyChange(phone, code));
  return error ? { ok: false, key: keyFor(error) } : { ok: true, phone };
}
