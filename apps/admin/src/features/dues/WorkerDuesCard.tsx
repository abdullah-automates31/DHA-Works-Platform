import Link from 'next/link';
import { rupees } from '@/lib/format';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@dha/supabase';
import { workerDueCounts, parseWorkerDues } from './parse';

/** A short dues summary for the top of a worker's profile: how many dues are paid, still to pay and waiting for a check. */
export async function WorkerDuesCard({ supabase, workerId }: { supabase: SupabaseClient<Database>; workerId: string }) {
  const res = await supabase.rpc('admin_dues_worker', { p_worker: workerId });
  const w = res.error ? null : parseWorkerDues(res.data);
  if (!w) return null;
  const c = workerDueCounts(w);
  const s = w.summary;
  const red = { color: '#99191A' } as const;
  return (
    <div className="card col" style={{ gap: 12 }}>
      <div className="row sb" style={{ alignItems: 'center' }}>
        <h2 className="h2">DHA dues</h2>
        <Link href={`/users/${workerId}?tab=dues`} className="xb" style={{ color: 'var(--g)', textDecoration: 'none', fontSize: 13.5 }}>See all dues</Link>
      </div>
      {c.total === 0 && c.pending === 0 ? (
        <div className="mut" style={{ fontSize: 13.5 }}>No dues yet. A DHA fee is added after each job this worker finishes.</div>
      ) : (
        <div className="grid4">
          <div className="card stat"><span>Dues paid</span><b>{c.paid}</b><span className="mut" style={{ fontWeight: 600 }}>{rupees(s.paidTotal)} paid so far</span></div>
          <div className="card stat"><span>Dues left to pay</span><b style={c.overdue > 0 ? red : undefined}>{c.left}</b><span className="mut" style={{ fontWeight: 600 }}>{rupees(s.owed)} owed{c.overdue > 0 ? `, ${c.overdue} overdue` : ''}</span></div>
          <div className="card stat"><span>Payments pending</span><b>{c.pending}</b><span className="mut" style={{ fontWeight: 600 }}>{c.pending > 0 ? `${rupees(s.pendingTotal)} to check` : 'nothing to check'}</span></div>
          <div className="card stat"><span>All dues</span><b>{c.total}</b><span className="mut" style={{ fontWeight: 600 }}>{c.waived > 0 ? `${c.waived} waived` : 'none waived'}</span></div>
        </div>
      )}
    </div>
  );
}
