'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { PasswordInput } from '@/components/PasswordInput';
import { Turnstile, useTurnstileReady } from '@/components/Turnstile';
import { signInAction, type FormState } from './actions';

const initial: FormState = {};

export function SignInForm({ notAdmin, siteKey, nonce }: { notAdmin: boolean; siteKey: string | null; nonce?: string }) {
  const [state, action, pending] = useActionState(signInAction, initial);
  const check = useTurnstileReady(siteKey);
  return (
    <form className="si-form" action={action} onSubmit={check.onSubmit} noValidate>
      <div>
        <h2>Staff sign in</h2>
        <p>Only DHA staff with an admin account can sign in.</p>
      </div>
      {notAdmin && !state.error ? <div className="si-alert err">That account cannot use the portal.</div> : null}
      {state.error ? (
        <div className="si-alert err" role="alert">
          {state.error}
        </div>
      ) : null}
      <label className="fld">
        Work email
        <input className="inp" type="email" name="email" placeholder="name@dha-works.example" autoComplete="username" maxLength={254} required />
      </label>
      <label className="fld">
        Password
        <PasswordInput name="password" placeholder="Enter your password" autoComplete="current-password" maxLength={200} required />
      </label>
      <p className="si-foot" style={{ textAlign: 'right', marginTop: -6 }}>
        <Link className="si-link" href="/signin/forgot">
          Forgot password?
        </Link>
      </p>
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
        {pending ? 'Signing in...' : !check.ready ? 'Checking you are human...' : 'Sign in'}
      </button>
      <p className="si-foot">No account? Ask the DHA Works administrator to add you.</p>
    </form>
  );
}
