import Link from 'next/link';
import type { ReactNode } from 'react';
import { PortalFrame } from '@/components/PortalFrame';
import { Chip } from '@/components/ui';
import { parseJobs } from '@/features/jobs/parse';
import { parseReports } from '@/features/reports/parse';
import { moreText, PER_GROUP, queryFrom, searchState, seeAllHref } from '@/features/search/rules';
import { parseUsers, type UserRow } from '@/features/users/parse';
import { requireSession } from '@/lib/auth';
import { ago, jobStatus, reportKind } from '@/lib/format';

export const metadata = { title: 'Search' };

/**
 * Search everything: workers, residents, jobs and reports in one place. It calls the same admin_*_list functions as the list
 * screens (each checks that the caller is staff), five rows per group, and links to the full list for more.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = queryFrom((await searchParams).q);
  const state = searchState(q);
  const { supabase, user } = await requireSession();

  let workers = parseUsers(null);
  let residents = parseUsers(null);
  let jobs = parseJobs(null);
  let reports = parseReports(null);
  let failed = false;

  if (state === 'ready') {
    const [w, r, j, rp] = await Promise.all([
      supabase.rpc('admin_users_list', { p_role: 'worker', p_state: 'all', p_search: q, p_limit: PER_GROUP, p_offset: 0 }),
      supabase.rpc('admin_users_list', { p_role: 'resident', p_state: 'all', p_search: q, p_limit: PER_GROUP, p_offset: 0 }),
      supabase.rpc('admin_jobs_list', { p_today: false, p_search: q, p_limit: PER_GROUP, p_offset: 0 }),
      supabase.rpc('admin_reports_list', { p_tab: 'all', p_search: q, p_limit: PER_GROUP, p_offset: 0 }),
    ]);
    failed = Boolean(w.error || r.error || j.error || rp.error);
    workers = parseUsers(w.error ? null : w.data);
    residents = parseUsers(r.error ? null : r.data);
    jobs = parseJobs(j.error ? null : j.data);
    reports = parseReports(rp.error ? null : rp.data);
  }
  const total = workers.total + residents.total + jobs.total + reports.total;

  return (
    <PortalFrame supabase={supabase} user={user} active="/search" title="Search" sub={state === 'ready' ? `Results for "${q}"` : 'Find a worker, resident, job or report'}>
      <form action="/search" method="get" role="search" className="card row g8" style={{ padding: 12 }}>
        <input className="inp fx" name="q" defaultValue={q} placeholder="Name, phone, CNIC, job ID or case number" aria-label="Search everything" maxLength={80} autoComplete="off" autoFocus={state !== 'ready'} />
        <button className="btn" type="submit">Search</button>
      </form>

      {state === 'empty' ? <p className="mut">Type a name, phone number, CNIC, job ID (DW-2086) or case number (RP-0405).</p> : null}
      {state === 'short' ? <p className="mut">Type at least 2 characters.</p> : null}
      {failed ? <div className="note red" role="alert">Part of the search could not be loaded. Reload the page. If it keeps happening, sign out and in again.</div> : null}
      {state === 'ready' && !failed && total === 0 ? <div className="card mut" style={{ padding: 24, textAlign: 'center' }}>Nothing found for &quot;{q}&quot;. Check the spelling, or try a phone number or job ID.</div> : null}

      {workers.rows.length > 0 ? (
        <Group title="Workers" more={moreText(workers.total, workers.rows.length)} href={seeAllHref.workers(q)}>
          {workers.rows.map((u) => (
            <Row key={u.id} href={`/users/${u.id}`} main={u.name} sub={[u.phone, u.categories, u.phases.length ? `Phase ${u.phases.join(', ')}` : null].filter(Boolean).join(' · ')} right={<UserChip u={u} />} />
          ))}
        </Group>
      ) : null}

      {residents.rows.length > 0 ? (
        <Group title="Residents" more={moreText(residents.total, residents.rows.length)} href={seeAllHref.residents(q)}>
          {residents.rows.map((u) => (
            <Row key={u.id} href={`/users/${u.id}`} main={u.name} sub={[u.phone, u.phases.length ? `Phase ${u.phases.join(', ')}` : null, `${u.jobsCount} jobs`].filter(Boolean).join(' · ')} right={<UserChip u={u} />} />
          ))}
        </Group>
      ) : null}

      {jobs.rows.length > 0 ? (
        <Group title="Jobs" more={moreText(jobs.total, jobs.rows.length)} href={seeAllHref.jobs(q)}>
          {jobs.rows.map((j) => {
            const s = jobStatus(j.status);
            return <Row key={j.id} href={`/jobs/${j.id}`} main={`${j.code} · ${j.title}`} sub={[j.residentName, j.workerName, `Phase ${j.phase}`, ago(j.updatedAt)].filter(Boolean).join(' · ')} right={<Chip tone={s.tone}>{s.label}</Chip>} />;
          })}
        </Group>
      ) : null}

      {reports.rows.length > 0 ? (
        <Group title="Reports" more={moreText(reports.total, reports.rows.length)} href={seeAllHref.reports(q)}>
          {reports.rows.map((r) => {
            const k = reportKind(r.kind);
            return <Row key={r.id} href={`/reports/${r.id}`} main={`${r.code} · ${k.label}`} sub={[r.jobCode, `${r.reporterName} reported ${r.againstName}`, ago(r.createdAt)].filter(Boolean).join(' · ')} right={<Chip tone={r.status === 'resolved' ? 'ok' : 'wait'}>{r.status === 'resolved' ? 'Resolved' : 'Open'}</Chip>} />;
          })}
        </Group>
      ) : null}
    </PortalFrame>
  );
}

function UserChip({ u }: { u: UserRow }) {
  if (u.accountStatus === 'suspended') return <Chip tone="red">Suspended</Chip>;
  if (u.openReports > 0) return <Chip tone="wait">{u.openReports} open</Chip>;
  return <Chip tone="ok">Active</Chip>;
}

function Group({ title, more, href, children }: { title: string; more: string | null; href: string; children: ReactNode }) {
  return (
    <div className="card col" style={{ gap: 0, padding: '16px 20px 8px' }}>
      <div className="row sb" style={{ marginBottom: 6 }}>
        <h2 className="h2">{title}</h2>
        {more ? (
          <Link className="btn out sm" href={href}>
            {more}
          </Link>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Row({ href, main, sub, right }: { href: string; main: string; sub: string; right: ReactNode }) {
  return (
    <Link className="row" href={href} style={{ textDecoration: 'none', color: 'inherit', padding: '11px 0', borderTop: '1px solid var(--line)' }}>
      <div className="fx" style={{ minWidth: 0 }}>
        <div className="b">{main}</div>
        {sub ? (
          <div className="mut" style={{ fontSize: 13 }}>
            {sub}
          </div>
        ) : null}
      </div>
      {right}
    </Link>
  );
}
