import { Select } from '@/components/Select';
import Link from 'next/link';
import { PortalFrame } from '@/components/PortalFrame';
import { EmptyRow, LoadError, PagerBar, PillRow, SearchBox } from '@/components/ListBits';
import { Chip } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { ago, buildHref, JOB_FILTERS, jobStatus, lastPage, pageNumber, parseJobFilter, rupees, searchText } from '@/lib/format';
import { loadFilterOptions, loadJobCounts, loadJobs } from './queries';

type Params = { status?: string; phase?: string; cat?: string; today?: string; q?: string; page?: string };

function smallInt(v: unknown, max: number): number | null {
  return typeof v === 'string' && /^[0-9]{1,4}$/.test(v) && Number(v) >= 1 && Number(v) <= max ? Number(v) : null;
}

/** All jobs (A10): status pills with counts, phase / category / today filters, the table and paging. */
export async function JobsView({ params }: { params: Params }) {
  const { supabase, user } = await requireSession();
  const status = parseJobFilter(params.status);
  const phase = smallInt(params.phase, 8);
  const category = smallInt(params.cat, 1000);
  const today = params.today === '1';
  const q = searchText(params.q);
  const page = pageNumber(params.page);

  const [counts, options, result] = await Promise.all([loadJobCounts(supabase), loadFilterOptions(supabase), loadJobs(supabase, { status, phase, category, today, q, page })]);
  const { rows, total } = result.list;
  const base = (over: Record<string, string | number | null | false>) => buildHref('/jobs', { status, phase, cat: category, today: today && '1', q, ...over });
  const pill = (key: string, label: string, n: number) => ({ key, label: `${label} ${n}`, href: base({ status: key === 'all' ? null : key, page: null }) });

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active="/jobs"
      title="All jobs"
      sub="Every job from request to cash paid. Open one to see its full timeline."
      right={<SearchBox action="/jobs" q={q} placeholder="Search job ID, resident or worker" keep={{ status, phase: phase ? String(phase) : null, cat: category ? String(category) : null, today: today ? '1' : null }} />}
    >
      <PillRow
        active={status ?? 'all'}
        pills={[
          pill('all', 'All', counts.total),
          ...JOB_FILTERS.map((s) => pill(s, jobStatus(s).label, s === 'scheduled' ? (counts.byStatus.scheduled ?? 0) + (counts.byStatus.accepted ?? 0) : s === 'cash_collected' ? (counts.byStatus.cash_collected ?? 0) + (counts.byStatus.reviewed ?? 0) : (counts.byStatus[s] ?? 0))),
        ]}
      />
      <form action="/jobs" method="get" className="row wrap g8" style={{ alignItems: 'center' }}>
        {status ? <input type="hidden" name="status" value={status} /> : null}
        {q ? <input type="hidden" name="q" value={q} /> : null}
        <Select compact width={150} name="phase" ariaLabel="Phase" placeholder="All phases" allLabel="All phases" defaultValue={String(phase ?? '')} options={options.phases.map((p) => ({ value: String(p), label: `Phase ${p}` }))} />
        <Select compact width={190} name="cat" ariaLabel="Category" placeholder="All categories" allLabel="All categories" defaultValue={String(category ?? '')} options={options.categories.map((c) => ({ value: String(c.id), label: c.name }))} />
        <label className="row g8 b" style={{ fontSize: 13 }}><input type="checkbox" name="today" value="1" defaultChecked={today} /> Posted today</label>
        <button className="btn soft sm" type="submit">Apply</button>
        <span className="fx" />
        <Link className="pill" href="/jobs/cancellations">Cancellation requests{counts.cancellationsPending ? ` ${counts.cancellationsPending}` : ''}</Link>
        <span className="mut b" style={{ fontSize: 13 }}>Newest update first</span>
      </form>
      {!result.ok ? <LoadError /> : null}

      <div className="tw">
        <table className="tbl">
          <thead>
            <tr><th>Job</th><th>Service</th><th>Resident</th><th>Worker</th><th>Area</th><th>Quote</th><th>Status</th><th>Updated</th><th>Flag</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow cols={9} text={q || status || phase || category || today ? 'No job matches these filters.' : 'No jobs yet.'} /> : null}
            {rows.map((j) => {
              const st = jobStatus(j.status);
              return (
                <tr key={j.id}>
                  <td><Link href={`/jobs/${j.id}`} className="xb" style={{ color: 'var(--g)', textDecoration: 'none' }}>{j.code}</Link></td>
                  <td>{j.title}</td>
                  <td>{j.residentName}</td>
                  <td>{j.workerName ?? <span className="mut">Nobody yet</span>}</td>
                  <td>Phase {j.phase}</td>
                  <td>{j.quoteTotal === null ? <span className="mut">No quote</span> : rupees(j.quoteTotal)}</td>
                  <td><Chip tone={st.tone}>{st.label}</Chip></td>
                  <td><b>{ago(j.updatedAt)}</b></td>
                  <td>
                    <div className="row g4 wrap">
                      {j.openReports > 0 ? <Chip tone="red">Report</Chip> : null}
                      {j.cancelPending ? <Chip tone="pur">Cancel request</Chip> : null}
                      {j.underReview ? <Chip tone="wait">Under review</Chip> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PagerBar shown={rows.length} total={total} page={page} last={lastPage(total)} noun="jobs" hrefFor={(p) => base({ page: p })} />
    </PortalFrame>
  );
}
