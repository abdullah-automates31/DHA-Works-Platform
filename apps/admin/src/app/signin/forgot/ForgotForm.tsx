'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Turnstile, useTurnstileReady } from '@/components/Turnstile';
import { requestResetAction, type ResetState } from '../reset-actions';

const initial: ResetState = {};

export function ForgotForm({ siteKey, nonce }: { siteKey: string | null; nonce?: string }) {
  const [state, action, pending] = useActionState(requestResetAction, initial);
  const check = useTurnstileReady(siteKey);
  return (
    <form className="si-form" action={action} onSubmit={check.onSubmit} noValidate>
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
          <Turnstile siteKey={siteKey} nonce={nonce} resetSignal={state} onOk={check.onOk} onGone={check.onGone} />
          {check.slow && !check.ready ? (
            <div className="si-alert err" role="status">
              The security check is taking long. Reload the page, and turn off any ad blocker for this site.
            </div>
          ) : null}
        </>
      ) : null}
      <button className="btn" type="submit" disabled={pending || !check.ready}>
        {pending ? 'Sending...' : !check.ready ? 'Checking you are human...' : 'Send me a code'}
      </button>
      <p className="si-foot">
        <Link className="si-link" href="/signin">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
