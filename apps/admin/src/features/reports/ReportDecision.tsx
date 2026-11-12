'use client';

import { useActionState, useEffect, useState } from 'react';
import type { ActionState } from '@/lib/action';
import { decideReportAction } from './actions';
import { canDecide, choicesFor, REASON_MAX, type Choice } from './rules';

const initial: ActionState = {};

/** "Action on <name>" of the case screen (A08): pick one outcome, write the reason, save. */
export function ReportDecision({ reportId, against }: { reportId: string; against: { name: string; role: string } }) {
  const [state, run, pending] = useActionState(decideReportAction, initial);
  const [choice, setChoice] = useState<Choice>('keep_open');
  const [reason, setReason] = useState('');
  const options = choicesFor(against);

  // A suspend needs a fresh code, which sends the person to another page and back. Keep the choice and the reason in
  // this browser tab (15 minutes) so they are still there on return; a saved decision clears them.
  const draftKey = `adm-draft:report-decision:${reportId}`;
  useEffect(() => {
    // Read after the first paint (not during it), so the server and browser render the same thing first.
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(draftKey);
        if (!raw) return;
        const d = JSON.parse(raw) as { at?: number; choice?: string; reason?: string };
        if (typeof d.at !== 'number' || Date.now() - d.at > 15 * 60_000) return void sessionStorage.removeItem(draftKey);
        if (d.choice && options.some((o) => o.key === d.choice)) setChoice(d.choice as Choice);
        if (typeof d.reason === 'string') setReason(d.reason.slice(0, REASON_MAX));
      } catch {
        /* the draft is a convenience only */
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    try {
      if (state.ok) sessionStorage.removeItem(draftKey);
      else if (choice !== 'keep_open' || reason) sessionStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), choice, reason }));
    } catch {
      /* ignore */
    }
  }, [state.ok, choice, reason, draftKey]);
  const current = options.find((o) => o.key === choice) ?? options[0]!;
  const verdict = canDecide(choice, reason);

  return (
    <form action={run} className="card col" style={{ gap: 10 }}>
      <input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="choice" value={choice} />
      <h2 className="h2">Action on {against.name}</h2>
      {options.map((o) => (
        <button key={o.key} type="button" className={`opt${choice === o.key ? ' on' : ''}${o.tone === 'stop' ? ' rj' : ''}`} style={{ alignItems: 'flex-start' }} aria-pressed={choice === o.key} onClick={() => setChoice(o.key)}>
          <span className="rd" style={{ marginTop: 2 }} />
          <span>
            <span style={{ display: 'block' }}>{o.label}</span>
            <span className="mut" style={{ display: 'block', fontWeight: 600, fontSize: 12.5, marginTop: 2 }}>{o.hint}</span>
          </span>
        </button>
      ))}
      {current.needsReason ? (
        <label className="fld">
          Reason (kept in the case record{choice === 'warning' ? ', and sent to them as the warning' : ''})
          <textarea className="inp" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} placeholder="What happened and why this action." />
        </label>
      ) : null}
      {!verdict.ok ? <div className="note y" style={{ padding: '10px 12px', fontSize: 13 }}>{verdict.hint}</div> : null}
      {state.error ? <div className="note red" role="alert" style={{ padding: '10px 12px', fontSize: 13 }}>{state.error}</div> : null}
      {state.ok ? <div className="note g" role="status" style={{ padding: '10px 12px', fontSize: 13 }}>{state.ok}</div> : null}
      <button type="submit" className={`btn full${current.tone === 'stop' ? ' red' : ''}${!verdict.ok || pending ? ' off' : ''}`} style={{ height: 46 }} disabled={!verdict.ok || pending}>
        {pending ? 'Saving...' : choice === 'keep_open' ? 'Mark in review' : 'Save status'}
      </button>
    </form>
  );
}
