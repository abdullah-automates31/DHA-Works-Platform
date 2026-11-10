'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/lib/action';
import { saveSettingsAction } from './actions';

const initial: ActionState = {};

/** Helpline number and show/hide, plus the report and review windows. Saved together with one button. */
export function HelplineForm({ number, enabled, reportDays, reviewDays }: { number: string; enabled: boolean; reportDays: number; reviewDays: number }) {
  const [state, run, pending] = useActionState(saveSettingsAction, initial);
  return (
    <form action={run} className="col" style={{ gap: 20 }}>
      <section className="card col" style={{ gap: 14 }}>
        <div>
          <h2 className="h2">Helpline</h2>
          <div className="mut" style={{ fontSize: 13, marginTop: 4 }}>The number residents and workers can call from the Help screen and the unsafe buttons.</div>
        </div>
        <label className="fld" style={{ maxWidth: 320 }}>Helpline number
          <input className="inp" name="helplineNumber" defaultValue={number} placeholder="1092" maxLength={20} inputMode="tel" />
        </label>
        <label className="row g8" style={{ alignItems: 'flex-start', padding: '12px 14px', border: '1.5px solid #C9D6CE', borderRadius: 12, cursor: 'pointer' }}>
          <input type="checkbox" name="helplineEnabled" defaultChecked={enabled} style={{ width: 18, height: 18, marginTop: 2, flex: 'none' }} />
          <span className="col" style={{ gap: 2 }}>
            <span className="xb" style={{ fontSize: 14 }}>Show the helpline number in both apps</span>
            <span className="mut" style={{ fontSize: 12.5, fontWeight: 500 }}>Keep this off until DHA has confirmed the number. People see it only while this is on.</span>
          </span>
        </label>
      </section>

      <section className="card col" style={{ gap: 14 }}>
        <div>
          <h2 className="h2">Time windows</h2>
          <div className="mut" style={{ fontSize: 13, marginTop: 4 }}>How long after a job is finished people can still act on it.</div>
        </div>
        <div className="grid2" style={{ gap: 16 }}>
          <label className="fld">Report a problem
            <span className="row g8"><input className="inp" name="reportDays" type="number" min={1} max={30} defaultValue={reportDays} required style={{ maxWidth: 110 }} /><span className="mut b">days after the job</span></span>
          </label>
          <label className="fld">Leave a review
            <span className="row g8"><input className="inp" name="reviewDays" type="number" min={1} max={30} defaultValue={reviewDays} required style={{ maxWidth: 110 }} /><span className="mut b">days after the job</span></span>
          </label>
        </div>
      </section>

      <div className="row wrap g8" style={{ alignItems: 'center' }}>
        <button type="submit" className={`btn${pending ? ' off' : ''}`} disabled={pending}>{pending ? 'Saving...' : 'Save changes'}</button>
        {state.error ? <div className="note red" role="alert" style={{ padding: '10px 12px', fontSize: 13 }}>{state.error}</div> : null}
        {state.ok ? <div className="note g" role="status" style={{ padding: '10px 12px', fontSize: 13 }}>{state.ok}</div> : null}
      </div>
    </form>
  );
}
