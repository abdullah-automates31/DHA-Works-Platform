'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cleanCode, cleanEmail, codeMessage, GENERIC_SIGN_IN_ERROR, sendMessage, validPassword } from '@/features/auth/messages';
import { startActivity } from '@/lib/activity';
import { parseStatus } from '@/lib/status';
import { publicEnv } from '@/lib/env';
import { safeNext } from '@/lib/stepup';
import { createClient } from '@/lib/supabase/server';
import { clientIp, verifyTurnstile } from '@/lib/turnstile';

export type FormState = { error?: string; info?: string };

/** Asks the admin-2fa function to email a code. Returns an error text, or null when a code was sent. */
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
  // Start the idle clock now (the proxy ends a signed-in session that has no activity cookie).
  await startActivity();
  if (parseStatus(status) === 'verified') redirect('/dashboard');

  const failure = await requestCode();
  redirect(failure ? `/signin/code?s=${encodeURIComponent('notsent')}` : '/signin/code');
}

export async function resendCodeAction(): Promise<FormState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/signin');
  const failure = await requestCode();
  return failure ? { error: failure } : { info: 'A new code is on its way. It works for 10 minutes.' };
}

export async function verifyCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = cleanCode(formData.get('code'));
  if (!code) return { error: 'Enter the six-digit code from the email.' };
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect('/signin');
  const { data, error } = await supabase.rpc('admin_verify_code', { p_code: code });
  if (error) redirect('/signin');
  if (data === 'ok') redirect('/dashboard');
  return { error: codeMessage(data) };
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/signin');
}

/** Step-up: asks for a new code for an already verified session (sensitive actions, migration 0048). */
export async function stepUpResendAction(): Promise<FormState> {
  const supabase = await createClient();
  const { data: status } = await supabase.rpc('admin_session_status');
  const st = parseStatus(status);
  if (st === 'needs_code') redirect('/signin/code');
  if (st !== 'verified') redirect('/signin');
  const failure = await requestCode();
  return failure ? { error: failure } : { info: 'A new code is on its way. It works for 10 minutes.' };
}

/** Step-up: checks the code and returns to the page the person came from (only a path inside the portal). */
export async function stepUpVerifyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = cleanCode(formData.get('code'));
  if (!code) return { error: 'Enter the six-digit code from the email.' };
  const supabase = await createClient();
  const { data: status } = await supabase.rpc('admin_session_status');
  const st = parseStatus(status);
  if (st === 'needs_code') redirect('/signin/code');
  if (st !== 'verified') redirect('/signin');
  const { data, error } = await supabase.rpc('admin_verify_code', { p_code: code });
  if (error) redirect('/signin');
  if (data === 'ok') redirect(safeNext(formData.get('next')));
  return { error: codeMessage(data) };
}

