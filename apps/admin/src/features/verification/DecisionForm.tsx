'use client';

import { useActionState, useEffect, useState } from 'react';
import { decideAction, type DecideState } from './actions';
import { canSubmit, CHECKLIST, DECISIONS, emptyChecks, normaliseChecks, REASON_MAX, type Checks, type Decision, type Role } from './rules';

const initial: DecideState = {};

/** Checklist, decision and reason (designs A04 and A06). The send button stays off until the rules are met. */
export function DecisionForm({ role, profileId }: { role: Role; profileId: string }) {
  const [state, action, pending] = useActionState(decideAction, initial);
  const [checks, setChecks] = useState<Checks>(() => emptyChecks(role));
  const [decision, setDecision] = useState<Decision>('approve');
  const [reason, setReason] = useState('');

  // Approving or rejecting needs a fresh code, which sends the person to another page and back. Keep the checklist,
  // the decision and the reason in this browser tab (15 minutes) so they are still there on return. The draft is put
  // back once and then removed; it is written again only when the form is sent.
  const draftKey = `adm-draft:decision:${profileId}`;
  useEffect(() => {
    // Read after the first paint (not during it), so the server and browser render the same thing first.
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(draftKey);
        if (!raw) return;
        sessionStorage.removeItem(draftKey);
        const d = JSON.parse(raw) as { at?: number; checks?: Checks; decision?: string; reason?: string };
        if (typeof d.at !== 'number' || Date.now() - d.at > 15 * 60_000) return;
        if (d.checks && typeof d.checks === 'object') setChecks(normaliseChecks(role, d.checks));
        if (DECISIONS[role].some((o) => o.key === d.decision)) setDecision(d.decision as Decision);
        if (typeof d.reason === 'string') setReason(d.reason.slice(0, REASON_MAX));
      } catch {
        /* the draft is a convenience only */
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  const remember = () => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), checks, decision, reason }));
    } catch {
      /* ignore */
    }
  };

  const options = DECISIONS[role];
  const current = options.find((d) => d.key === decision) ?? options[0]!;
  const verdict = canSubmit(role, decision, checks, reason);

  return (
    <form action={action} onSubmit={remember} className="col" style={{ gap: 16 }}>
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="checks" value={JSON.stringify(checks)} />

      <div className="card col" style={{ gap: 10 }}>
        <h2 className="h2">Checklist</h2>
        {CHECKLIST[role].map((c) => (
          <button key={c.key} type="button" className="opt" style={{ padding: '10px 12px', fontSize: 13.5 }} aria-pressed={checks[c.key] === true} onClick={() => setChecks((s) => ({ ...s, [c.key]: !s[c.key] }))}>
            <span className={`ck${checks[c.key] ? ' on' : ''}`}>
              {checks[c.key] ? (
                <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12l5 5 9-10" />
                </svg>
              ) : null}
            </span>
            {c.label}
          </button>
        ))}
      </div>

      <div className="card col" style={{ gap: 10 }}>
        <h2 className="h2">Decision</h2>
        {options.map((d) => (
          <button key={d.key} type="button" className={`opt${decision === d.key ? ' on' : ''}${d.tone === 'stop' ? ' rj' : ''}`} style={{ alignItems: 'flex-start' }} aria-pressed={decision === d.key} onClick={() => setDecision(d.key)}>
            <span className="rd" style={{ marginTop: 2 }} />
            <span>
              <span style={{ display: 'block' }}>{d.label}</span>
              <span className="mut" style={{ display: 'block', fontWeight: 600, fontSize: 12.5, marginTop: 2 }}>{d.hint}</span>
            </span>
          </button>
        ))}
        {decision !== 'approve' ? (
          <label className="fld">
            Reason (the {role} will see this)
            <textarea className="inp" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} placeholder={`Tell the ${role} what is wrong or what to fix.`} />
          </label>
        ) : null}
        {!verdict.ok ? <div className="note y" style={{ padding: '10px 12px', fontSize: 13 }}>{verdict.hint}</div> : null}
        {state.error ? <div className="note red" role="alert" style={{ padding: '10px 12px', fontSize: 13 }}>{state.error}</div> : null}
        <button type="submit" className={`btn full${current.tone === 'stop' ? ' red' : ''}${!verdict.ok || pending ? ' off' : ''}`} style={{ height: 46 }} disabled={!verdict.ok || pending}>
          {pending ? 'Saving...' : current.cta}
        </button>
      </div>
    </form>
  );
}
