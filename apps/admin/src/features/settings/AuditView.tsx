import { ClearAllBar, EmptyRow, LoadError, PagerBar } from '@/components/ListBits';
import { Select } from '@/components/Select';
import { requireSession } from '@/lib/auth';
import { buildHref, dateTime, lastPage, PAGE_SIZE, pageNumber } from '@/lib/format';
import { isUuid } from '@/lib/json';
import { parseAudit } from './parse';
import { actionLabel, changeText } from './rules';

export type AuditParams = { admin?: string; action?: string; from?: string; to?: string; page?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): string | null => (typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const shortRecord = (r: string | null) => (r && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(r) ? r.slice(0, 8) : r);

/** The audit log: who did what and when, newest first. Read-only; filters by admin, action and dates. */
export async function AuditView({ params }: { params: AuditParams }) {
  const { supabase } = await requireSession();
  const admin = isUuid(params.admin) ? params.admin : null;
  const action = typeof params.action === 'string' && /^[a-z_]{1,60}$/.test(params.action) ? params.action : null;
  const from = day(params.from);
  const to = day(params.to);
  const page = pageNumber(params.page);

  const { data, error } = await supabase.rpc('admin_audit_list', {
    p_actor: admin ?? undefined, p_action: action ?? undefined, p_from: from ?? undefined, p_to: to ?? undefined,
    p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE,
  });
  const a = parseAudit(error ? null : data);
  const base = (over: Record<string, string | number | null>) => buildHref('/settings', { tab: 'audit', admin, action, from, to, ...over });
  const adminName = a.admins.find((x) => x.id === admin)?.name;
  const active = [adminName ? `By ${adminName}` : admin ? 'One admin' : null, action ? actionLabel(action) : null, from ? `From ${from}` : null, to ? `Up to ${to}` : null].filter((x): x is string => x !== null);

  return (
    <div className="col" style={{ gap: 16 }}>
      <form action="/settings" method="get" className="row wrap g8" style={{ alignItems: 'flex-end' }} key={`${admin ?? ''}-${action ?? ''}-${from ?? ''}-${to ?? ''}`}>
        <input type="hidden" name="tab" value="audit" />
        <Select compact autoSubmit width={190} name="admin" ariaLabel="Admin" placeholder="All admins" allLabel="All admins" defaultValue={admin ?? ''} options={a.admins.map((x) => ({ value: x.id, label: x.name }))} />
        <Select compact autoSubmit width={230} name="action" ariaLabel="Action" placeholder="All actions" allLabel="All actions" defaultValue={action ?? ''} options={a.actions.map((x) => ({ value: x, label: actionLabel(x) }))} />
        <label className="row g8 b" style={{ fontSize: 13 }}>From <input className="inp" type="date" name="from" defaultValue={from ?? ''} style={{ height: 36, width: 150 }} /></label>
        <label className="row g8 b" style={{ fontSize: 13 }}>To <input className="inp" type="date" name="to" defaultValue={to ?? ''} style={{ height: 36, width: 150 }} /></label>
        <button className="btn soft sm" type="submit">Show</button>
      </form>
      {error ? <LoadError /> : null}
      <div className="tw">
        <table className="tbl compact">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th><th>Change or reason</th></tr></thead>
          <tbody>
            {a.rows.length === 0 ? <EmptyRow cols={5} text={active.length > 0 ? 'Nothing matches these filters.' : 'No entries yet.'} /> : null}
            {a.rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}><b>{dateTime(r.at)}</b></td>
                <td>{r.actor ?? <span className="mut">System</span>}</td>
                <td>{actionLabel(r.action)}</td>
                <td className="mut" style={{ fontSize: 12.5 }}>{[r.table, shortRecord(r.record)].filter(Boolean).join(' · ') || '-'}</td>
                <td style={{ overflowWrap: 'anywhere', maxWidth: 420 }}>{changeText(r) || <span className="mut">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PagerBar shown={a.rows.length} total={a.total} page={page} last={lastPage(a.total)} noun="entries" hrefFor={(p) => base({ page: p })} />
      <ClearAllBar active={active} href="/settings?tab=audit" />
      <div className="mut" style={{ fontSize: 12.5 }}>The log cannot be edited or deleted. Sign-in IP addresses are on the Admin accounts page (they are not stored per action).</div>
    </div>
  );
}
