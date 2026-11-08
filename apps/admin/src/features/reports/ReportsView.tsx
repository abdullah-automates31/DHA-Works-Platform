import Link from 'next/link';
import { PortalFrame } from '@/components/PortalFrame';
import { EmptyRow, LoadError, PagerBar, PillRow, SearchBox, TabBar } from '@/components/ListBits';
import { Chip, Icon, ICONS } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { ago, buildHref, lastPage, pageNumber, reportKind, reportStatus, REPORT_KIND_KEYS, searchText } from '@/lib/format';
import { sentence } from '@/lib/format';
import { isKind, loadReportCounts, loadReports } from './queries';

type Params = { tab?: string; kind?: string; q?: string; page?: string };

/** Reports and disputes (A07): tabs, type pills, table with unsafe cases first, and four small numbers. */
export async function ReportsView({ params }: { params: Params }) {
  const { supabase, user } = await requireSession();
  const tab = params.tab === 'resolved' || params.tab === 'all' ? params.tab : 'open';
  const kind = isKind(params.kind) ? params.kind : null;
  const q = searchText(params.q);
  const page = pageNumber(params.page);

  const [counts, result] = await Promise.all([loadReportCounts(supabase), loadReports(supabase, { tab, kind, q, page })]);
  const { rows, total } = result.list;
  const base = (over: Record<string, string | number | null>) => buildHref('/reports', { tab: tab === 'open' ? null : tab, kind, q, ...over });
  const diff = counts.resolvedThisWeek - counts.resolvedLastWeek;

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active="/reports"
      title="Reports and disputes"
      sub="Problems reported by workers and residents. Unsafe cases always come first."
      right={<SearchBox action="/reports" q={q} placeholder="Search case, job or name" keep={{ tab: tab === 'open' ? null : tab, kind }} />}
    >
      <TabBar
        active={tab}
        tabs={[
          { key: 'open', label: 'Open', count: counts.open, href: buildHref('/reports', { kind, q }) },
          { key: 'resolved', label: 'Resolved', count: counts.resolved, href: buildHref('/reports', { tab: 'resolved', kind, q }) },
          { key: 'all', label: 'All', count: counts.all, href: buildHref('/reports', { tab: 'all', kind, q }) },
        ]}
      />
      <PillRow
        active={kind ?? 'all'}
        pills={[{ key: 'all', label: 'All types', href: base({ kind: null, page: null }) }, ...REPORT_KIND_KEYS.map((k) => ({ key: k, label: reportKind(k).label, href: base({ kind: k, page: null }) }))]}
      />
      {!result.ok ? <LoadError /> : null}

      <div className="tw">
        <table className="tbl">
          <thead>
            <tr>
              <th>Type</th><th>Case</th><th>Reported by</th><th>Against</th><th>Job</th><th>Status</th><th>Opened</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow cols={8} text={q || kind ? 'No case matches this search.' : tab === 'open' ? 'No open cases. Nothing needs attention.' : 'Nothing here.'} /> : null}
            {rows.map((r) => {
              const k = reportKind(r.kind);
              const st = reportStatus(r.status);
              const hot = r.kind === 'unsafe' && r.status !== 'resolved';
              return (
                <tr key={r.id} style={hot ? { background: '#FDF1EF' } : undefined}>
                  <td><Chip tone={k.tone}>{k.label}</Chip></td>
                  <td className="xb">{r.code}</td>
                  <td><div className="xb">{r.systemGenerated ? 'System' : r.reporterName}</div><div className="mut" style={{ fontSize: 12.5 }}>{r.systemGenerated ? 'Automatic' : sentence(r.reporterRole)}</div></td>
                  <td><div className="xb">{r.againstName}</div><div className="mut" style={{ fontSize: 12.5 }}>{sentence(r.againstRole)}</div></td>
                  <td>{r.jobCode} · {r.jobTitle}</td>
                  <td><Chip tone={st.tone}>{st.label}</Chip></td>
                  <td><b>{ago(r.createdAt)}</b></td>
                  <td style={{ textAlign: 'right' }}><Link className={`btn sm${hot ? ' red' : ''}`} href={`/reports/${r.id}`}>Open case</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PagerBar shown={rows.length} total={total} page={page} last={lastPage(total)} noun="cases" hrefFor={(p) => base({ page: p })} />

      <div className="note y"><Icon>{ICONS.info}</Icon>Reports can be sent from the day a job starts until shortly after it is completed. Unsafe cases should be called back immediately.</div>

      <div className="grid4">
        <div className="card stat"><span>Resolved this week</span><b>{counts.resolvedThisWeek}</b><span>{diff === 0 ? 'Same as last week' : diff > 0 ? `${diff} more than last week` : `${-diff} fewer than last week`}</span></div>
        <div className="card stat"><span>Time to first call</span><b>{counts.firstCallMinutes === null ? '-' : `${counts.firstCallMinutes} min`}</b><span>On unsafe cases, this month</span></div>
        <div className="card stat"><span>Unsafe cases</span><b>{counts.unsafeMonth}</b><span>This month, {counts.unsafeOpen} still open</span></div>
        <div className="card stat"><span>Cash disputes</span><b>{counts.cashDisputesMonth}</b><span>This month</span></div>
      </div>
    </PortalFrame>
  );
}
