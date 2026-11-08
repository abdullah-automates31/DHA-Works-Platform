import Link from 'next/link';
import { ActionForm } from '@/components/FormKit';
import { LoadError, PagerBar, PillRow } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Chip } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { ago, buildHref, CANCEL_REASON_TEXT, jobStatus, lastPage, pageNumber, sentence } from '@/lib/format';
import { decideCancellationAction } from './actions';
import { loadCancellations } from './queries';

/** Cancellation requests: after a job is accepted neither side cancels alone, staff decide here (Phase 2 of the portal). */
export async function CancellationsView({ params }: { params: { show?: string; page?: string } }) {
  const { supabase, user } = await requireSession();
  const show = params.show === 'all' ? 'all' : 'pending';
  const page = pageNumber(params.page);
  const result = await loadCancellations(supabase, show, page);
  const { rows, total } = result.list;

  return (
    <PortalFrame supabase={supabase} user={user} active="/jobs" title="Cancellation requests" sub="After a job is accepted, neither person can cancel alone. A staff member decides." back={{ href: '/jobs', label: 'Jobs' }}>
      <PillRow
        active={show}
        pills={[{ key: 'pending', label: 'Waiting', href: '/jobs/cancellations' }, { key: 'all', label: 'All requests', href: '/jobs/cancellations?show=all' }]}
      />
      {!result.ok ? <LoadError /> : null}
      {rows.length === 0 ? <div className="card mut">{show === 'pending' ? 'No cancellation request is waiting.' : 'No cancellation requests yet.'}</div> : null}
      {rows.map((r) => {
        const st = jobStatus(r.jobStatus);
        return (
          <div key={r.id} className="card col">
            <div className="row sb wrap">
              <div className="row">
                <Link href={`/jobs/${r.jobId}`} className="xb" style={{ color: 'var(--g)', textDecoration: 'none', fontSize: 17 }}>{r.jobCode}</Link>
                <span className="b">{r.jobTitle}</span>
                <Chip tone={st.tone}>{st.label}</Chip>
              </div>
              <span className="mut b">{ago(r.createdAt)}</span>
            </div>
            <div className="note y" style={{ flexDirection: 'column', gap: 4 }}>
              <span className="xb">{r.requesterName} ({sentence(r.requesterRole)}) · {CANCEL_REASON_TEXT[r.reasonCode] ?? sentence(r.reasonCode)}</span>
              {r.details ? <span>{r.details}</span> : null}
            </div>
            {r.status === 'pending' ? (
              <ActionForm
                action={decideCancellationAction}
                hidden={{ requestId: r.id, jobId: r.jobId }}
                submit="Save decision"
                inline
                fields={[
                  { name: 'decision', kind: 'select', label: 'Decision', required: true, options: [{ value: 'approve', label: 'Approve: cancel the job' }, { value: 'decline', label: 'Decline: the job carries on' }] },
                  { name: 'note', kind: 'text', label: 'Note (needed to decline)', maxLength: 500 },
                ]}
              />
            ) : (
              <div className="row g8"><Chip tone={r.status === 'approved' ? 'ok' : 'gray'}>{sentence(r.status)}</Chip>{r.decisionNote ? <span className="mut">{r.decisionNote}</span> : null}</div>
            )}
          </div>
        );
      })}
      <PagerBar shown={rows.length} total={total} page={page} last={lastPage(total)} noun="requests" hrefFor={(p) => buildHref('/jobs/cancellations', { show: show === 'all' ? 'all' : null, page: p })} />
    </PortalFrame>
  );
}
