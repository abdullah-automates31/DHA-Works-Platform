'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signOutAction, verifyTotpAction, type FormState } from '../actions';

const initial: FormState = {};

export function CodeForm() {
  const [state, action, pending] = useActionState(verifyTotpAction, initial);

  return (
    <div className="si-form">
      <div>
        <h2>Enter your code</h2>
        <p>Open your authenticator app and type the six-digit code for DHA Works Admin.</p>
      </div>
      {state.error ? (
        <div className="si-alert err" role="alert">
          {state.error}
        </div>
      ) : null}
      <form action={action} className="si-form" style={{ gap: 18 }} noValidate>
        <label className="fld">
          Six-digit code
          <input className="inp si-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" required autoFocus />
        </label>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? 'Checking...' : 'Continue'}
        </button>
      </form>
      <p className="si-foot">
        <Link className="si-link" href="/signin/enroll">
          I lost my phone
        </Link>
        {' · '}
        <button className="si-link" type="button" onClick={() => void signOutAction()}>
          Use a different account
        </button>
      </p>
    </div>
  );
}
