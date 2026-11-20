'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useActionState } from 'react';
import { requestResetAction, type ResetState } from '../reset-actions';

const initial: ResetState = {};

export function ForgotForm({ siteKey, nonce }: { siteKey: string | null; nonce?: string }) {
  const [state, action, pending] = useActionState(requestResetAction, initial);
  return (
    <form className="si-form" action={action} noValidate>
      <div>
        <h2>Reset your password</h2>
        <p>Enter your work email. If it belongs to an admin account, we email a six-digit code.</p>
      </div>
      {state.error ? (
        <div className="si-alert err" role="alert">
          {state.error}
        </div>
      ) : null}
      <label className="fld">
        Work email
        <input className="inp" type="email" name="email" placeholder="name@dha-works.example" autoComplete="username" maxLength={254} required autoFocus />
      </label>
      {siteKey ? (
        <>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" nonce={nonce} />
          <div className="cf-turnstile" data-sitekey={siteKey} data-theme="light" />
        </>
      ) : null}
      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Sending...' : 'Send me a code'}
      </button>
      <p className="si-foot">
        <Link className="si-link" href="/signin">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
