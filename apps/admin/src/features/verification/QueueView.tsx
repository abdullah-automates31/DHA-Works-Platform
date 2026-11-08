import Link from 'next/link';
import { PortalFrame } from '@/components/PortalFrame';
import { Avatar, Chip, Icon, ICONS } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { loadCounts, loadFilters, loadQueue } from './queries';
import { documentsChip, initials, PAGE_SIZE, parsePositiveInt, parseTab, phasesText, phoneText, tabsFor, waitingText, type Role } from './rules';

type Params = { tab?: string; q?: string; f?: string; page?: string; done?: string };

const DONE_TEXT: Record<string, string> = {
  approve: 'Approved. The applicant has been told.',
  ask_for_changes: 'Sent back for changes. The applicant has been told what to fix.',
  visit_hq: 'Asked to visit HQ. The applicant has been told.',
  reject: 'Rejected. The applicant has been told the reason.',
};

function href(role: Role, p: { tab: string; q?: string; f?: number | null; page?: number }) {
  const sp = new URLSearchParams();
  sp.set('tab', p.tab);
  if (p.q) sp.set('q', p.q);
  if (p.f) sp.set('f', String(p.f));
  if (p.page && p.page > 1) sp.set('page', String(p.page));
  return `/${role}s?${sp.toString()}`;
}

/** The queue screen for workers (A03) and residents (A05): tabs, filter pills, search, table, paging. */
export async function QueueView({ role, params }: { role: Role; params: Params }) {
  const { supabase, user } = await requireSession();
  const tab = parseTab(role, params.tab);
  const q = (typeof params.q === 'string' ? params.q : '').trim().slice(0, 80);
  const filter = parsePositiveInt(params.f, 0, 1000) || null;
  const page = parsePositiveInt(params.page, 1, 10000);

  const [counts, filters, result] = await Promise.all([loadCounts(supabase, role), loadFilters(supabase, role), loadQueue(supabase, { role, tab, q, filter, page })]);
  const { rows, total } = result.queue;
  const last = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isWorker = role === 'worker';

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active={`/${role}s`}
      title={isWorker ? 'Worker verification' : 'Resident verification'}
      sub={isWorker ? 'Check CNIC, police certificate and voice introduction before a worker goes live.' : 'Check CNIC and a recent utility bill so only DHA residents can post jobs.'}
      right={
        <form className="srch" action={`/${role}s`} method="get" role="search">
          <Icon>{ICONS.search}</Icon>
          <input name="q" defaultValue={q} placeholder={isWorker ? 'Search by name or CNIC' : 'Search by name or plot'} aria-label={`Search ${role}s`} maxLength={80} />
          <input type="hidden" name="tab" value={tab} />
          {filter ? <input type="hidden" name="f" value={filter} /> : null}
        </form>
      }
    >
      {params.done && DONE_TEXT[params.done] ? <div className="note g" role="status"><Icon>{ICONS.check}</Icon>{DONE_TEXT[params.done]}</div> : null}
      <div className="tabs">
        {tabsFor(role).map((t) => (
          <Link key={t.key} className={`tab${t.key === tab ? ' on' : ''}`} href={href(role, { tab: t.key })}>
            {t.label}
            <em>{counts[t.key] ?? 0}</em>
          </Link>
        ))}
      </div>
      <div className="row wrap g8">
        <Link className={`pill${filter === null ? ' on' : ''}`} href={href(role, { tab, q })}>
          {isWorker ? 'All categories' : 'All phases'}
        </Link>
        {filters.map((f) => (
          <Link key={f.id} className={`pill${filter === f.id ? ' on' : ''}`} href={href(role, { tab, q, f: f.id })}>
            {f.label}
          </Link>
        ))}
        <span className="fx" />
        <span className="mut b" style={{ fontSize: 13 }}>
          Sorted by waiting time
        </span>
      </div>

      {!result.ok ? <div className="note red">The list could not be loaded. Reload the page. If it keeps happening, sign out and in again.</div> : null}

      <div className="tw">
        <table className="tbl">
          <thead>
            <tr>
              <th>{isWorker ? 'Worker' : 'Resident'}</th>
              {isWorker ? (
                <>
                  <th>Category</th>
                  <th>Areas</th>
                  <th>Documents</th>
                  <th>Voice intro</th>
                </>
              ) : (
                <>
                  <th>Address</th>
                  <th>Email</th>
                  <th>Documents</th>
                </>
              )}
              <th>Waiting</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={isWorker ? 7 : 6} className="mut" style={{ textAlign: 'center', padding: 32 }}>
                  {q || filter ? 'Nobody matches this search.' : 'Nothing here right now.'}
                </td>
              </tr>
            ) : null}
            {rows.map((r) => {
              const docs = documentsChip(role, r.documents, r.worker?.references ?? 0);
              return (
                <tr key={r.id}>
                  <td>
                    <div className="row">
                      <Avatar initials={initials(r.name)} seed={r.id} />
                      <div>
                        <div className="xb">{r.name ?? 'No name'}</div>
                        {isWorker ? <div className="mut" style={{ fontSize: 12.5 }}>{phoneText(r.phone)}</div> : null}
                      </div>
                    </div>
                  </td>
                  {isWorker ? (
                    <>
                      <td>{r.worker?.categories.join(', ') || '-'}</td>
                      <td>{phasesText(r.worker?.phases ?? [])}</td>
                      <td><Chip tone={docs.tone}>{docs.label}</Chip></td>
                      <td>{r.worker?.hasVoice ? <Chip tone="ok">Recorded</Chip> : <Chip tone="red">Not recorded</Chip>}</td>
                    </>
                  ) : (
                    <>
                      <td>{r.address ? `Phase ${r.address.phase} · ${r.address.lane} · ${r.address.plotNo}` : '-'}</td>
                      <td className="mut">{r.email ?? '-'}</td>
                      <td><Chip tone={docs.tone}>{docs.label}</Chip></td>
                    </>
                  )}
                  <td><b>{waitingText(r.waitingSince)}</b></td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="btn sm" href={`/${role}s/${r.id}`}>Review</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row sb">
        <span className="mut b" style={{ fontSize: 13 }}>
          Showing {rows.length} of {total}
        </span>
        <div className="row g8">
          {page > 1 ? <Link className="btn out sm" href={href(role, { tab, q, f: filter, page: page - 1 })}>Previous</Link> : null}
          {page < last ? <Link className="btn out sm" href={href(role, { tab, q, f: filter, page: page + 1 })}>Next</Link> : null}
        </div>
      </div>
    </PortalFrame>
  );
}
