'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cleanCode, cleanEmail } from '@/features/auth/messages';
import { checkResetPassword, confirmOutcome, requestOutcome, RESET_COOKIE, RESET_COOKIE_SECONDS } from '@/features/auth/reset';
import { sessionCookie } from '@/lib/cookies';
import { publicEnv } from '@/lib/env';

export type ResetState = { error?: string; restart?: boolean };

/** Calls the admin-password-reset function (not signed in: only the public key). Returns the HTTP status and the JSON body. */
async function callReset(body: Record<string, unknown>): Promise<{ http: number; json: Record<string, unknown> }> {
  const { url, anonKey } = publicEnv();
  try {
    const res = await fetch(`${url}/functions/v1/admin-password-reset`, {
      method: 'POST',
      headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { http: res.status, json: json && typeof json === 'object' ? json : {} };
  } catch {
    return { http: 500, json: {} };
  }
}

/** Step 1: the email and the bot check. The function emails the code only if this is an active admin account. */
export async function requestResetAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const email = cleanEmail(formData.get('email'));
  if (!email) return { error: 'Enter a valid email address.' };
  const token = formData.get('cf-turnstile-response');
  const { http, json } = await callReset({ action: 'request', email, turnstile: typeof token === 'string' ? token : '' });
  const outcome = requestOutcome(json.status, http);
  if (!outcome.ok) return { error: outcome.error };
  // The email travels to the next page in an HttpOnly cookie, not in the address (an address ends up in logs and history).
  const store = await cookies();
  store.set(RESET_COOKIE, email, { ...sessionCookie(undefined), maxAge: RESET_COOKIE_SECONDS });
  redirect('/signin/reset');
}

/** Step 2: the code and the new password. Success ends every session of that account; the person signs in again. */
export async function confirmResetAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const store = await cookies();
  const email = cleanEmail(store.get(RESET_COOKIE)?.value);
  if (!email) redirect('/signin/forgot');
  const code = cleanCode(formData.get('code'));
  if (!code) return { error: 'Enter the six-digit code from the email.' };
  const password = formData.get('password');
  const problem = checkResetPassword(password, formData.get('confirm'));
  if (problem) return { error: problem };

  const { http, json } = await callReset({ action: 'confirm', email, code, password });
  const outcome = confirmOutcome(json.status, http);
  if (!outcome.done) return { error: outcome.error, restart: outcome.restart };
  store.set(RESET_COOKIE, '', { ...sessionCookie(undefined), maxAge: 0 });
  redirect('/signin?e=reset');
}
