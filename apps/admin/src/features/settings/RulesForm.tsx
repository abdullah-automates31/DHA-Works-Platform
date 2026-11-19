'use client';

import { useActionState, useState } from 'react';
import type { ActionState } from '@/lib/action';
import { dateOnly } from '@/lib/format';
import { saveRulesAction } from './actions';
import type { Rule } from './parse';
import { checkRules, RULE_HELP, rulesDirty } from './rules';

const initial: ActionState = {};

/**
 * One section of editable rules. Each rule shows its meaning, its default, the allowed range and who last changed it.
 * Changing a box marks it and brings up one Save bar; "Reset to default" only fills the box, nothing is saved until
 * Save changes is pressed. The database checks every value again and writes the audit row.
 */
export function RulesForm({ group, rules }: { group: 'jobs' | 'workers'; rules: Rule[] }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rules.map((r) => [r.key, String(r.value)])));
  const [state, run, pending] = useActionState(saveRulesAction, initial);
  const dirty = rulesDirty(rules, values);
  const problem = dirty ? checkRules(group, rules, values) : null;
  const notDefault = rules.some((r) => Number(values[r.key]) !== r.def);
  const set = (key: string, v: string) => setValues((cur) => ({ ...cur, [key]: v.replace(/[^0-9.]/g, '').slice(0, 6) }));
  const discard = () => setValues(Object.fromEntries(rules.map((r) => [r.key, String(r.value)])));
  const allDefaults = () => setValues(Object.fromEntries(rules.map((r) => [r.key, String(r.def)])));

  return (
    <form action={run} className="col" style={{ gap: 16 }} noValidate>
      <input type="hidden" name="group" value={group} />
      <div className="card col" style={{ gap: 0 }}>
        {notDefault ? (
          <div className="row sb" style={{ paddingBottom: 12 }}>
            <span className="mut b" style={{ fontSize: 13 }}>Some values differ from the defaults.</span>
            <button type="button" className="lnk" onClick={allDefaults}>Reset all to defaults</button>
          </div>
        ) : null}
        {rules.map((r) => {
          const help = RULE_HELP[r.key];
          const typed = values[r.key] ?? '';
          const changed = typed.trim() === '' || Number(typed) !== r.value;
          return (
            <div key={r.key} className={`rrow${changed ? ' chg' : ''}`}>
              <div style={{ minWidth: 0 }}>
                <label htmlFor={`rule-${r.key}`} className="xb" style={{ fontSize: 14.5 }}>{r.label}</label>
                {help ? <div className="mut hint">{help.hint}</div> : null}
                <div className="mut meta">
                  Default {r.def} · Allowed {r.min} to {r.max} · {r.changedBy ? `Last changed by ${r.changedBy}${r.changedAt ? `, ${dateOnly(r.changedAt)}` : ''}` : 'Never changed'}
                </div>
              </div>
              <div className="rv">
                <input
                  id={`rule-${r.key}`}
                  name={r.key}
                  className="inp"
                  inputMode="decimal"
                  autoComplete="off"
                  value={typed}
                  onChange={(e) => set(r.key, e.target.value)}
                  aria-describedby={`rule-${r.key}-unit`}
                  aria-invalid={changed && problem !== null && problem.startsWith(r.label)}
                />
                <span id={`rule-${r.key}-unit`} className="mut b" style={{ fontSize: 13 }}>{help?.unit ?? ''}</span>
                {typed.trim() !== '' && Number(typed) !== r.def ? <button type="button" className="lnk" onClick={() => set(r.key, String(r.def))}>Reset to default</button> : null}
              </div>
            </div>
          );
        })}
      </div>

      {state.error ? <div className="note red" role="alert" style={{ padding: '10px 14px', fontSize: 13 }}>{state.error}</div> : null}
      {state.ok && !dirty ? <div className="note g" role="status" style={{ padding: '10px 14px', fontSize: 13 }}>{state.ok}</div> : null}

      {dirty ? (
        <div className="savebar" role="region" aria-label="Unsaved changes">
          <span className="dot" aria-hidden="true" />
          <b style={{ fontSize: 14 }}>Unsaved changes</b>
          {problem ? <span className="bad" role="alert">{problem}</span> : null}
          <span className="fx" />
          <button type="button" className="btn out sm" onClick={discard} disabled={pending}>Discard</button>
          <button type="submit" className={`btn sm${pending ? ' off' : ''}`} disabled={pending || problem !== null}>{pending ? 'Saving...' : 'Save changes'}</button>
        </div>
      ) : null}
    </form>
  );
}
