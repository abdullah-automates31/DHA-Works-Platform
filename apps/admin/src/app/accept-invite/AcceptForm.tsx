'use client';

import { useActionState, useEffect, useState } from 'react';
import type { ActionState } from '@/lib/action';
import { acceptInviteAction } from '@/features/settings/actions';
import { tokenFromHash } from '@/features/settings/rules';

const initial: ActionState = {};

export function AcceptForm({ email, legacyToken }: { email: string; legacyToken: string | null }) {
  const [state, run, pending] = useActionState(acceptInviteAction, initial);
  // The token comes from the part of the address after "#" (never sent to the server). It is read after the first
  // paint, kept in memory, and then taken out of the address bar and the history entry.
  const [token, setToken] = useState<string | null>(legacyToken);
  const [checked, setChecked] = useState(legacyToken !== null);
  useEffect(() => {
    const t = setTimeout(() => {
      const fromHash = tokenFromHash(window.location.hash);
      if (fromHash) setToken(fromHash);
      if (fromHash || legacyToken) window.history.replaceState(null, '', `${window.location.pathname}?${new URLSearchParams({ email }).toString()}`);
      setChecked(true);
    }, 0);
    return () => clearTimeout(t);
  }, [legacyToken, email]);

  if (checked && !token) {
    return <div className="note red" role="alert">This invitation link is not complete. Ask the person who invited you to send it again.</div>;
  }
  return (
    <form action={run} className="col" style={{ gap: 12 }}>
      <input type="hidden" name="token" value={token ?? ''} />
      <label className="fld">Email<input className="inp" name="email" type="email" defaultValue={email} readOnly /></label>
      <label className="fld">Your full name<input className="inp" name="name" autoComplete="name" required maxLength={100} /></label>
      <label className="fld">Choose a password (12 characters or more)<input className="inp" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} /></label>
      <label className="fld">Type the password again<input className="inp" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={72} /></label>
      {state.error ? <div className="note red" role="alert" style={{ padding: '10px 12px', fontSize: 13 }}>{state.error}</div> : null}
      <button type="submit" className={`btn full${pending || !token ? ' off' : ''}`} style={{ height: 46 }} disabled={pending || !token}>{pending ? 'Creating...' : 'Create my staff account'}</button>
    </form>
  );
}
