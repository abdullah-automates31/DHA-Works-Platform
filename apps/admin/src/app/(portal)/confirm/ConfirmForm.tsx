'use client';

import { useActionState } from 'react';
import { stepUpVerifyAction, type FormState } from '@/app/signin/actions';

const initial: FormState = {};

export function ConfirmForm({ next }: { next: string }) {
  const [state, verify, checking] = useActionState(stepUpVerifyAction, initial);

  return (
    <div className="col" style={{ gap: 12 }}>
      {state.error ? <div className="note red" role="alert" style={{ padding: '10px 12px', fontSize: 13 }}>{state.error}</div> : null}
      <form action={verify} className="col" style={{ gap: 12 }} noValidate>
        <input type="hidden" name="next" value={next} />
        <label className="fld">
          Six-digit code from your authenticator app
          <input className="inp" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" required autoFocus />
        </label>
        <button type="submit" className={`btn full${checking ? ' off' : ''}`} style={{ height: 46 }} disabled={checking}>
          {checking ? 'Checking...' : 'Confirm and continue'}
        </button>
      </form>
    </div>
  );
}
