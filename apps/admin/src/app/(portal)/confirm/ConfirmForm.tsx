'use client';

import { useActionState, useTransition } from 'react';
import { stepUpResendAction, stepUpVerifyAction, type FormState } from '@/app/signin/actions';

const initial: FormState = {};

export function ConfirmForm({ next }: { next: string }) {
  const [state, verify, checking] = useActionState(stepUpVerifyAction, initial);
  const [sent, send] = useActionState(async () => stepUpResendAction(), initial);
  const [sending, startSend] = useTransition();

  return (
    <div className="col" style={{ gap: 12 }}>
      {sent.error ? <div className="note red" role="alert" style={{ padding: '10px 12px', fontSize: 13 }}>{sent.error}</div> : null}
      {sent.info ? <div className="note g" role="status" style={{ padding: '10px 12px', fontSize: 13 }}>{sent.info}</div> : null}
      {state.error ? <div className="note red" role="alert" style={{ padding: '10px 12px', fontSize: 13 }}>{state.error}</div> : null}
      <button type="button" className={`btn full${sending ? ' off' : ''}`} style={{ height: 46 }} disabled={sending} onClick={() => startSend(() => send())}>
        {sending ? 'Sending...' : 'Send me a code'}
      </button>
      <form action={verify} className="col" style={{ gap: 12 }} noValidate>
        <input type="hidden" name="next" value={next} />
        <label className="fld">
          Six-digit code
          <input className="inp" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" required />
        </label>
        <button type="submit" className={`btn full${checking ? ' off' : ''}`} style={{ height: 46 }} disabled={checking}>
          {checking ? 'Checking...' : 'Confirm and continue'}
        </button>
      </form>
    </div>
  );
}
