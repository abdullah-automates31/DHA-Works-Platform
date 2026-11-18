'use client';

import { useActionState, useTransition } from 'react';
import { resendCodeAction, signOutAction, verifyCodeAction, type FormState } from '../actions';

const initial: FormState = {};
type ResendState = FormState & { at?: string };

/** The time of the last "Send a new code" answer, so pressing it again always shows a visible change. */
function timeNow(): string {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function CodeForm({ notSent }: { notSent: boolean }) {
  const [state, action, pending] = useActionState(verifyCodeAction, initial);
  const [resend, startResend] = useTransition();
  const [resendState, resendAction, resendPending] = useActionState<ResendState>(async () => ({ ...(await resendCodeAction()), at: timeNow() }), initial);
  const sending = resend || resendPending;

  return (
    <div className="si-form">
      <div>
        <h2>Enter your code</h2>
        <p>We emailed a six-digit code to your work address. It works for 10 minutes.</p>
      </div>
      {sending ? (
        <div className="si-alert ok" role="status" aria-live="polite">
          Sending a new code...
        </div>
      ) : null}
      {!sending && notSent && !resendState.info && !resendState.error ? (
        <div className="si-alert err">The code could not be sent. Press &ldquo;Send a new code&rdquo; below.</div>
      ) : null}
      {!sending && state.error && !resendState.info && !resendState.error ? (
        <div className="si-alert err" role="alert">
          {state.error}
        </div>
      ) : null}
      {!sending && resendState.error ? (
        <div key={resendState.at} className="si-alert err" role="alert">
          {resendState.error} (tried at {resendState.at})
        </div>
      ) : null}
      {!sending && resendState.info ? (
        <div key={resendState.at} className="si-alert ok" role="status" aria-live="polite">
          {resendState.info} Sent at {resendState.at}. Check your inbox and spam folder.
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
        <button
          className="si-link"
          type="button"
          disabled={sending}
          aria-busy={sending}
          onClick={() => startResend(() => resendAction())}
        >
          {sending ? 'Sending...' : 'Send a new code'}
        </button>
        {' · '}
        <button className="si-link" type="button" onClick={() => void signOutAction()}>
          Use a different account
        </button>
      </p>
    </div>
  );
}
