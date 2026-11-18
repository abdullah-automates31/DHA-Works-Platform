import Link from 'next/link';
import { PillRow } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Chip } from '@/components/ui';
import { parseDashboard } from '@/features/dashboard/parse';
import {
  ACTIVITY_CHIP,
  activityHref,
  agoText,
  attentionHref,
  barPercent,
  dateLine,
  KIND_CHIP,
  maxStage,
  oldestText,
  parseRange,
  PRIORITY_CHIP,
  RANGES,
  rangeTitle,
  STAGE_ROWS,
  stageHref,
} from '@/features/dashboard/rules';
import { requireSession } from '@/lib/auth';

export const metadata = { title: 'Dashboard' };

const BAR = { green: '#0F4F31', red: '#C0392B', gray: '#8A9A90' } as const;

/**
 * A02. Current state first (applications, reports, jobs, what needs attention), then what happened in the chosen period.
 * The period pills change only the period figures and the activity list, never the waiting counts or the stages.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const { supabase, user } = await requireSession();
  const { data, error } = await supabase.rpc('admin_dashboard', { p_range: range });
  const d = parseDashboard(error ? null : data);
  const max = maxStage(d.stages);
  const workersOldest = oldestText(d.workers.count, d.workers.oldestSince);
  const residentsOldest = oldestText(d.residents.count, d.residents.oldestSince);
  const period = rangeTitle(range);
  const p = d.period;
  const summary = [
    { n: p.workersRegistered, label: p.workersRegistered === 1 ? 'new worker' : 'new workers' },
    { n: p.residentsRegistered, label: p.residentsRegistered === 1 ? 'new resident' : 'new residents' },
    { n: p.jobsPosted, label: 'jobs posted' },
    { n: p.jobsCompleted, label: 'jobs completed' },
    { n: p.reportsFiled, label: 'reports filed' },
    { n: p.reportsResolved, label: 'reports resolved' },
  ];

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active="/dashboard"
      title="Dashboard"
      sub={dateLine()}
      right={<PillRow active={range} pills={RANGES.map((r) => ({ key: r.key, label: r.label, href: r.key === 'today' ? '/dashboard' : `/dashboard?range=${r.key}` }))} />}
    >
      {error ? <div className="note red" role="alert">The numbers could not be loaded. Reload the page. If it keeps happening, sign out and in again.</div> : null}

      <div className="grid4">
        <Link className="card stat" href="/workers">
          <span>Workers to review</span>
          <b>{d.workers.count}</b>
          {workersOldest ? <span className="chip c-wait" style={{ alignSelf: 'flex-start' }}>{workersOldest}</span> : <span className="chip c-ok" style={{ alignSelf: 'flex-start' }}>Nobody waiting</span>}
        </Link>
        <Link className="card stat" href="/residents">
          <span>Residents to review</span>
          <b>{d.residents.count}</b>
          {residentsOldest ? <span className="chip c-wait" style={{ alignSelf: 'flex-start' }}>{residentsOldest}</span> : <span className="chip c-ok" style={{ alignSelf: 'flex-start' }}>Nobody waiting</span>}
        </Link>
        <Link className="card stat" href="/reports">
          <span>Open reports</span>
          <b>{d.reports.count}</b>
          <span className="row wrap g8">
            {d.reports.unsafe > 0 ? <span className="chip c-red">{d.reports.unsafe} unsafe</span> : null}
            {d.reports.high > 0 ? <span className="chip c-wait">{d.reports.high} poor work</span> : null}
            {d.reports.unsafe === 0 && d.reports.high === 0 ? <span className="chip c-ok">No unsafe cases</span> : null}
          </span>
        </Link>
        <Link className="card stat" href={range === 'today' ? '/jobs?today=1' : '/jobs'}>
          <span>{range === 'today' ? 'Jobs today' : `Jobs posted, last ${range.replace('d', '')} days`}</span>
          <b>{p.jobsPosted}</b>
          <span className="chip c-ok" style={{ alignSelf: 'flex-start' }}>{d.jobsToday.inProgress} in progress now</span>
        </Link>
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', alignItems: 'start' }}>
        <div className="card col" style={{ gap: 4, padding: '20px 20px 8px' }}>
          <div className="row sb wrap" style={{ marginBottom: 8 }}>
            <h2 className="h2">Needs attention{d.attentionTotal > 0 ? ` (${d.attentionTotal})` : ''}</h2>
            <span className="mut b" style={{ fontSize: 13 }}>Most urgent first, then oldest</span>
          </div>
          {d.attention.length === 0 ? (
            <div className="mut" style={{ padding: '14px 0 18px', borderTop: '1px solid var(--line)' }}>Nothing needs attention right now.</div>
          ) : null}
          {d.attention.map((a) => {
            const chip = KIND_CHIP[a.kind];
            const pr = PRIORITY_CHIP[a.priority];
            return (
              <Link key={`${a.kind}-${a.id}`} className="row" href={attentionHref(a)} style={{ textDecoration: 'none', color: 'inherit', padding: '14px 0', borderTop: '1px solid var(--line)', alignItems: 'flex-start' }}>
                <Chip tone={chip.tone}>{chip.label}</Chip>
                <div className="fx" style={{ minWidth: 0 }}>
                  <div className="xb">{a.title}</div>
                  <div className="mut" style={{ fontSize: 13 }}>
                    {a.person && !a.detail.includes(a.person) ? [a.detail, a.person].filter(Boolean).join(' · ') : a.detail || a.person}
                  </div>
                </div>
                <div className="col" style={{ gap: 4, alignItems: 'flex-end', flex: 'none' }}>
                  <span className="row g8">
                    {a.status ? <span className="mut b" style={{ fontSize: 12.5 }}>{a.status}</span> : null}
                    <Chip tone={pr.tone}>{pr.label}</Chip>
                  </span>
                  <span className="mut b" style={{ fontSize: 13 }}>{agoText(a.since)}</span>
                </div>
              </Link>
            );
          })}
          {d.attentionTotal > d.attention.length ? (
            <div className="mut b" style={{ fontSize: 13, padding: '12px 0', borderTop: '1px solid var(--line)' }}>
              Showing the {d.attention.length} most urgent of {d.attentionTotal}. The rest are in{' '}
              <Link href="/reports">Reports</Link>, <Link href="/workers">Workers</Link>, <Link href="/residents">Residents</Link> and{' '}
              <Link href="/jobs/cancellations">Cancellation requests</Link>.
            </div>
          ) : null}
        </div>

        <div className="card col" style={{ gap: 12 }}>
          <div className="row sb">
            <h2 className="h2">Jobs by stage</h2>
            <span className="mut b" style={{ fontSize: 13 }}>Now</span>
          </div>
          {STAGE_ROWS.map((s) => (
            <Link className="row" key={s.key} href={stageHref(s.key)} style={{ textDecoration: 'none', color: 'inherit' }} aria-label={`${s.label}: ${d.stages[s.key]} jobs. Open the list`}>
              <span className="b" style={{ width: 112 }}>{s.label}</span>
              <div className="fx" style={{ height: 10, borderRadius: 5, background: '#E3EEE8' }} aria-hidden="true">
                <div style={{ width: `${barPercent(d.stages[s.key], max)}%`, height: '100%', borderRadius: 5, background: BAR[s.tone] }} />
              </div>
              <b style={{ width: 32, textAlign: 'right' }}>{d.stages[s.key]}</b>
            </Link>
          ))}
        </div>
      </div>

      <div className="card col" style={{ gap: 4, padding: '20px 20px 8px' }}>
        <div className="row sb wrap" style={{ marginBottom: 4 }}>
          <h2 className="h2">Recent activity</h2>
          <span className="mut b" style={{ fontSize: 13 }}>{range === 'today' ? 'Today' : `Last ${range.replace('d', '')} days`}, newest first</span>
        </div>
        <div className="row wrap" style={{ gap: '6px 18px', padding: '4px 0 12px' }}>
          {summary.map((s) => (
            <span key={s.label} className="mut b" style={{ fontSize: 13 }}>
              <b style={{ color: 'var(--ink)', fontSize: 15 }}>{s.n}</b> {s.label}
            </span>
          ))}
        </div>
        {d.activity.length === 0 ? (
          <div className="mut" style={{ padding: '14px 0 18px', borderTop: '1px solid var(--line)' }}>Nothing happened {period}.</div>
        ) : null}
        {d.activity.map((a, i) => {
          const chip = ACTIVITY_CHIP[a.kind];
          return (
            <Link key={`${a.kind}-${a.linkId}-${a.at}-${i}`} className="row" href={activityHref(a)} style={{ textDecoration: 'none', color: 'inherit', padding: '11px 0', borderTop: '1px solid var(--line)' }}>
              <Chip tone={chip.tone}>{chip.label}</Chip>
              <div className="fx" style={{ minWidth: 0 }}>
                <span className="b">{a.text}</span>
                {a.ref ? <span className="mut" style={{ fontSize: 13 }}> · {a.ref}</span> : null}
              </div>
              <span className="mut b" style={{ fontSize: 13, flex: 'none' }}>{agoText(a.at)}</span>
            </Link>
          );
        })}
      </div>
    </PortalFrame>
  );
}
