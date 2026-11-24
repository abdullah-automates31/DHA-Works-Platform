import Link from 'next/link';
import { ActionForm } from '@/components/FormKit';
import { EmptyRow, LoadError, PagerBar, PillRow, SearchBox, TabBar } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Chip } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { buildHref, dateTime, lastPage, PAGE_SIZE, pageNumber, phoneText, rupees, searchText } from '@/lib/format';
import { decidePaymentAction } from './actions';
import { CheckPanel } from './CheckPanel';
import { ConfirmRejectRow } from './ConfirmRejectRow';
import { ProofLink, signedProofUrls } from './ProofLink';
import { methodLabel, parseCounts, parseDuesList, parseTab, whenText, type PendingPayment, type Tab } from './parse';
import { filterByCheck, parseCheckFilter } from './screenCheck';

type Params = { tab?: string; q?: string; page?: string; check?: string };

const EMPTY: Record<Tab, string> = {
  pending: 'No payments are waiting for you.',
  overdue: 'Nobody is overdue.',
  owing: 'Nobody owes DHA anything right now.',
  suspended: 'No suspended worker has dues on record.',
  all: 'No dues yet. A due appears when a worker records the cash of a finished job and the DHA fee is switched on in Settings.',
};

/** Dues (migration 0071): what workers owe DHA, the payments waiting to be checked, and who is overdue. */
export async function DuesView({ params }: { params: Params }) {
  const { supabase, user } = await requireSession();
  const tab = parseTab(params.tab);
  const q = searchText(params.q);
  const page = pageNumber(params.page);
  const check = parseCheckFilter(params.check);

  const [countsRes, listRes] = await Promise.all([
    supabase.rpc('admin_dues_counts'),
    supabase.rpc('admin_dues_list', { p_tab: tab, p_search: q || undefined, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
  ]);
  const counts = parseCounts(countsRes.error ? null : countsRes.data);
  const list = parseDuesList(listRes.error ? null : listRes.data);
  // short-lived private links to the payment screenshots on this page (staff only: the bucket is closed to everyone else)
  const proofUrls = await signedProofUrls(supabase, list.pending.map((p) => p.proofPath));
  const now = new Date();
  const base = (over: Record<string, string | number | null>) => buildHref('/dues', { tab: tab === 'owing' ? null : tab, q: q || null, check: check === 'all' ? null : check, ...over });
  const shown = filterByCheck(list.pending, check);
  const matched = filterByCheck(list.pending, 'matches').length;

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active="/dues"
      title="Dues"
      sub="What workers owe DHA. The fee is taken out of each job's quote; the worker collects the full quote in cash and pays DHA its share."
      right={<SearchBox action="/dues" q={q} placeholder="Find a worker" keep={{ tab: tab === 'owing' ? null : tab }} />}
    >
      <div className="grid4">
        <div className="card stat"><span>Outstanding</span><b>{rupees(list.totals.owed)}</b></div>
        <div className="card stat"><span>Overdue</span><b style={list.totals.overdue > 0 ? { color: '#99191A' } : undefined}>{rupees(list.totals.overdue)}</b></div>
        <div className="card stat"><span>Payments to check</span><b>{list.totals.pending}</b></div>
        <div className="card stat"><span>Collected this month</span><b>{rupees(list.totals.collectedThisMonth)}</b></div>
      </div>

      {list.pending.length > 0 ? (
        <div className="card col" style={{ gap: 12 }}>
          <h2 className="h2">Payments to check</h2>
          <span className="mut" style={{ fontSize: 13 }}>Each screenshot is read automatically and compared with what the worker typed. That only shows where to look: compare the transaction ID with your JazzCash, Easypaisa or bank statement, then confirm or reject.</span>
          <PillRow
            active={check}
            pills={[
              { key: 'all', label: `All (${list.pending.length})`, href: base({ check: null, page: null }) },
              { key: 'matches', label: `Screenshot matches (${matched})`, href: base({ check: 'matches', page: null }) },
              { key: 'attention', label: `Needs a closer look (${list.pending.length - matched})`, href: base({ check: 'attention', page: null }) },
            ]}
          />
          {shown.length === 0 ? <span className="mut" style={{ fontSize: 13 }}>No payment matches this filter.</span> : null}
          {shown.map((p) => <PendingCard key={p.id} p={p} proofUrl={p.proofPath ? proofUrls[p.proofPath] ?? null : null} />)}
        </div>
      ) : null}

      <TabBar
        active={tab}
        tabs={[
          { key: 'owing', label: 'Owing', href: base({ tab: null, page: null }) },
          { key: 'overdue', label: 'Overdue', count: counts.overdueWorkers, href: base({ tab: 'overdue', page: null }) },
          { key: 'pending', label: 'Payments waiting', count: counts.pending, href: base({ tab: 'pending', page: null }) },
          { key: 'suspended', label: 'Suspended', href: base({ tab: 'suspended', page: null }) },
          { key: 'all', label: 'All', href: base({ tab: 'all', page: null }) },
        ]}
      />
      {listRes.error ? <LoadError /> : null}
      <div className="tw">
        <table className="tbl">
          <thead><tr><th>Worker</th><th>Owes</th><th>Overdue</th><th>Next due</th><th>Waiting</th><th>Paid so far</th><th>Account</th></tr></thead>
          <tbody>
            {list.rows.length === 0 ? <EmptyRow cols={7} text={q ? 'No worker with dues matches that search.' : EMPTY[tab]} /> : null}
            {list.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/users/${r.id}?tab=dues`} className="xb" style={{ color: 'var(--g)', textDecoration: 'none' }}>{r.name}</Link>
                  <div className="mut" style={{ fontSize: 12.5 }}>{phoneText(r.phone)}</div>
                </td>
                <td className="b">{rupees(r.owed)}</td>
                <td>{r.overdue > 0 ? <span style={{ color: '#99191A', fontWeight: 800 }}>{rupees(r.overdue)} <span className="mut" style={{ fontWeight: 600 }}>({whenText(r.overdueSince, now)})</span></span> : <span className="mut">-</span>}</td>
                <td>{r.owed > 0 && r.nextDueAt ? <>{dateTime(r.nextDueAt)}<div className="mut" style={{ fontSize: 12.5 }}>{whenText(r.nextDueAt, now)}</div></> : <span className="mut">-</span>}</td>
                <td>{r.pendingCount > 0 ? <Chip tone="wait">{rupees(r.pendingTotal)} · {r.pendingCount}</Chip> : <span className="mut">-</span>}</td>
                <td>{rupees(r.paidTotal)}</td>
                <td><Chip tone={r.suspended ? 'red' : 'ok'}>{r.suspended ? 'Suspended' : 'Active'}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PagerBar shown={list.rows.length} total={list.total} page={page} last={lastPage(list.total)} noun="workers" hrefFor={(p) => base({ page: p })} />

      <div className="card col">
        <h2 className="h2">Where workers pay</h2>
        {list.payTo ? <div style={{ whiteSpace: 'pre-wrap', fontWeight: 700 }}>{list.payTo}</div> : <span className="mut">Not set yet. Workers see &quot;DHA has not added payment details&quot;.</span>}
        <Link href="/settings?tab=dues" className="mut b" style={{ fontSize: 13, textDecoration: 'none' }}>Change it, and the fee rule, in Settings</Link>
      </div>
    </PortalFrame>
  );
}

function PendingCard({ p, proofUrl }: { p: PendingPayment; proofUrl: string | null }) {
  return (
    <div className="note g" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div className="row g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Link href={`/users/${p.workerId}?tab=dues`} className="xb" style={{ color: 'var(--g)', textDecoration: 'none' }}>{p.workerName}</Link>
        <span className="b">{rupees(p.amount)}</span>
        <Chip tone="blue">{methodLabel(p.method)}</Chip>
        <span style={{ fontWeight: 800 }}>{p.reference}</span>
        <span className="mut" style={{ fontSize: 12.5 }}>{dateTime(p.createdAt)}</span>
      </div>
      <div className="row g8" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <ProofLink url={proofUrl} />
        <CheckPanel check={p.check} payment={{ amount: p.amount, reference: p.reference, method: p.method, createdAt: p.createdAt }} />
      </div>
      <ConfirmRejectRow
        confirm={
          <ActionForm
            action={decidePaymentAction}
            hidden={{ paymentId: p.id, workerId: p.workerId, decision: 'confirm' }}
            inline
            submit="Confirm"
            fields={[{ name: 'amount', kind: 'text', label: 'Amount that arrived (Rs)', defaultValue: String(p.amount), maxLength: 12 }]}
          />
        }
        reject={
          <ActionForm
            action={decidePaymentAction}
            hidden={{ paymentId: p.id, workerId: p.workerId, decision: 'reject' }}
            submit="Reject"
            tone="red"
            fields={[{ name: 'reason', kind: 'text', label: 'Reason (the worker sees this)', placeholder: 'For example: the transaction ID was not found', maxLength: 300, required: true }]}
          />
        }
      />
    </div>
  );
}
