'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { confirmResetAction, type ResetState } from '../reset-actions';

const initial: ResetState = {};

export function ResetForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(confirmResetAction, initial);
  return (
    <form className="si-form" action={action} noValidate>
      <div>
        <h2>Choose a new password</h2>
        <p>
          We emailed a six-digit code to <b>{email}</b>. It works for 10 minutes. Check your spam folder too.
        </p>
      </div>
      {state.error ? (
        <div className="si-alert err" role="alert">
          {state.error}
          {state.restart ? (
            <>
              {' '}
              <Link className="si-link" href="/signin/forgot">
                Ask for a new code
              </Link>
            </>
          ) : null}
        </div>
      ) : null}
      <label className="fld">
        Six-digit code
        <input className="inp si-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" required autoFocus />
      </label>
      <label className="fld">
        New password
        <input className="inp" type="password" name="password" placeholder="At least 12 characters" autoComplete="new-password" maxLength={200} required />
      </label>
      <label className="fld">
        New password again
        <input className="inp" type="password" name="confirm" placeholder="Type it again" autoComplete="new-password" maxLength={200} required />
      </label>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save new password'}
      </button>
      <p className="si-foot">
        <Link className="si-link" href="/signin/forgot">
          Send a new code
        </Link>
        {' · '}
        <Link className="si-link" href="/signin">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
