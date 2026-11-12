import Link from 'next/link';
import { PortalFrame } from '@/components/PortalFrame';
import { Chip } from '@/components/ui';
import { parseDashboard } from '@/features/dashboard/parse';
import { agoText, attentionHref, barPercent, dateLine, KIND_CHIP, maxStage, oldestText, STAGE_ROWS } from '@/features/dashboard/rules';
import { requireSession } from '@/lib/auth';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const { supabase, user } = await requireSession();
  const { data, error } = await supabase.rpc('admin_dashboard');
  const d = parseDashboard(error ? null : data);
  const max = maxStage(d.stages);
  const workersOldest = oldestText(d.workers.count, d.workers.oldestSince);
  const residentsOldest = oldestText(d.residents.count, d.residents.oldestSince);

  return (
    <PortalFrame supabase={supabase} user={user} active="/dashboard" title="Dashboard" sub={dateLine()}>
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
          {d.reports.unsafe > 0 ? <span className="chip c-red" style={{ alignSelf: 'flex-start' }}>{d.reports.unsafe} unsafe {d.reports.unsafe === 1 ? 'case' : 'cases'}</span> : <span className="chip c-ok" style={{ alignSelf: 'flex-start' }}>No unsafe cases</span>}
        </Link>
        <Link className="card stat" href="/jobs">
          <span>Jobs today</span>
          <b>{d.jobsToday.count}</b>
          <span className="chip c-ok" style={{ alignSelf: 'flex-start' }}>{d.jobsToday.inProgress} in progress</span>
        </Link>
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', alignItems: 'start' }}>
        <div className="card col" style={{ gap: 4, padding: '20px 20px 8px' }}>
          <div className="row sb" style={{ marginBottom: 8 }}>
            <h2 className="h2">Needs attention</h2>
            <span className="mut b" style={{ fontSize: 13 }}>Unsafe first, then oldest</span>
          </div>
          {d.attention.length === 0 ? (
            <div className="mut" style={{ padding: '14px 0 18px', borderTop: '1px solid var(--line)' }}>Nothing needs attention right now.</div>
          ) : null}
          {d.attention.map((a) => {
            const chip = KIND_CHIP[a.kind];
            return (
              <Link key={`${a.kind}-${a.id}`} className="row" href={attentionHref(a)} style={{ textDecoration: 'none', color: 'inherit', padding: '14px 0', borderTop: '1px solid var(--line)' }}>
                <Chip tone={chip.tone}>{chip.label}</Chip>
                <div className="fx">
                  <div className="xb">{a.title}</div>
                  {a.detail ? <div className="mut" style={{ fontSize: 13 }}>{a.detail}</div> : null}
                </div>
                <span className="mut b" style={{ fontSize: 13 }}>{agoText(a.since)}</span>
              </Link>
            );
          })}
        </div>

        <div className="card col" style={{ gap: 14 }}>
          <div className="row sb">
            <h2 className="h2">Jobs by stage</h2>
            <Link href="/jobs" className="mut b" style={{ fontSize: 13, textDecoration: 'none' }}>See all</Link>
          </div>
          {STAGE_ROWS.map((s) => (
            <div className="row" key={s.key}>
              <span className="b" style={{ width: 104 }}>{s.label}</span>
              <div className="fx" style={{ height: 10, borderRadius: 5, background: '#E3EEE8' }} role="img" aria-label={`${s.label}: ${d.stages[s.key]}`}>
                <div style={{ width: `${barPercent(d.stages[s.key], max)}%`, height: '100%', borderRadius: 5, background: s.tone === 'red' ? '#C0392B' : '#0F4F31' }} />
              </div>
              <b style={{ width: 24, textAlign: 'right' }}>{d.stages[s.key]}</b>
            </div>
          ))}
        </div>
      </div>
    </PortalFrame>
  );
}
