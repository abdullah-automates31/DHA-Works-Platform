'use client';

import { useActionState, useEffect, useState } from 'react';
import { reopenAction, type DecideState } from './actions';
import { REASON_MAX, REASON_MIN, type Role } from './rules';

const initial: DecideState = {};

/** "Let them apply again" for a rejected applicant. Needs a reason the applicant will see. */
export function ReopenForm({ role, profileId }: { role: Role; profileId: string }) {
  const [state, action, pending] = useActionState(reopenAction, initial);
  const [reason, setReason] = useState('');
  const ready = reason.trim().length >= REASON_MIN;

  // Sending needs a fresh code, which sends the person to another page and back: keep the reason for 15 minutes.
  const draftKey = `adm-draft:reopen:${profileId}`;
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(draftKey);
        if (!raw) return;
        sessionStorage.removeItem(draftKey);
        const d = JSON.parse(raw) as { at?: number; reason?: string };
        if (typeof d.at === 'number' && Date.now() - d.at <= 15 * 60_000 && typeof d.reason === 'string') setReason(d.reason.slice(0, REASON_MAX));
      } catch {
        /* the draft is a convenience only */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [draftKey]);
  const remember = () => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), reason }));
    } catch {
      /* ignore */
    }
  };

  return (
    <form action={action} onSubmit={remember} className="card col" style={{ gap: 12 }}>
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="role" value={role} />
      <h2 className="h2">Let them apply again</h2>
      <span className="mut b" style={{ fontSize: 13 }}>
        The {role} gets this application back with your note, can fix their details and documents, and sends it again. It then waits for a normal decision.
      </span>
      <label className="fld">
        Note (the {role} will see this)
        <textarea className="inp" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} placeholder={`Tell the ${role} what to fix before applying again.`} />
      </label>
      {state.error ? <div className="note red" role="alert" style={{ padding: '10px 12px', fontSize: 13 }}>{state.error}</div> : null}
      <button type="submit" className={`btn full${!ready || pending ? ' off' : ''}`} style={{ height: 46 }} disabled={!ready || pending}>
        {pending ? 'Saving...' : 'Open application again'}
      </button>
    </form>
  );
}
