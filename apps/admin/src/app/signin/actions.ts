'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  cleanCode,
  cleanEmail,
  codeMessage,
  factorName,
  GENERIC_SIGN_IN_ERROR,
  markMessage,
  registerMessage,
  sendMessage,
  totpVerifyMessage,
  validPassword,
} from '@/features/auth/messages';
import { startActivity } from '@/lib/activity';
import { isUuid } from '@/lib/json';
import { parseStatus } from '@/lib/status';
import { publicEnv } from '@/lib/env';
import { safeNext } from '@/lib/stepup';
import { createClient } from '@/lib/supabase/server';
import { clientIp, verifyTurnstile } from '@/lib/turnstile';

export type FormState = { error?: string; info?: string };
/** The state of the "set up an authenticator" step: the QR code and the key to type by hand, once they exist. */
export type EnrollState = FormState & { factorId?: string; qr?: string; secret?: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Asks the admin-2fa function to email a code. The emailed code only proves the mailbox, for setting up an authenticator. Returns an error text, or null when a code was sent. */
async function requestCode(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return sendMessage(401);
  const { url, anonKey } = publicEnv();
  try {
    const res = await fetch(`${url}/functions/v1/admin-2fa`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, apikey: anonKey, 'content-type': 'application/json' },
      body: '{}',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? null : sendMessage(res.status);
  } catch {
    return sendMessage(500);
  }
}

/**
 * Checks an authenticator code with Supabase Auth (the session becomes aal2), then asks the database to mark the
 * session verified (and fresh for 15 minutes). The database decides: it needs the registered authenticator, a code typed
 * in the last 2 minutes, and fewer than 10 wrong attempts lately. Returns an error text, or null on success.
 */
async function checkAuthenticatorCode(supabase: Supabase, factorId: string, code: string): Promise<string | null> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return totpVerifyMessage(error);
  const { data: marked } = await supabase.rpc('admin_mark_session_verified');
  return marked === 'ok' ? null : markMessage(marked);
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = cleanEmail(formData.get('email'));
  const password = formData.get('password');
  if (!email || !validPassword(password)) return { error: GENERIC_SIGN_IN_ERROR };

  // Bot check first (Cloudflare Turnstile, verified here on the server). It never says which of the two checks failed.
  const h = await headers();
  const ip = clientIp((name) => h.get(name));
  const human = await verifyTurnstile({ fetch, secret: process.env.TURNSTILE_SECRET_KEY, nodeEnv: process.env.NODE_ENV }, formData.get('cf-turnstile-response'), ip);
  if (!human) return { error: 'Complete the security check and try again.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: GENERIC_SIGN_IN_ERROR };

  // Anyone who is not an admin account is signed straight back out, with the same message as a wrong password.
  const { data: status } = await supabase.rpc('admin_session_status');
  if (parseStatus(status) === 'not_admin') {
    await supabase.auth.signOut();
    return { error: GENERIC_SIGN_IN_ERROR };
  }
  // Start the idle clock now (the proxy ends a signed-in session that has no activity cookie when an idle limit is on).
  await startActivity();
  if (parseStatus(status) === 'verified') redirect('/dashboard');

  // Password done. An admin with a registered authenticator types its code next. Without one, the person first proves
  // the mailbox with an emailed code and then sets the authenticator up.
  const { data: totp } = await supabase.rpc('admin_totp_status');
  if (totp === 'enrolled') redirect('/signin/code');
  const failure = await requestCode();
  redirect(failure ? '/signin/enroll?s=notsent' : '/signin/enroll');
}

/** Sign-in step 2: the code from the authenticator app. */
export async function verifyTotpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = cleanCode(formData.get('code'));
  if (!code) return { error: 'Enter the six-digit code from your authenticator app.' };
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect('/signin');
  const { data: factorId } = await supabase.rpc('admin_totp_factor');
  if (!isUuid(factorId)) redirect('/signin/enroll');
  const failure = await checkAuthenticatorCode(supabase, factorId, code);
  if (failure) return { error: failure };
  redirect('/dashboard');
}

/** Emails a code that proves the mailbox (needed to set up or replace an authenticator). */
export async function resendCodeAction(): Promise<FormState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/signin');
  const failure = await requestCode();
  return failure ? { error: failure } : { info: 'A new code is on its way. It works for 10 minutes.' };
}

/** Checks the emailed code. It does not sign anyone in: it only allows the authenticator setup that follows. */
export async function verifyCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = cleanCode(formData.get('code'));
  if (!code) return { error: 'Enter the six-digit code from the email.' };
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect('/signin');
  const { data, error } = await supabase.rpc('admin_verify_code', { p_code: code });
  if (error) redirect('/signin');
  if (data === 'ok') redirect('/signin/enroll');
  return { error: codeMessage(data) };
}

/** Setup step A: creates the authenticator entry and returns its QR code and key. Needs the emailed-code proof. */
export async function startEnrollAction(): Promise<EnrollState> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect('/signin');
  const { data: proven } = await supabase.rpc('admin_enroll_proof_status');
  if (proven !== true) redirect('/signin/enroll');
  // Remove every earlier authenticator of this account first (an unfinished setup, a lost phone, or one a stranger who knew
  // only the password enrolled to block the real person). The database allows this only after the emailed-code proof.
  const { error: resetError } = await supabase.rpc('admin_reset_totp');
  if (resetError) return { error: 'The setup could not be started. Confirm your email again and retry.' };
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: factorName(), issuer: 'DHA Works Admin' });
  if (error || !data) return { error: 'The setup could not be started. Try again in a moment.' };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Setup step B: the first code from the new authenticator. Verifies it, registers it, and signs the person in. */
export async function finishEnrollAction(prev: EnrollState, formData: FormData): Promise<EnrollState> {
  const code = cleanCode(formData.get('code'));
  const factorId = formData.get('factorId');
  if (!code) return { ...prev, error: 'Enter the six-digit code from your authenticator app.' };
  if (!isUuid(factorId)) return { error: 'The setup could not be completed. Start again.' };
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect('/signin');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ...prev, error: totpVerifyMessage(error) };
  const { data: registered } = await supabase.rpc('admin_register_totp', { p_factor: factorId });
  if (registered === 'proof') redirect('/signin/enroll');
  if (registered !== 'ok') return { error: registerMessage(registered) };
  const { data: marked } = await supabase.rpc('admin_mark_session_verified');
  if (marked !== 'ok') return { error: markMessage(marked) };
  redirect('/dashboard');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/signin');
}

/** Step-up: a code from the authenticator app for a sensitive action; returns to the page the person came from (only a path inside the portal). */
export async function stepUpVerifyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = cleanCode(formData.get('code'));
  if (!code) return { error: 'Enter the six-digit code from your authenticator app.' };
  const supabase = await createClient();
  const { data: status } = await supabase.rpc('admin_session_status');
  const st = parseStatus(status);
  if (st === 'needs_code') redirect('/signin/code');
  if (st !== 'verified') redirect('/signin');
  const { data: factorId } = await supabase.rpc('admin_totp_factor');
  if (!isUuid(factorId)) redirect('/signin/enroll');
  const failure = await checkAuthenticatorCode(supabase, factorId, code);
  if (failure) return { error: failure };
  redirect(safeNext(formData.get('next')));
}
