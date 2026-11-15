'use client';

import { useActionState, useTransition } from 'react';
import { resendCodeAction, signOutAction, verifyCodeAction, type FormState } from '../actions';

const initial: FormState = {};

export function CodeForm({ notSent }: { notSent: boolean }) {
  const [state, action, pending] = useActionState(verifyCodeAction, initial);
  const [resend, startResend] = useTransition();
  const [resendState, resendAction] = useActionState(async () => resendCodeAction(), initial);

  return (
    <div className="si-form">
      <div>
        <h2>Enter your code</h2>
        <p>We emailed a six-digit code to your work address. It works for 10 minutes.</p>
      </div>
      {notSent && !resendState.info && !resendState.error ? (
        <div className="si-alert err">The code could not be sent. Press &ldquo;Send a new code&rdquo; below.</div>
      ) : null}
      {state.error && !resendState.info ? (
        <div className="si-alert err" role="alert">
          {state.error}
        </div>
      ) : null}
      {resendState.error ? (
        <div className="si-alert err" role="alert">
          {resendState.error}
        </div>
      ) : null}
      {resendState.info ? <div className="si-alert ok">{resendState.info}</div> : null}
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
        <button
          className="si-link"
          type="button"
          disabled={resend}
          onClick={() => startResend(() => resendAction())}
        >
          Send a new code
        </button>
        {' · '}
        <button className="si-link" type="button" onClick={() => void signOutAction()}>
          Use a different account
        </button>
      </p>
    </div>
  );
}
