import { ActionForm, ButtonForm } from '@/components/FormKit';
import { EmptyRow, LoadError, PagerBar, PillRow, TabBar } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Avatar, Chip } from '@/components/ui';
import { loadAvatarSrcs } from '@/lib/avatars';
import { requireSession } from '@/lib/auth';
import { buildHref, dateTime, lastPage, pageNumber, phoneText } from '@/lib/format';
import { PAGE_SIZE } from '@/lib/format';
import { safeStoragePath } from '@/features/verification/parse';
import { approveAction, rejectAction, replyAction, reviewedAction } from './actions';
import { KIND_LABEL, bucketForDoc, docLabel, parseCounts, parseRequests, type RequestRow } from './parse';

type Params = { kind?: string; status?: string; page?: string };
const TABS = ['all', 'support', 'document', 'changes'] as const;
type Tab = (typeof TABS)[number];

const STATUS_CHIP: Record<string, { tone: 'wait' | 'ok' | 'red' | 'gray'; label: string }> = {
  open: { tone: 'wait', label: 'Waiting' },
  done: { tone: 'ok', label: 'Done' },
  approved: { tone: 'ok', label: 'Approved' },
  rejected: { tone: 'red', label: 'Rejected' },
};

/** Worker requests (migration 0067): messages to answer, replacement documents to approve, name and number changes to review. */
export async function RequestsView({ params }: { params: Params }) {
  const { supabase, user } = await requireSession();
  const tab: Tab = (TABS as readonly string[]).includes(params.kind ?? '') ? (params.kind as Tab) : 'all';
  const status = params.status === 'closed' ? 'closed' : 'open';
  const page = pageNumber(params.page);

  const [countsRes, listRes] = await Promise.all([
    supabase.rpc('admin_requests_counts'),
    supabase.rpc('admin_requests_list', { p_kind: tab === 'all' ? undefined : tab, p_status: status, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
  ]);
  const counts = parseCounts(countsRes.error ? null : countsRes.data);
  const { rows, total } = parseRequests(listRes.error ? null : listRes.data);

  const avatars = await loadAvatarSrcs(supabase, rows.map((r) => r.workerId));

  // Short-lived links for the files of the replacement documents shown on this page (staff only: the identity bucket is closed to everyone else).
  const urls: Record<string, string> = {};
  for (const bucket of ['identity', 'worker-media'] as const) {
    const paths = rows.filter((r) => r.kind === 'document' && r.path && safeStoragePath(r.path) && bucketForDoc(r.docType) === bucket).map((r) => r.path as string);
    if (paths.length === 0) continue;
    const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 300);
    for (const item of data ?? []) if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }

  const base = (over: Record<string, string | number | null>) => buildHref('/requests', { kind: tab === 'all' ? null : tab, status: status === 'open' ? null : status, ...over });

  return (
    <PortalFrame supabase={supabase} user={user} active="/requests" title="Worker requests" sub="Messages from workers, new documents to check, and name or number changes to review.">
      <TabBar
        active={tab}
        tabs={[
          { key: 'all', label: 'All', count: counts.open, href: base({ kind: null, page: null }) },
          { key: 'support', label: 'Messages', count: counts.support, href: base({ kind: 'support', page: null }) },
          { key: 'document', label: 'Documents', count: counts.document, href: base({ kind: 'document', page: null }) },
          { key: 'changes', label: 'Name and number changes', count: counts.changes, href: base({ kind: 'changes', page: null }) },
        ]}
      />
      <PillRow
        active={status}
        pills={[
          { key: 'open', label: 'Open', href: base({ status: null, page: null }) },
          { key: 'closed', label: 'Closed', href: base({ status: 'closed', page: null }) },
        ]}
      />
      {listRes.error ? <LoadError /> : null}
      <div className="col" style={{ gap: 12 }}>
        {rows.length === 0 ? (
          <table className="tbl"><tbody><EmptyRow cols={1} text={status === 'open' ? 'Nothing is waiting for you.' : 'Nothing closed yet.'} /></tbody></table>
        ) : null}
        {rows.map((r) => <RequestCard key={r.id} r={r} url={r.path ? urls[r.path] ?? null : null} avatar={avatars[r.workerId] ?? null} />)}
      </div>
      <PagerBar shown={rows.length} total={total} page={page} last={lastPage(total)} noun="requests" hrefFor={(p) => base({ page: p })} />
    </PortalFrame>
  );
}

function RequestCard({ r, url, avatar }: { r: RequestRow; url: string | null; avatar: string | null }) {
  const chip = STATUS_CHIP[r.status] ?? { tone: 'gray' as const, label: r.status };
  const open = r.status === 'open';
  return (
    <div className="card col" style={{ gap: 10 }}>
      <div className="row g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip tone="blue">{KIND_LABEL[r.kind]}</Chip>
        <Chip tone={chip.tone}>{chip.label}</Chip>
        <span className="mut" style={{ fontSize: 12.5 }}>{dateTime(r.createdAt)}</span>
        <span style={{ flex: 1 }} />
        <Avatar initials={r.workerName.trim().split(/s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'} seed={r.workerId} src={avatar} />
        <a className="xb" href={`/workers/${r.workerId}`} style={{ color: 'var(--g)', textDecoration: 'none' }}>{r.workerName}</a>
        <span className="mut" style={{ fontSize: 12.5 }}>{phoneText(r.workerPhone)}</span>
      </div>

      {r.kind === 'support' ? (
        <>
          <div className="xb">{r.subject}</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{r.body}</div>
          {r.reply ? <div className="note g" style={{ padding: '10px 12px', fontSize: 13 }}><b>Your answer:</b> {r.reply}</div> : null}
          {open ? (
            <ActionForm action={replyAction} hidden={{ requestId: r.id }} fields={[{ name: 'reply', kind: 'textarea', label: 'Answer', placeholder: 'Write the answer the worker will see.', maxLength: 1000, required: true, rows: 3 }]} submit="Send answer" />
          ) : null}
        </>
      ) : null}

      {r.kind === 'document' ? (
        <>
          <div className="xb">{docLabel(r.docType)}</div>
          {url ? (
            <div className="row g8">
              {/\.pdf$/i.test(r.path ?? '') ? (
                <a className="btn soft" href={url} target="_blank" rel="noopener noreferrer">Open the PDF</a>
              ) : (
                <a href={url} target="_blank" rel="noopener noreferrer" className="doc" style={{ width: 140, height: 140, overflow: 'hidden' }} aria-label={`Open ${docLabel(r.docType)} full size`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={docLabel(r.docType)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </a>
              )}
            </div>
          ) : <div className="mut" style={{ fontSize: 13 }}>The file link is only made for open requests.</div>}
          {r.reply ? <div className="note" style={{ padding: '10px 12px', fontSize: 13 }}><b>Reason given:</b> {r.reply}</div> : null}
          {open ? (
            <div className="col" style={{ gap: 10 }}>
              <div className="mut" style={{ fontSize: 12.5 }}>Approving replaces the file on the worker&apos;s verification record. Rejecting keeps the old one.</div>
              <ButtonForm action={approveAction} hidden={{ requestId: r.id }} label="Approve new document" tone="green" />
              <ActionForm action={rejectAction} hidden={{ requestId: r.id }} fields={[{ name: 'reason', kind: 'text', label: 'Reason (the worker sees this)', placeholder: 'For example: the photo is blurry', maxLength: 1000, required: true }]} submit="Reject" tone="red" />
            </div>
          ) : null}
        </>
      ) : null}

      {r.kind === 'name_change' || r.kind === 'phone_change' ? (
        <>
          <div style={{ fontSize: 14 }}>
            <span className="mut">{r.kind === 'name_change' ? 'Name' : 'Sign-in number'}: </span>
            <s>{r.kind === 'phone_change' ? phoneText(r.oldValue) : r.oldValue}</s> &rarr; <b>{r.kind === 'phone_change' ? phoneText(r.newValue) : r.newValue}</b>
          </div>
          <div className="mut" style={{ fontSize: 12.5 }}>
            {r.kind === 'name_change' ? 'Check the new name against the CNIC on the worker record.' : 'The worker confirmed the new number with a code sent to it.'}
          </div>
          {open ? <ButtonForm action={reviewedAction} hidden={{ requestId: r.id }} label="Mark as reviewed" tone="soft" /> : null}
        </>
      ) : null}
    </div>
  );
}
