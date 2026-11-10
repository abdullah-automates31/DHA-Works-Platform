import { Select } from '@/components/Select';
import Link from 'next/link';
import { EmptyRow, LoadError, PagerBar, PillRow, SearchBox, TabBar } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Avatar, Chip } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { buildHref, lastPage, pageNumber, phoneText, searchText } from '@/lib/format';
import { loadFilterOptions } from '../jobs/queries';
import { initials, phasesText } from '../verification/rules';
import { loadUserCounts, loadUsers, parseUserState, type UserState } from './queries';

type Params = { role?: string; state?: string; phase?: string; q?: string; page?: string };
const STATE_LABEL: Record<UserState, string> = { all: 'All', active: 'Active', suspended: 'Suspended', open_reports: 'With open reports' };

/** Users (A12): approved workers and residents, with their state. Suspend and reactivate live on the person's page. */
export async function UsersView({ params }: { params: Params }) {
  const { supabase, user } = await requireSession();
  const role = params.role === 'resident' ? 'resident' : 'worker';
  const state = parseUserState(params.state);
  const phase = typeof params.phase === 'string' && /^[1-8]$/.test(params.phase) ? Number(params.phase) : null;
  const q = searchText(params.q);
  const page = pageNumber(params.page);
  const isWorker = role === 'worker';

  const [counts, options, result] = await Promise.all([loadUserCounts(supabase), loadFilterOptions(supabase), loadUsers(supabase, { role, state, phase, q, page })]);
  const { rows, total } = result.list;
  const base = (over: Record<string, string | number | null>) => buildHref('/users', { role: isWorker ? null : 'resident', state: state === 'all' ? null : state, phase, q, ...over });

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active="/users"
      title="Users"
      sub="Approved workers and residents. Suspend or reactivate accounts here."
      right={<SearchBox action="/users" q={q} placeholder="Search name, phone or CNIC" keep={{ role: isWorker ? null : 'resident', state: state === 'all' ? null : state, phase: phase ? String(phase) : null }} />}
    >
      <TabBar
        active={role}
        tabs={[
          { key: 'worker', label: 'Workers', count: counts.workers, href: buildHref('/users', { state: state === 'all' ? null : state, phase, q }) },
          { key: 'resident', label: 'Residents', count: counts.residents, href: buildHref('/users', { role: 'resident', state: state === 'all' ? null : state, phase, q }) },
        ]}
      />
      <PillRow
        active={state}
        pills={(Object.keys(STATE_LABEL) as UserState[]).map((s) => ({ key: s, label: STATE_LABEL[s], href: base({ state: s === 'all' ? null : s, page: null }) }))}
        right={
          <form action="/users" method="get" className="row g8">
            {!isWorker ? <input type="hidden" name="role" value="resident" /> : null}
            {state !== 'all' ? <input type="hidden" name="state" value={state} /> : null}
            {q ? <input type="hidden" name="q" value={q} /> : null}
            <Select compact width={150} name="phase" ariaLabel="Phase" placeholder="All phases" allLabel="All phases" defaultValue={String(phase ?? '')} options={options.phases.map((p) => ({ value: String(p), label: `Phase ${p}` }))} />
            <button className="btn soft sm" type="submit">Apply</button>
          </form>
        }
      />
      {!result.ok ? <LoadError /> : null}

      <div className="tw">
        <table className="tbl">
          <thead>
            <tr>
              <th>{isWorker ? 'Worker' : 'Resident'}</th>
              {isWorker ? <><th>Category</th><th>Areas</th><th>Rating</th><th>Jobs done</th></> : <><th>Phases</th><th>Jobs posted</th></>}
              <th>Reports</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow cols={isWorker ? 8 : 6} text={q || state !== 'all' || phase ? 'Nobody matches these filters.' : 'No approved users yet.'} /> : null}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="row">
                    <Avatar initials={initials(r.name)} seed={r.id} />
                    <div><div className="xb">{r.name}</div><div className="mut" style={{ fontSize: 12.5 }}>{phoneText(r.phone)}</div></div>
                  </div>
                </td>
                {isWorker ? (
                  <>
                    <td>{r.categories ?? '-'}</td>
                    <td>{phasesText(r.phases)}</td>
                    <td><b>{r.ratingCount > 0 && r.ratingAvg !== null ? r.ratingAvg.toFixed(1) : '-'}</b></td>
                    <td>{r.jobsCount}</td>
                  </>
                ) : (
                  <>
                    <td>{phasesText(r.phases)}</td>
                    <td>{r.jobsCount}</td>
                  </>
                )}
                <td>{r.openReports > 0 ? <Chip tone="wait">{r.openReports} open</Chip> : <span className="mut">None</span>}</td>
                <td><Chip tone={r.accountStatus === 'suspended' ? 'red' : 'ok'}>{r.accountStatus === 'suspended' ? 'Suspended' : 'Active'}</Chip></td>
                <td style={{ textAlign: 'right' }}><Link className="btn out sm" href={`/users/${r.id}`}>View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PagerBar shown={rows.length} total={total} page={page} last={lastPage(total)} noun={isWorker ? 'workers' : 'residents'} hrefFor={(p) => base({ page: p })} />
    </PortalFrame>
  );
}
