import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/FormKit';
import { PhotoGrid } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Avatar, Chip, Icon, ICONS } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { CANCEL_REASON_TEXT, ago, dateOnly, dateTime, jobStatus, phoneText, PROGRESS_STEPS, progressDone, reportKind, reportStatus, rupees, sentence, telHref, timeOnly, underReviewText } from '@/lib/format';
import { isUuid } from '@/lib/json';
import { initials } from '../verification/rules';
import { cancelJobAction, decideCancellationAction, replaceWorkerAction, resumeJobAction } from './actions';
import { jobMediaUrls, loadJobDetail } from './queries';

const CANCELLABLE = ['open', 'interested', 'quoted', 'scheduled', 'in_progress', 'completed', 'disputed'];

function CallLink({ phone, label }: { phone: string | null; label: string }) {
  const href = telHref(phone);
  return href ? <a className="btn out sm" href={href}>{label}</a> : <span className="btn out sm off">No phone</span>;
}

/** One job (A11): description, people, quote, cash, progress, reports and the staff actions. */
export async function JobView({ id }: { id: string }) {
  const { supabase, user } = await requireSession();
  if (!isUuid(id)) notFound();
  const d = await loadJobDetail(supabase, id);
  if (!d) notFound();
  const j = d.job;
  const urls = await jobMediaUrls(supabase, [...d.photos, ...(j.voicePath ? [j.voicePath] : [])]);
  const st = jobStatus(j.status);
  const done = progressDone(j.status);
  const openReports = d.reports.filter((r) => r.status !== 'resolved');
  const pending = d.cancellations.find((c) => c.status === 'pending');
  const review = underReviewText(j.underReview);
  const live = CANCELLABLE.includes(j.status);
  const dead = j.status === 'cancelled' || j.status === 'expired';
  const visit = j.scheduledStart ? `${dateOnly(j.scheduledStart)}, ${timeOnly(j.scheduledStart)}${j.scheduledEnd ? ` to ${timeOnly(j.scheduledEnd)}` : ''}` : j.preferredDate ? `${dateOnly(j.preferredDate)}${j.windowFrom ? `, ${j.windowFrom.slice(0, 5)}` : ''}` : j.urgency === 'asap' ? 'As soon as possible' : 'Not set';
  const q = d.quote;
  const c = d.cash;
  const eventTime = (t: string) => d.events.find((e) => e.type === t)?.at ?? null;

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active="/jobs"
      title={`Job ${j.code}`}
      sub={`Posted ${dateTime(j.postedAt ?? j.createdAt)} · Phase ${j.phase}, ${j.lane}${j.plotNo ? `, House ${j.plotNo}` : ''}`}
      back={{ href: '/jobs', label: 'Jobs' }}
      right={<div className="row g8">{openReports.length > 0 ? <Chip tone="red">{openReports.length} open report{openReports.length === 1 ? '' : 's'}</Chip> : null}{pending ? <Chip tone="pur">Cancel requested</Chip> : null}<Chip tone={st.tone}>{st.label}</Chip></div>}
    >
      {review ? <div className="note y" role="status"><Icon>{ICONS.info}</Icon><span><b>Under review: {review}.</b> Use the staff actions on the right to resume, replace the worker or cancel the job.</span></div> : null}
      {j.stuckSince ? <div className="note y" role="status"><Icon>{ICONS.info}</Icon><span><b>This job looks stuck</b> ({j.stuckReason ?? 'no update'}) since {ago(j.stuckSince)}.</span></div> : null}
      {dead ? <div className="note g"><Icon>{ICONS.info}</Icon><span><b>This job is {j.status}.</b>{j.cancelReason ? ` Reason: ${j.cancelReason}.` : ''}{j.cancelledByName ? ` By ${j.cancelledByName}.` : ''}</span></div> : null}

      <div className="split">
        <div className="col" style={{ gap: 20 }}>
          <div className="card col">
            <div className="row sb" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="xb" style={{ fontSize: 22 }}>{j.title}</div>
                <div className="mut b">{j.category} · Visit {visit}</div>
              </div>
              {q ? <div style={{ textAlign: 'right' }}><div className="h3">Agreed quote</div><div className="xb" style={{ fontSize: 24, color: 'var(--g)' }}>{rupees(q.total)}</div></div> : null}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{j.description}</div>
            <PhotoGrid paths={d.photos} urls={urls} label="Photo" />
            {j.voicePath && urls[j.voicePath] ? <audio controls preload="none" src={urls[j.voicePath]} style={{ width: '100%' }} /> : null}
          </div>

          <div className="grid2">
            <div className="card col">
              <div className="h3">Resident</div>
              {d.resident ? (
                <>
                  <div className="row"><Avatar initials={initials(d.resident.name)} seed={d.resident.id} large /><div><div className="xb" style={{ fontSize: 17 }}>{d.resident.name}</div><div className="mut b" style={{ fontSize: 13 }}>{d.resident.verified ? 'Verified resident' : 'Not verified'} · Phase {j.phase}{d.resident.accountStatus === 'suspended' ? ' · suspended' : ''}</div></div></div>
                  <div className="row g8 wrap"><CallLink phone={d.resident.phone} label={`Call ${phoneText(d.resident.phone)}`} /><Link className="btn soft sm" href={`/users/${d.resident.id}`}>Profile</Link></div>
                </>
              ) : <span className="mut">No resident.</span>}
            </div>
            <div className="card col">
              <div className="h3">Worker</div>
              {d.worker ? (
                <>
                  <div className="row"><Avatar initials={initials(d.worker.name)} seed={d.worker.id} large /><div><div className="xb" style={{ fontSize: 17 }}>{d.worker.name}</div><div className="mut b" style={{ fontSize: 13 }}>{[d.worker.category, d.worker.ratingCount > 0 && d.worker.ratingAvg !== null ? `${d.worker.ratingAvg.toFixed(1)} rating` : null, `${d.worker.jobsDone} jobs`].filter(Boolean).join(' · ')}{d.worker.accountStatus === 'suspended' ? ' · suspended' : ''}</div></div></div>
                  <div className="row g8 wrap"><CallLink phone={d.worker.phone} label={`Call ${phoneText(d.worker.phone)}`} /><Link className="btn soft sm" href={`/users/${d.worker.id}`}>Profile</Link></div>
                </>
              ) : <span className="mut">No worker yet. {d.counts.interested} interested, {d.counts.quotes} quote{d.counts.quotes === 1 ? '' : 's'}.</span>}
            </div>
          </div>

          <div className="grid2">
            <div className="card col">
              <div className="h3">Quote breakdown</div>
              {q ? (
                <>
                  <div className="row sb"><span className="mut b">Labour</span><b>{rupees(q.labour)}</b></div>
                  <div className="row sb"><span className="mut b">Materials</span><b>{rupees(q.materials)}</b></div>
                  {q.otherAmount > 0 ? <div className="row sb"><span className="mut b">Other</span><b>{rupees(q.otherAmount)}</b></div> : null}
                  <hr className="hr" />
                  <div className="row sb"><b>Total</b><b style={{ color: 'var(--g)' }}>{rupees(q.total)}</b></div>
                  {q.materialsNote ? <div className="mut" style={{ fontSize: 13 }}>Materials: {q.materialsNote}</div> : null}
                  <div className="mut" style={{ fontSize: 13 }}>Accepted {dateTime(q.decidedAt ?? q.sentAt)}</div>
                </>
              ) : <span className="mut">No quote has been accepted yet.</span>}
            </div>
            <div className="card col">
              <div className="h3">Cash</div>
              {c ? (
                <>
                  <div className="row sb"><span className="mut b">Agreed</span><b>{rupees(c.agreed)}</b></div>
                  <div className="row sb"><span className="mut b">Recorded by worker</span>{c.workerAmount === null ? <Chip tone="gray">Not yet</Chip> : <b>{rupees(c.workerAmount)}</b>}</div>
                  {c.residentAmount !== null ? <div className="row sb"><span className="mut b">Confirmed by resident</span><b>{rupees(c.residentAmount)}</b></div> : null}
                  {c.workerReason ? <div className="mut" style={{ fontSize: 13 }}>Worker note: {c.workerReason}</div> : null}
                  <div className="mut" style={{ fontSize: 13 }}>{c.workerAmount !== null && c.residentAmount === null ? `Recorded by the worker (cash is worker-only)${c.quoteDifference ? ` (${c.quoteDifference > 0 ? '+' : ''}${rupees(c.quoteDifference)} from the quote)` : ''}.` : c.matched === true ? `Both amounts match${c.quoteDifference ? ` (${c.quoteDifference > 0 ? '+' : ''}${rupees(c.quoteDifference)} from the quote)` : ''}.` : c.matched === false ? 'The two amounts differ. The job is flagged.' : 'If the two amounts differ, the job is flagged here.'}</div>
                </>
              ) : <span className="mut">Cash is recorded once a quote is accepted.</span>}
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card col">
            <h2 className="h2">Progress</h2>
            {dead ? (
              <div className="tl"><div className="s"><div className="c"><div className="d stop" /></div><div className="t">{sentence(j.status)}<span>{dateTime(eventTime('cancelled_by_staff') ?? eventTime('job_expired'))}</span></div></div></div>
            ) : (
              <div className="tl">
                {PROGRESS_STEPS.map((label, i) => {
                  const isDone = i < done;
                  const isNow = i === done && j.status !== 'reviewed';
                  return (
                    <div className="s" key={label}>
                      <div className="c">
                        <div className={`d${isDone ? ' ok' : isNow ? ' now' : ''}`}>{isDone ? <svg className="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg> : null}</div>
                        {i < PROGRESS_STEPS.length - 1 ? <i className={isDone ? 'ok' : ''} /> : null}
                      </div>
                      <div className={`t${!isDone && !isNow ? ' todo' : ''}`}>{label}
                        {label === 'Quoted' && q && isDone ? <span>{rupees(q.total)} accepted</span> : null}
                        {label === 'Scheduled' && isDone ? <span>{visit}</span> : null}
                        {label === 'In progress' && j.startedAt ? <span>Started {dateTime(j.startedAt)}</span> : null}
                        {label === 'Completed' && j.completedAt ? <span>{dateTime(j.completedAt)}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {d.events.length > 0 ? (
              <details>
                <summary className="b" style={{ cursor: 'pointer', fontSize: 13 }}>Full timeline ({d.events.length})</summary>
                <div className="col g4" style={{ marginTop: 8 }}>
                  {d.events.map((e, i) => <div key={`${e.type}${i}`} className="row sb" style={{ fontSize: 13 }}><span className="b">{sentence(e.type)}</span><span className="mut">{dateTime(e.at)}{e.actorName ? ` · ${e.actorName}` : ''}</span></div>)}
                </div>
              </details>
            ) : null}
          </div>

          <div className="card col">
            <h2 className="h2">Reports on this job</h2>
            {d.reports.length === 0 ? <span className="mut">No reports.</span> : d.reports.map((r) => {
              const k = reportKind(r.kind);
              const s = reportStatus(r.status);
              return (
                <Link key={r.id} href={`/reports/${r.id}`} className="row" style={{ textDecoration: 'none', color: 'inherit', padding: '10px 12px', borderRadius: 12, background: r.status === 'resolved' ? '#EDF4F0' : '#FDF1EF' }}>
                  <Chip tone={k.tone}>{k.label}</Chip>
                  <div className="fx"><div className="xb">{r.code}</div><div className="mut" style={{ fontSize: 12.5 }}>Reported by the {r.reporterRole} · {ago(r.createdAt)}</div></div>
                  <b style={{ color: r.status === 'resolved' ? 'var(--gd)' : '#C0392B' }}>{s.label}</b>
                </Link>
              );
            })}
          </div>

          {pending ? (
            <div className="card col">
              <h2 className="h2">Cancellation requested</h2>
              <div className="note y" style={{ flexDirection: 'column', gap: 4 }}>
                <span className="xb">{pending.requesterName} ({pending.requesterRole}) · {CANCEL_REASON_TEXT[pending.reasonCode] ?? sentence(pending.reasonCode)}</span>
                {pending.details ? <span>{pending.details}</span> : null}
              </div>
              <ActionForm
                action={decideCancellationAction}
                hidden={{ requestId: pending.id, jobId: j.id }}
                submit="Save decision"
                fields={[
                  { name: 'decision', kind: 'select', label: 'Decision', required: true, options: [{ value: 'approve', label: 'Approve: cancel the job' }, { value: 'decline', label: 'Decline: the job carries on' }] },
                  { name: 'note', kind: 'textarea', label: 'Note (needed to decline; the requester sees it)', maxLength: 500 },
                ]}
              />
            </div>
          ) : null}

          <div className="card col">
            <h2 className="h2">Staff actions</h2>
            {openReports[0] ? <Link className="btn out" href={`/reports/${openReports[0].id}`} style={{ height: 44 }}>Open case {openReports[0].code}</Link> : null}
            {j.underReview ? (
              <details>
                <summary className="btn out" style={{ cursor: 'pointer' }}>Resume the job</summary>
                <div style={{ marginTop: 10 }}>
                  <ActionForm action={resumeJobAction} hidden={{ jobId: j.id }} submit="Clear the review flag" tone="soft" fields={[{ name: 'note', kind: 'textarea', label: 'Why it is fine to carry on', required: true, maxLength: 500 }]} />
                </div>
              </details>
            ) : null}
            {j.status === 'scheduled' ? (
              <details>
                <summary className="btn out" style={{ cursor: 'pointer' }}>Replace the worker</summary>
                <div style={{ marginTop: 10 }}>
                  <ActionForm action={replaceWorkerAction} hidden={{ jobId: j.id }} submit="Replace the worker" tone="soft" fields={[{ name: 'reason', kind: 'textarea', label: 'Reason (kept in the record)', required: true, maxLength: 500 }]} />
                  <span className="mut" style={{ display: 'block', fontSize: 12.5, marginTop: 6 }}>The job opens again so other workers can accept it. The resident and the old worker are told.</span>
                </div>
              </details>
            ) : null}
            {live ? (
              <details>
                <summary className="btn" style={{ cursor: 'pointer', background: '#FADCDA', color: '#7A1411' }}>Cancel this job</summary>
                <div style={{ marginTop: 10 }}>
                  <ActionForm action={cancelJobAction} hidden={{ jobId: j.id }} submit="Cancel the job" tone="red" fields={[{ name: 'reason', kind: 'textarea', label: 'Reason (required)', required: true, maxLength: 500 }]} />
                </div>
              </details>
            ) : null}
            <span className="mut" style={{ fontSize: 12.5 }}>{live ? 'Cancelling tells both people and closes the job. Staff must write a reason. A paid job cannot be cancelled.' : dead ? 'This job is closed.' : 'This job is paid, so it cannot be cancelled.'}</span>
          </div>
        </div>
      </div>
    </PortalFrame>
  );
}
