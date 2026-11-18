'use client';

import { useActionState, useRef, useState } from 'react';
import type { ActionState } from '@/lib/action';
import { logCallAction } from './actions';
import { CALLER_ROLES, OUTCOMES, REASONS, type CallerRole, type Outcome, type Reason } from './rules';

const initial: ActionState = {};

/** "Log a call" of the helpline screen (A09): caller, type, reason, outcome, notes and an optional case number. */
export function LogCallForm() {
  const [role, setRole] = useState<CallerRole>('resident');
  const [reason, setReason] = useState<Reason>('question');
  const [outcome, setOutcome] = useState<Outcome>('answered');
  const ref = useRef<HTMLFormElement>(null);
  // After a saved call the form goes back to its starting state (done in the result handler, not in an effect).
  const clearForm = () => {
    ref.current?.reset();
    setRole('resident');
    setReason('question');
    setOutcome('answered');
  };
  const [state, run, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await logCallAction(prev, formData);
    if (result.ok) clearForm();
    return result;
  }, initial);

  return (
    <form ref={ref} action={run} className="card col" style={{ gap: 14 }}>
      <h2 className="h2">Log a call</h2>
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="reason" value={reason} />
      <input type="hidden" name="outcome" value={outcome} />
      <div className="grid2" style={{ gap: 12 }}>
        <label className="fld">Caller name<input className="inp" name="name" placeholder="Name" maxLength={100} required /></label>
        <label className="fld">Phone<input className="inp" name="phone" placeholder="03xx xxx xxxx" maxLength={20} inputMode="tel" required /></label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="fld" style={{ marginBottom: 6 }}>Caller is a</legend>
        <div className="row wrap g8">
          {CALLER_ROLES.map((r) => <button key={r.key} type="button" className={`pill${role === r.key ? ' on' : ''}`} aria-pressed={role === r.key} onClick={() => setRole(r.key)}>{r.label}</button>)}
        </div>
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="fld" style={{ marginBottom: 6 }}>Reason</legend>
        <div className="row wrap g8">
          {REASONS.map((r) => <button key={r.key} type="button" className={`pill${reason === r.key ? ' on' : ''}`} aria-pressed={reason === r.key} onClick={() => setReason(r.key)}>{r.label}</button>)}
        </div>
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="fld" style={{ marginBottom: 6 }}>Outcome</legend>
        <div className="row wrap g8">
          {OUTCOMES.map((r) => <button key={r.key} type="button" className={`pill${outcome === r.key ? ' on' : ''}`} aria-pressed={outcome === r.key} onClick={() => setOutcome(r.key)}>{r.label}</button>)}
        </div>
      </fieldset>
      <label className="fld">Notes<textarea className="inp" name="notes" placeholder="What was said, what you advised." maxLength={1000} /></label>
      <label className="fld">Link to case (optional)<input className="inp" name="caseCode" placeholder="RP-0000" maxLength={20} /></label>
      {state.error ? <div className="note red" role="alert" style={{ padding: '10px 12px', fontSize: 13 }}>{state.error}</div> : null}
      {state.ok ? <div className="note g" role="status" style={{ padding: '10px 12px', fontSize: 13 }}>{state.ok}</div> : null}
      <button type="submit" className={`btn full${pending ? ' off' : ''}`} style={{ height: 46 }} disabled={pending}>{pending ? 'Saving...' : 'Save call'}</button>
      {/* Empties a half-filled call without saving anything. */}
      <button type="button" className="btn out full" style={{ height: 40 }} onClick={clearForm} disabled={pending}>Clear form</button>
    </form>
  );
}
