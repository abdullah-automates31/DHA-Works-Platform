'use client';

import { Children, useState, type ReactNode } from 'react';

import { ACTIVITY_FIRST, ACTIVITY_STEP, nextShown } from '@/features/dashboard/rules';

/**
 * Shows the first `first` rows of a list and a "Show more" button for the rest. The rows are drawn on the server and passed
 * in as children; this only decides how many of them are visible, so nothing extra is fetched or exposed.
 */
export function ShowMore({ children, first = ACTIVITY_FIRST, step = ACTIVITY_STEP, noun = 'rows' }: { children: ReactNode; first?: number; step?: number; noun?: string }) {
  const rows = Children.toArray(children);
  const [shown, setShown] = useState(first);
  const visible = rows.slice(0, shown);
  const hidden = rows.length - visible.length;
  return (
    <>
      {visible}
      {hidden > 0 ? (
        <div className="row" style={{ justifyContent: 'center', padding: '14px 0 12px', borderTop: '1px solid var(--line)' }}>
          <button type="button" className="btn out sm" onClick={() => setShown((n) => nextShown(n, rows.length, step))} aria-label={`Show more ${noun}, ${hidden} more`}>
            Show more ({hidden} more)
          </button>
        </div>
      ) : null}
    </>
  );
}
