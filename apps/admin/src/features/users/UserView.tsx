import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/FormKit';
import { LoadError, PagerBar, TabBar } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Avatar, Chip } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { buildHref, dateOnly, dateTime, jobStatus, lastPage, PAGE_SIZE, pageNumber, rupees } from '@/lib/format';
import { isUuid } from '@/lib/json';
import { parseReviews } from '../reviews/parse';
import { ReviewsTable } from '../reviews/ReviewsTable';
import { DOC_LABEL, initials, phasesText, phoneText, type DocType } from '../verification/rules';
import { addStaffNoteAction, sendMessageAction, setAccountStatusAction } from './actions';
import { loadUserDetail, userDocUrls } from './queries';

/** One person (A13): details, numbers, recent jobs, documents, reviews, staff notes and the account controls. */
export async function UserView({ id, params }: { id: string; params: { tab?: string; page?: string } }) {
  const { supabase, user } = await requireSession();
  if (!isUuid(id)) notFound();
  const d = await loadUserDetail(supabase, id);
  if (!d) notFound();
  const isWorker = d.role === 'worker';
  const tab = isWorker && params.tab === 'reviews' ? 'reviews' : 'overview';
  const page = pageNumber(params.page);
  const urls = await userDocUrls(supabase, d);
  const suspended = d.accountStatus === 'suspended';
  const photo = d.documents.find((x) => x.type === 'profile_photo');
  const photoUrl = photo ? urls[photo.path] : undefined;

  let reviews: ReturnType<typeof parseReviews> | null = null;
  let reviewsFailed = false;
  if (tab === 'reviews') {
    const res = await supabase.rpc('admin_reviews_list', { p_stars: 'all', p_worker: d.id, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE });
    reviewsFailed = !!res.error;
    reviews = parseReviews(res.error ? null : res.data);
  }

  const stats = isWorker
    ? [
        { label: 'Jobs done', value: String(d.worker?.jobsDone ?? 0) },
        { label: 'Rating (staff only)', value: d.worker && d.worker.ratingCount > 0 && d.worker.ratingAvg !== null ? d.worker.ratingAvg.toFixed(1) : '-' },
        { label: 'Open reports', value: String(d.openReports) },
        { label: 'Past suspensions', value: String(d.pastSuspensions) },
      ]
    : [
        { label: 'Jobs posted', value: String(d.jobsCount) },
        { label: 'Open reports', value: String(d.openReports) },
        { label: 'Past suspensions', value: String(d.pastSuspensions) },
        { label: 'Account', value: suspended ? 'Suspended' : 'Active' },
      ];
  const docTypes: DocType[] = isWorker ? ['cnic_front', 'cnic_back', 'police_cert', 'profile_photo'] : ['cnic_front', 'cnic_back', 'utility_bill'];

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active="/users"
      title={d.name}
      sub={`${isWorker ? 'Worker' : 'Resident'} · joined ${dateOnly(d.createdAt)}`}
      back={{ href: isWorker ? '/users' : '/users?role=resident', label: 'Users' }}
      right={<div className="row g8"><Chip tone="ok">{isWorker ? 'Verified worker' : 'Verified resident'}</Chip><Chip tone={suspended ? 'red' : 'ok'}>{suspended ? 'Suspended' : 'Active'}</Chip></div>}
    >
      {suspended ? <div className="note red" role="status"><span><b>Suspended {dateTime(d.suspendedAt)}.</b> {d.suspendedUntil ? <>It ends {dateTime(d.suspendedUntil)} by itself. </> : <>It lasts until you reactivate the account. </>}{d.suspensionReason ?? ''}</span></div> : null}
      <div className="split">
        <div className="col" style={{ gap: 20 }}>
          <div className="card row" style={{ gap: 18, alignItems: 'flex-start' }}>
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt={d.name} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
            ) : <Avatar initials={initials(d.name)} seed={d.id} large />}
            <dl className="kv" style={{ gridTemplateColumns: '90px minmax(0,1fr) 110px minmax(0,1fr)', flex: 1, margin: 0 }}>
              <dt>Phone</dt><dd>{phoneText(d.phone)}</dd>
              {isWorker ? <><dt>Category</dt><dd>{d.categories.join(', ') || '-'}</dd></> : <><dt>Email</dt><dd style={{ overflowWrap: 'anywhere' }}>{d.email ?? '-'}</dd></>}
              {isWorker ? <><dt>Areas</dt><dd>{phasesText(d.phases)}</dd></> : <><dt>Address</dt><dd>{d.addresses[0] ? `Phase ${d.addresses[0].phase}, ${d.addresses[0].lane}, House ${d.addresses[0].plotNo}` : '-'}</dd></>}
              <dt>CNIC</dt><dd>{d.cnicMasked ?? '-'}</dd>
              <dt>Verified</dt><dd>{dateOnly(d.verifiedAt)}</dd>
              {isWorker ? <><dt>Experience</dt><dd>{d.worker?.experienceYears != null ? `${d.worker.experienceYears} years` : '-'}</dd></> : null}
            </dl>
          </div>

          <div className="grid4">
            {stats.map((s) => <div key={s.label} className="card stat"><span>{s.label}</span><b className={/^[0-9.\-]+$/.test(s.value) ? undefined : 'txt'}>{s.value}</b></div>)}
          </div>

          {isWorker ? (
            <TabBar
              active={tab}
              tabs={[
                { key: 'overview', label: 'Overview', href: `/users/${d.id}` },
                { key: 'reviews', label: 'Reviews', count: reviews?.total, href: `/users/${d.id}?tab=reviews` },
              ]}
            />
          ) : null}

          {tab === 'reviews' && reviews ? (
            <>
              {reviewsFailed ? <LoadError /> : null}
              <ReviewsTable rows={reviews.rows} showWorker={false} empty="No reviews for this worker yet." />
              <PagerBar shown={reviews.rows.length} total={reviews.total} page={page} last={lastPage(reviews.total)} noun="reviews" hrefFor={(p) => buildHref(`/users/${d.id}`, { tab: 'reviews', page: p })} />
            </>
          ) : (
            <>
              <div className="tw">
                <div className="row sb" style={{ padding: '16px 20px 8px' }}><h2 className="h2">Recent jobs</h2><Link href={`/jobs?q=${encodeURIComponent(d.name)}`} className="mut b" style={{ fontSize: 13, textDecoration: 'none' }}>See all jobs</Link></div>
                <table className="tbl compact">
                  <thead><tr><th>Job</th><th>Service</th><th>{isWorker ? 'Resident' : 'Worker'}</th><th>Quote</th><th>Status</th></tr></thead>
                  <tbody>
                    {d.recentJobs.length === 0 ? <tr><td colSpan={5} className="mut" style={{ textAlign: 'center', padding: 24 }}>No jobs yet.</td></tr> : null}
                    {d.recentJobs.map((j) => {
                      const st = jobStatus(j.status);
                      return (
                        <tr key={j.id}>
                          <td><Link href={`/jobs/${j.id}`} className="xb" style={{ color: 'var(--g)', textDecoration: 'none' }}>{j.code}</Link></td>
                          <td>{j.title}</td>
                          <td>{j.otherName ?? <span className="mut">Nobody yet</span>}</td>
                          <td>{j.quoteTotal === null ? <span className="mut">No quote</span> : rupees(j.quoteTotal)}</td>
                          <td><Chip tone={st.tone}>{st.label}</Chip></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="card col">
                <h2 className="h2">Documents</h2>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${docTypes.length},minmax(0,1fr))`, gap: 14 }}>
                  {docTypes.map((t) => {
                    const doc = d.documents.find((x) => x.type === t);
                    const url = doc ? urls[doc.path] : undefined;
                    return (
                      <div key={t} className="col g8">
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="doc" style={{ height: 120, overflow: 'hidden' }} aria-label={`Open ${DOC_LABEL[t]} full size`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={DOC_LABEL[t]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </a>
                        ) : <div className="doc" style={{ height: 120 }}>{doc ? 'Could not load' : 'Not uploaded'}</div>}
                        <span className="b" style={{ fontSize: 13 }}>{DOC_LABEL[t]}</span>
                      </div>
                    );
                  })}
                </div>
                <span className="mut" style={{ fontSize: 12.5 }}>Links work for 5 minutes. Opening this page is written to the audit log.</span>
              </div>
            </>
          )}
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card col">
            <h2 className="h2">Account</h2>
            <details>
              <summary className={`btn ${suspended ? '' : ''}`} style={{ cursor: 'pointer', width: '100%', ...(suspended ? {} : { background: '#FADCDA', color: '#7A1411' }) }}>{suspended ? 'Reactivate account' : 'Suspend account'}</summary>
              <div style={{ marginTop: 10 }}>
                <ActionForm action={setAccountStatusAction} hidden={{ profileId: d.id, suspend: suspended ? '0' : '1' }} submit={suspended ? 'Reactivate' : 'Suspend and sign out'} tone={suspended ? 'green' : 'red'} fields={[{ name: 'reason', kind: 'textarea', label: suspended ? 'Why they can come back' : 'Reason (they are told this)', required: true, maxLength: 500 }, ...(suspended ? [] : [{ name: 'days', kind: 'text' as const, label: 'Days (1 to 365, empty = until you reactivate)', placeholder: 'For example 7', maxLength: 3 }])]} />
                {!suspended ? <span className="mut" style={{ display: 'block', fontSize: 12.5, marginTop: 6 }}>They are signed out everywhere at once and told the reason and the end date.{isWorker ? ' Their live jobs are flagged for staff.' : ''}</span> : null}
              </div>
            </details>
            <details>
              <summary className="btn out" style={{ cursor: 'pointer', width: '100%' }}>Send a message</summary>
              <div style={{ marginTop: 10 }}>
                <ActionForm action={sendMessageAction} hidden={{ profileId: d.id }} submit="Send message" tone="soft" fields={[{ name: 'text', kind: 'textarea', label: 'Message (they see it in the app)', required: true, maxLength: 300 }]} />
              </div>
            </details>
          </div>

          <div className="card col">
            <h2 className="h2">Staff notes</h2>
            {d.notes.length === 0 ? <span className="mut">No notes yet.</span> : d.notes.map((n) => (
              <div key={n.id} className="note g" style={{ flexDirection: 'column', gap: 2, fontWeight: 600 }}>
                <span>{n.note}</span>
                <span className="mut" style={{ fontSize: 12 }}>{dateOnly(n.createdAt)} · {n.authorName}</span>
              </div>
            ))}
            <ActionForm action={addStaffNoteAction} hidden={{ profileId: d.id }} submit="Add note" tone="out" fields={[{ name: 'note', kind: 'textarea', label: 'Add a note', placeholder: 'Only staff can see notes.', required: true, maxLength: 1000 }]} />
          </div>
        </div>
      </div>
    </PortalFrame>
  );
}
