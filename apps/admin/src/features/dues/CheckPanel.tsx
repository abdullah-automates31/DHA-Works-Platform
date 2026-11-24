import { Chip } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { checkBadge, compareRows, reasonText, type PaymentFacts, type RowState, type ScreenCheck } from './screenCheck';

const STATE: Record<RowState, { tone: 'ok' | 'red' | 'gray'; label: string }> = {
  same: { tone: 'ok', label: 'Matches' },
  different: { tone: 'red', label: 'Different' },
  unknown: { tone: 'gray', label: 'Not read' },
};

/** The result of the automatic screenshot check as a badge. Staff still decide: this only tells them where to look. */
export function CheckBadge({ check }: { check: ScreenCheck | null }) {
  const b = checkBadge(check);
  return <Chip tone={b.tone}>{b.label}</Chip>;
}

/**
 * The badge, the reasons in plain words, and what the worker typed beside what the screenshot shows. Shown next to the
 * screenshot itself. A payment that has no check yet says so and stays in the normal manual queue.
 */
export function CheckPanel({ check, payment }: { check: ScreenCheck | null; payment: PaymentFacts }) {
  if (!check) {
    return (
      <div className="col" style={{ gap: 6, minWidth: 260 }}>
        <CheckBadge check={null} />
        <span className="mut" style={{ fontSize: 12.5 }}>The screenshot has not been read yet. Check it by hand, as before.</span>
      </div>
    );
  }
  const rows = compareRows(check, payment);
  return (
    <div className="col" style={{ gap: 8, minWidth: 280, flex: '1 1 320px' }}>
      <div className="row g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <CheckBadge check={check} />
        <span className="mut" style={{ fontSize: 12.5 }}>Read automatically {check.checkedAt ? dateTime(check.checkedAt) : ''}. You decide.</span>
      </div>
      {check.reasons.length > 0 ? (
        <ul className="col" style={{ gap: 3, margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {check.reasons.map((r) => <li key={r}>{reasonText(r, check, payment)}</li>)}
        </ul>
      ) : null}
      <div className="tw">
        <table className="tbl compact">
          <thead><tr><th /><th>Worker typed</th><th>Screenshot shows</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="b">{r.label}</td>
                <td>{r.typed}</td>
                <td>{r.read}</td>
                <td><Chip tone={STATE[r.state].tone}>{STATE[r.state].label}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {check.owed !== null ? <span className="mut" style={{ fontSize: 12.5 }}>The worker owed DHA {`Rs ${check.owed.toLocaleString('en-US')}`} when this was checked.</span> : null}
    </div>
  );
}
