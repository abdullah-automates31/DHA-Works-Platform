'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Select } from '@/components/Select';
import type { ActionState } from '@/lib/action';

export type FieldSpec = {
  name: string;
  label?: string;
  kind: 'textarea' | 'text' | 'number' | 'select' | 'email';
  placeholder?: string;
  options?: { value: string; label: string }[];
  maxLength?: number;
  required?: boolean;
  defaultValue?: string;
  rows?: number;
};

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  hidden?: Record<string, string>;
  fields: FieldSpec[];
  submit: string;
  tone?: 'green' | 'red' | 'out' | 'soft';
  /** a row layout: fields and button on one line (used for short forms) */
  inline?: boolean;
  resetOnOk?: boolean;
  full?: boolean;
};

const initial: ActionState = {};

/**
 * One generic form for the staff actions that are "a few fields and a button" (a note, a reason, a message).
 * The server action checks everything again and the database has the last word; this only shows the answer.
 */
export function ActionForm({ action, hidden, fields, submit, tone = 'green', inline, resetOnOk = true, full }: Props) {
  const [state, run, pending] = useActionState(action, initial);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnOk) ref.current?.reset();
  }, [state, resetOnOk]);

  const btnClass = `btn${tone === 'red' ? ' red' : tone === 'out' ? ' out' : tone === 'soft' ? ' soft' : ''}${full ? ' full' : ''}${pending ? ' off' : ''}`;

  return (
    <form ref={ref} action={run} className={inline ? 'row g8 wrap' : 'col'} style={inline ? { alignItems: 'flex-end' } : { gap: 10 }}>
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {fields.map((f) => (
        <label key={f.name} className="fld" style={inline ? { flex: 1, minWidth: 160 } : undefined}>
          {f.label ?? null}
          {f.kind === 'textarea' ? (
            <textarea className="inp" name={f.name} placeholder={f.placeholder} maxLength={f.maxLength ?? 500} required={f.required} defaultValue={f.defaultValue} style={f.rows ? { height: f.rows * 24 + 24 } : undefined} />
          ) : f.kind === 'select' ? (
            <Select name={f.name} ariaLabel={f.label} required={f.required} defaultValue={f.defaultValue ?? ''} placeholder={f.placeholder ?? 'Choose'} allLabel={f.placeholder ? '' : undefined} options={f.options ?? []} />
          ) : (
            <input className="inp" type={f.kind} name={f.name} placeholder={f.placeholder} maxLength={f.maxLength ?? 200} required={f.required} defaultValue={f.defaultValue} />
          )}
        </label>
      ))}
      {state.error ? <div className="note red" role="alert" style={{ padding: '10px 12px', fontSize: 13 }}>{state.error}</div> : null}
      {state.ok ? <div className="note g" role="status" style={{ padding: '10px 12px', fontSize: 13, overflowWrap: 'anywhere' }}>{state.ok}</div> : null}
      <button type="submit" className={btnClass} disabled={pending} style={full ? { height: 46 } : undefined}>
        {pending ? 'Saving...' : submit}
      </button>
    </form>
  );
}

/** A one-button form (a switch, "Mark done"). The hidden fields say what the button does. */
export function ButtonForm({ action, hidden, label, tone = 'out', small = true }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState>; hidden: Record<string, string>; label: string; tone?: 'green' | 'red' | 'out' | 'soft'; small?: boolean }) {
  const [state, run, pending] = useActionState(action, initial);
  return (
    <form action={run} className="col g4" style={{ alignItems: 'flex-start' }}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" className={`btn${small ? ' sm' : ''}${tone === 'red' ? ' red' : tone === 'out' ? ' out' : tone === 'soft' ? ' soft' : ''}${pending ? ' off' : ''}`} disabled={pending}>
        {pending ? '...' : label}
      </button>
      {state.error ? <span style={{ color: '#7A1411', fontSize: 12, fontWeight: 700 }} role="alert">{state.error}</span> : null}
    </form>
  );
}

/** The on/off switch of the design (a button, so it works with the keyboard). */
export function SwitchForm({ action, hidden, on, label }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState>; hidden: Record<string, string>; on: boolean; label: string }) {
  const [state, run, pending] = useActionState(action, initial);
  return (
    <form action={run} className="col g4" style={{ alignItems: 'flex-end' }}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" className={`sw${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={pending} style={pending ? { opacity: 0.5 } : undefined}>
        <i />
      </button>
      {state.error ? <span style={{ color: '#7A1411', fontSize: 12, fontWeight: 700, maxWidth: 220, textAlign: 'right' }} role="alert">{state.error}</span> : null}
    </form>
  );
}

/** A phase pill that switches on or off when tapped (green when on). */
export function PillToggleForm({ action, hidden, on, label }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState>; hidden: Record<string, string>; on: boolean; label: string }) {
  const [state, run, pending] = useActionState(action, initial);
  return (
    <form action={run} className="col g4">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" className={`pill${on ? ' on' : ''}`} aria-pressed={on} disabled={pending} style={pending ? { opacity: 0.5 } : undefined}>{label}</button>
      {state.error ? <span style={{ color: '#7A1411', fontSize: 12, fontWeight: 700, maxWidth: 160 }} role="alert">{state.error}</span> : null}
    </form>
  );
}
