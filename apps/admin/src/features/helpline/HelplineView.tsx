import Link from 'next/link';
import { ButtonForm } from '@/components/FormKit';
import { EmptyRow, LoadError, PagerBar, PillRow, SearchBox } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Chip } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { buildHref, dateTime, lastPage, pageNumber, phoneText, searchText, sentence, timeOnly } from '@/lib/format';
import { PAGE_SIZE } from '@/lib/format';
import { callbackDoneAction } from './actions';
import { parseCalls, parseSummary } from './parse';
import { outcomeChip, reasonLabel } from './rules';
import { LogCallForm } from './LogCallForm';

type Params = { range?: string; cb?: string; q?: string; page?: string };

function waitText(since: string | null): string | null {
  if (!since) return null;
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 60_000));
  return min < 60 ? `Waiting ${min} min` : min < 2880 ? `Waiting ${Math.floor(min / 60)} h` : `Waiting ${Math.floor(min / 1440)} d`;
}

/** Helpline log (A09): three numbers, the call list and the form to log a call. */
export async function HelplineView({ params }: { params: Params }) {
  const { supabase, user } = await requireSession();
  const range = params.range === 'week' || params.range === 'all' ? params.range : 'today';
  const cb = params.cb === '1';
  const q = searchText(params.q);
  const page = pageNumber(params.page);

  const [summaryRes, listRes] = await Promise.all([
    supabase.rpc('admin_helpline_summary'),
    supabase.rpc('admin_helpline_list', { p_range: range, p_callback_only: cb, p_search: q || undefined, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
  ]);
  const summary = parseSummary(summaryRes.error ? null : summaryRes.data);
  const { rows, total } = parseCalls(listRes.error ? null : listRes.data);
  const base = (over: Record<string, string | number | null>) => buildHref('/helpline', { range: range === 'today' ? null : range, cb: cb ? '1' : null, q, ...over });
  const wait = waitText(summary.oldestCallbackSince);

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active="/helpline"
      title="Helpline log"
      sub="Every call to the helpline, linked to a case when there is one."
      right={<SearchBox action="/helpline" q={q} placeholder="Search name, phone or case" keep={{ range: range === 'today' ? null : range, cb: cb ? '1' : null }} />}
    >
      <div className="grid4" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
        <div className="card stat"><span>Calls today</span><b>{summary.callsToday}</b><span><Chip tone="ok">{summary.answeredToday} answered</Chip></span></div>
        <div className="card stat"><span>Callbacks pending</span><b>{summary.callbacksPending}</b><span>{wait ? <Chip tone="red">{wait}</Chip> : <Chip tone="ok">None waiting</Chip>}</span></div>
        <div className="card stat"><span>Calls that became cases</span><b>{summary.casesMonth}</b><span>This month{summary.unsafeCasesMonth ? ` · ${summary.unsafeCasesMonth} unsafe` : ''}</span></div>
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px', alignItems: 'start' }}>
        <div className="col" style={{ gap: 16 }}>
          <PillRow
            active={range}
            pills={[{ key: 'today', label: 'Today', href: base({ range: null, page: null }) }, { key: 'week', label: 'This week', href: base({ range: 'week', page: null }) }, { key: 'all', label: 'All', href: base({ range: 'all', page: null }) }]}
            right={<Link className={`pill${cb ? ' on' : ''}`} href={base({ cb: cb ? null : '1', page: null })}>Callback pending</Link>}
          />
          {listRes.error ? <LoadError /> : null}
          <div className="tw">
            <table className="tbl">
              <thead><tr><th>Time</th><th>Caller</th><th>Reason</th><th>Linked</th><th>Outcome</th></tr></thead>
              <tbody>
                {rows.length === 0 ? <EmptyRow cols={5} text={q || cb ? 'No call matches.' : 'No calls logged in this period.'} /> : null}
                {rows.map((c) => {
                  const oc = outcomeChip(c);
                  const hot = c.outcome === 'callback_pending' && !c.callbackDoneAt;
                  return (
                    <tr key={c.id} style={hot ? { background: '#FDF1EF' } : undefined}>
                      <td><b>{range === 'today' ? timeOnly(c.calledAt) : dateTime(c.calledAt)}</b></td>
                      <td>
                        <div className="xb">{c.callerName}</div>
                        <div className="mut" style={{ fontSize: 12.5 }}>{sentence(c.callerRole)} · {phoneText(c.callerPhone)}</div>
                        {c.notes ? <div className="mut" style={{ fontSize: 12.5, marginTop: 2 }}>{c.notes}</div> : null}
                      </td>
                      <td><Chip tone={c.reason === 'unsafe' ? 'red' : c.reason === 'cash_price' ? 'blue' : c.reason === 'complaint' ? 'wait' : 'gray'}>{reasonLabel(c.reason)}</Chip></td>
                      <td>{c.reportId ? <Link className="xb" href={`/reports/${c.reportId}`} style={{ color: 'var(--g)', textDecoration: 'none' }}>{c.reportCode}</Link> : <span className="mut">None</span>}</td>
                      <td>
                        <div className="col g4" style={{ alignItems: 'flex-start' }}>
                          <Chip tone={oc.tone}>{oc.label}</Chip>
                          {hot ? <ButtonForm action={callbackDoneAction} hidden={{ callId: c.id }} label="Mark done" tone="soft" /> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PagerBar shown={rows.length} total={total} page={page} last={lastPage(total)} noun="calls" hrefFor={(p) => base({ page: p })} />
        </div>
        <LogCallForm />
      </div>
    </PortalFrame>
  );
}
