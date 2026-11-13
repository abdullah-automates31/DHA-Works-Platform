'use client';

import { useActionState, useState, useTransition } from 'react';
import { finishEnrollAction, resendCodeAction, signOutAction, startEnrollAction, verifyCodeAction, type EnrollState, type FormState } from '../actions';

const initial: FormState = {};

export function EnrollForm({ proven, replacing, notSent }: { proven: boolean; replacing: boolean; notSent: boolean }) {
  return proven ? <Setup replacing={replacing} /> : <ProveMailbox replacing={replacing} notSent={notSent} />;
}

/** Step 1: the emailed code. */
function ProveMailbox({ replacing, notSent }: { replacing: boolean; notSent: boolean }) {
  const [state, action, pending] = useActionState(verifyCodeAction, initial);
  const [resend, startResend] = useTransition();
  const [resendState, resendAction] = useActionState(async () => resendCodeAction(), initial);

  return (
    <div className="si-form">
      <div>
        <h2>{replacing ? 'Set up a new authenticator' : 'Set up your authenticator'}</h2>
        <p>
          {replacing
            ? 'To replace the authenticator app on your account, first confirm your email. '
            : 'Staff sign in with a code from an authenticator app. First confirm your email. '}
          We sent a six-digit code to your work address. It works for 10 minutes.
        </p>
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
          Six-digit code from the email
          <input className="inp si-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" required autoFocus />
        </label>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? 'Checking...' : 'Continue'}
        </button>
      </form>
      <p className="si-foot">
        <button className="si-link" type="button" disabled={resend} onClick={() => startResend(() => resendAction())}>
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

/** Step 2: the QR code and the first code from the app. */
function Setup({ replacing }: { replacing: boolean }) {
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [starting, startStarting] = useTransition();

  return (
    <div className="si-form">
      <div>
        <h2>{replacing ? 'Set up a new authenticator' : 'Set up your authenticator'}</h2>
        <p>Use an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy or similar).</p>
      </div>
      {enroll?.error && !enroll.qr ? (
        <div className="si-alert err" role="alert">
          {enroll.error}
        </div>
      ) : null}
      {enroll?.qr && enroll.factorId ? (
        <Finish key={enroll.factorId} start={enroll} />
      ) : (
        <button className="btn" type="button" disabled={starting} onClick={() => startStarting(async () => setEnroll(await startEnrollAction()))}>
          {starting ? 'Preparing...' : 'Show my QR code'}
        </button>
      )}
      <p className="si-foot">
        <button className="si-link" type="button" onClick={() => void signOutAction()}>
          Use a different account
        </button>
      </p>
    </div>
  );
}

function Finish({ start }: { start: EnrollState }) {
  const [state, action, pending] = useActionState(finishEnrollAction, start);
  return (
    <form action={action} className="si-form" style={{ gap: 14 }} noValidate>
      <input type="hidden" name="factorId" value={start.factorId ?? ''} />
      <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
        <li>Open your authenticator app and add an account by scanning this QR code.</li>
        <li>Type the six-digit code the app shows.</li>
      </ol>
      {/* The QR code is an SVG data address built by Supabase Auth for this one entry; it is not user-supplied. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={start.qr} alt="QR code for your authenticator app" width={196} height={196} style={{ background: '#fff', padding: 8, borderRadius: 8, justifySelf: 'center' }} />
      <p className="si-foot" style={{ margin: 0, wordBreak: 'break-all' }}>
        Cannot scan it? Type this key into the app: <code>{start.secret}</code>
      </p>
      {state.error ? (
        <div className="si-alert err" role="alert">
          {state.error}
        </div>
      ) : null}
      <label className="fld">
        Six-digit code from the app
        <input className="inp si-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" required autoFocus />
      </label>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Checking...' : 'Finish setup'}
      </button>
    </form>
  );
}
