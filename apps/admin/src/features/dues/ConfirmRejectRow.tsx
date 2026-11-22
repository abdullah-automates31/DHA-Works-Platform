'use client';

import { useState, type ReactNode } from 'react';

/**
 * The Confirm form and the Reject button of a payment waiting for staff, on one line and level with each other. The reason
 * form for a rejection opens underneath, so opening it never moves the Confirm form.
 */
export function ConfirmRejectRow({ confirm, reject }: { confirm: ReactNode; reject: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row g8" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {confirm}
        <button type="button" className="btn out" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Reject
        </button>
      </div>
      {open ? <div>{reject}</div> : null}
    </div>
  );
}
