import Link from 'next/link';
import { ActionForm } from '@/components/FormKit';
import { EmptyRow, LoadError } from '@/components/ListBits';
import { Chip } from '@/components/ui';
import { dateTime, rupees } from '@/lib/format';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@dha/supabase';
import { decidePaymentAction, recordPaymentAction, waiveDueAction, warnWorkerAction } from './actions';
import { ProofLink, signedProofUrls } from './ProofLink';
import { METHODS, methodLabel, parseWorkerDues, whenText, type LedgerDue } from './parse';

const DUE_CHIP: Record<LedgerDue['status'], { tone: 'wait' | 'ok' | 'red' | 'gray'; label: string }> = {
  due: { tone: 'wait', label: 'Due' },
  overdue: { tone: 'red', label: 'Overdue' },
  paid: { tone: 'ok', label: 'Paid' },
  waived: { tone: 'gray', label: 'Waived' },
};

/** The Dues tab of a worker's profile: what they owe, every due per job, every payment, and the staff controls. */
export async function WorkerDuesPanel({ supabase, workerId, workerName }: { supabase: SupabaseClient<Database>; workerId: string; workerName: string }) {
  const res = await supabase.rpc('admin_dues_worker', { p_worker: workerId });
  const w = res.error ? null : parseWorkerDues(res.data);
  if (!w) return <LoadError />;
  const now = new Date();
  const proofUrls = await signedProofUrls(supabase, w.payments.map((p) => p.proofPath));
  const s = w.summary;
  const hasOpenDue = w.dues.some((d) => d.status === 'due' || d.status === 'overdue');

  return (
    <>
      <div className="grid4">
        <div className="card stat"><span>Owes DHA</span><b>{rupees(s.owed)}</b></div>
        <div className="card stat"><span>Overdue</span><b style={s.overdue > 0 ? { color: '#99191A' } : undefined}>{rupees(s.overdue)}</b></div>
        <div className="card stat"><span>Paid so far</span><b>{rupees(s.paidTotal)}</b></div>
        <div className="card stat"><span>Next due</span><b className="txt">{s.owed > 0 && s.nextDueAt ? whenText(s.nextDueAt, now) : '-'}</b></div>
      </div>
      {s.overdue > 0 ? (
        <div className="note red" role="status"><span><b>{workerName} is overdue by {rupees(s.overdue)}{s.overdueSince ? ` (since ${dateTime(s.overdueSince)})` : ''}.</b> {w.suspended ? 'The account is already suspended.' : 'Send a warning, or suspend the account from the Account box on the right.'}</span></div>
      ) : null}
      {s.pendingCount > 0 ? <div className="note"><span>{rupees(s.pendingTotal)} is waiting for you to check ({s.pendingCount} payment{s.pendingCount === 1 ? '' : 's'}). Confirm or reject it below.</span></div> : null}
      {s.credit > 0 ? <div className="note g"><span>{workerName} paid {rupees(s.credit)} more than the dues so far. It counts against their next dues.</span></div> : null}

      <div className="tw">
        <div className="row sb" style={{ padding: '16px 20px 8px' }}><h2 className="h2">Dues per job</h2></div>
        <table className="tbl compact">
          <thead><tr><th>Job</th><th>DHA fee</th><th>Paid</th><th>Left</th><th>Added</th><th>Due</th><th>Status</th><th /></tr></thead>
          <tbody>
            {w.dues.length === 0 ? <EmptyRow cols={8} text="No dues yet." /> : null}
            {w.dues.map((d) => {
              const chip = DUE_CHIP[d.status];
              const canWaive = d.status === 'due' || d.status === 'overdue';
              return (
                <tr key={d.id}>
                  <td>
                    {d.jobId ? <Link href={`/jobs/${d.jobId}`} className="xb" style={{ color: 'var(--g)', textDecoration: 'none' }}>{d.jobCode}</Link> : d.jobCode}
                    <div className="mut" style={{ fontSize: 12.5 }}>{d.jobTitle}</div>
                  </td>
                  <td className="b">{rupees(d.amount)}</td>
                  <td>{rupees(d.paid)}</td>
                  <td>{rupees(d.remaining)}</td>
                  <td>{dateTime(d.accruedAt)}</td>
                  <td>{dateTime(d.dueAt)}{canWaive ? <div className="mut" style={{ fontSize: 12.5 }}>{whenText(d.dueAt, now)}</div> : null}</td>
                  <td>
                    <Chip tone={chip.tone}>{chip.label}</Chip>
                    {d.status === 'waived' && d.waiveReason ? <div className="mut" style={{ fontSize: 12.5 }}>{d.waiveReason}</div> : null}
                  </td>
                  <td>
                    {canWaive ? (
                      <details>
                        <summary className="mut b" style={{ cursor: 'pointer', fontSize: 12.5 }}>Waive</summary>
                        <div style={{ marginTop: 6, minWidth: 220 }}>
                          <ActionForm action={waiveDueAction} hidden={{ dueId: d.id, workerId }} submit="Waive this due" tone="out" fields={[{ name: 'reason', kind: 'text', label: 'Reason', required: true, maxLength: 300 }]} />
                        </div>
                      </details>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="tw">
        <div className="row sb" style={{ padding: '16px 20px 8px' }}><h2 className="h2">Payments</h2></div>
        <table className="tbl compact">
          <thead><tr><th>When</th><th>Amount</th><th>How</th><th>Transaction ID</th><th>Status</th><th>Checked by</th></tr></thead>
          <tbody>
            {w.payments.length === 0 ? <EmptyRow cols={6} text="No payments yet." /> : null}
            {w.payments.map((p) => (
              <tr key={p.id}>
                <td>{dateTime(p.createdAt)}</td>
                <td className="b">{rupees(p.amount)}</td>
                <td>{methodLabel(p.method)}{p.byStaff ? <div className="mut" style={{ fontSize: 12.5 }}>Recorded by {p.createdBy ?? 'staff'}</div> : null}</td>
                <td>{p.reference ?? <span className="mut">-</span>}{p.note ? <div className="mut" style={{ fontSize: 12.5 }}>{p.note}</div> : null}<ProofLink url={p.proofPath ? proofUrls[p.proofPath] ?? null : null} small /></td>
                <td>
                  {p.status === 'pending' ? (
                    <div className="col" style={{ gap: 6, minWidth: 200 }}>
                      <Chip tone="wait">Waiting</Chip>
                      <ActionForm action={decidePaymentAction} hidden={{ paymentId: p.id, workerId, decision: 'confirm' }} inline submit="Confirm" fields={[{ name: 'amount', kind: 'text', label: 'Amount that arrived', defaultValue: String(p.amount), maxLength: 12 }]} />
                      <details>
                        <summary className="mut b" style={{ cursor: 'pointer', fontSize: 12.5 }}>Reject</summary>
                        <div style={{ marginTop: 6 }}>
                          <ActionForm action={decidePaymentAction} hidden={{ paymentId: p.id, workerId, decision: 'reject' }} submit="Reject" tone="red" fields={[{ name: 'reason', kind: 'text', label: 'Reason (the worker sees this)', required: true, maxLength: 300 }]} />
                        </div>
                      </details>
                    </div>
                  ) : (
                    <>
                      <Chip tone={p.status === 'confirmed' ? 'ok' : 'red'}>{p.status === 'confirmed' ? 'Confirmed' : 'Rejected'}</Chip>
                      {p.reason ? <div className="mut" style={{ fontSize: 12.5 }}>{p.reason}</div> : null}
                    </>
                  )}
                </td>
                <td>{p.decidedBy ? <>{p.decidedBy}<div className="mut" style={{ fontSize: 12.5 }}>{dateTime(p.decidedAt)}</div></> : <span className="mut">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card col">
        <h2 className="h2">Record a payment</h2>
        <span className="mut" style={{ fontSize: 13 }}>For money that reached DHA outside the app, for example cash at the office. It counts at once and the worker is told.</span>
        <ActionForm
          action={recordPaymentAction}
          hidden={{ workerId }}
          submit="Record payment"
          tone="soft"
          fields={[
            { name: 'amount', kind: 'text', label: 'Amount received (Rs)', required: true, maxLength: 12 },
            { name: 'method', kind: 'select', label: 'How', required: true, defaultValue: 'office_cash', options: METHODS.map((m) => ({ value: m, label: methodLabel(m) })) },
            { name: 'reference', kind: 'text', label: 'Transaction ID (not needed for office cash)', maxLength: 60 },
            { name: 'note', kind: 'text', label: 'Note (optional)', maxLength: 300 },
          ]}
        />
      </div>

      {!w.suspended ? (
        <div className="card col">
          <h2 className="h2">Warn the worker</h2>
          <span className="mut" style={{ fontSize: 13 }}>{hasOpenDue ? 'They get a notice and a push message with what they owe.' : 'They owe nothing right now, so a warning is probably not needed.'}</span>
          <ActionForm action={warnWorkerAction} hidden={{ workerId }} submit="Send warning" tone="out" fields={[{ name: 'text', kind: 'textarea', label: 'Warning (they see it in the app)', placeholder: 'For example: Please pay your DHA dues by Friday.', required: true, maxLength: 300, rows: 2 }]} />
        </div>
      ) : (
        <div className="note"><span>The account is suspended. A suspended worker can still open My Dues and pay. Reactivate the account from the Account box on the right once the dues are cleared.</span></div>
      )}
    </>
  );
}
