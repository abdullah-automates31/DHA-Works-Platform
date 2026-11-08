import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/FormKit';
import { PhotoGrid } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Chip, Icon, ICONS } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { dateTime, firstName, jobStatus, phoneText, REPORT_ACTION_TEXT, reportKind, reportStatus, rupees, sentence, telHref } from '@/lib/format';
import { isUuid } from '@/lib/json';
import { addReportNoteAction, logCallAction } from './actions';
import { loadReportDetail, reportPhotoUrls } from './queries';
import { ReportDecision } from './ReportDecision';
import { activityOf, unsafeBanner } from './rules';
import type { Person } from './parse';

function CallButton({ p, red }: { p: Person; red?: boolean }) {
  const href = telHref(p.phone);
  if (!href) return <span className="btn off">{`No phone for ${firstName(p.name)}`}</span>;
  return <a className={`btn${red ? ' red' : ''}`} href={href} style={red ? { background: '#fff', color: '#7A1411' } : undefined}>{`Call ${firstName(p.name)} · ${phoneText(p.phone)}`}</a>;
}

/** The case screen (A08): what was reported, the job, the activity, and the staff controls on the right. */
export async function ReportCase({ id }: { id: string }) {
  const { supabase, user } = await requireSession();
  if (!isUuid(id)) notFound();
  const d = await loadReportDetail(supabase, id);
  if (!d) notFound();
  const urls = await reportPhotoUrls(supabase, d.photos);
  const kind = reportKind(d.kind);
  const st = reportStatus(d.status);
  const job = jobStatus(d.job.status);
  const resolved = d.status === 'resolved';
  const unsafe = d.kind === 'unsafe' && !resolved;
  const banner = unsafeBanner(d);
  const activity = activityOf(d);

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active="/reports"
      title={`Case ${d.code}`}
      sub={`Opened ${dateTime(d.createdAt)} · reported by ${d.systemGenerated ? 'the system' : `the ${d.reporter.role}`}${d.assignedToName ? ` · assigned to ${d.assignedToName}` : ''}`}
      back={{ href: '/reports', label: 'Reports' }}
      right={<div className="row g8"><Chip tone={kind.tone}>{kind.label}</Chip><Chip tone={st.tone}>{st.label}</Chip></div>}
    >
      {unsafe ? (
        <div className="note red" style={{ alignItems: 'center', flexWrap: 'wrap' }} role="alert">
          <Icon size={28}>{ICONS.reports}</Icon>
          <div className="fx" style={{ minWidth: 240 }}>
            <div className="xb" style={{ fontSize: 17 }}>{banner.title}</div>
            <div style={{ fontWeight: 700 }}>{banner.text}</div>
          </div>
          <CallButton p={d.reporter} red />
          <CallButton p={d.against} red />
        </div>
      ) : null}

      <div className="split">
        <div className="col" style={{ gap: 20 }}>
          <div className="card col">
            <h2 className="h2">What was reported</h2>
            <dl className="kv">
              <dt>Type</dt><dd>{kind.label}</dd>
              <dt>Reported by</dt><dd>{d.systemGenerated ? 'System (automatic)' : `${d.reporter.name} · ${sentence(d.reporter.role)}${d.reporter.detail ? ` · ${d.reporter.detail}` : ''}`}</dd>
              <dt>Against</dt><dd>{d.against.name} · {sentence(d.against.role)}{d.against.detail ? ` · ${d.against.detail}` : ''}{d.against.accountStatus === 'suspended' ? ' · suspended' : ''}</dd>
              <dt>Message</dt><dd style={{ fontWeight: 600, whiteSpace: 'pre-wrap' }}>{d.reasonText ? `“${d.reasonText}”` : 'No message'}</dd>
            </dl>
            <PhotoGrid paths={d.photos} urls={urls} label="Photo" />
          </div>

          <div className="card row" style={{ gap: 16 }}>
            <div className="av g l" aria-hidden="true"><Icon size={26}>{ICONS.jobs}</Icon></div>
            <div className="fx">
              <div className="xb">{d.job.code} · {d.job.title}</div>
              <div className="mut b" style={{ fontSize: 13 }}>Phase {d.job.phase}, {d.job.lane}{d.job.plotNo ? `, House ${d.job.plotNo}` : ''} · Quote {rupees(d.job.quoteTotal)}{d.job.startedAt ? ` · Started ${dateTime(d.job.startedAt)}` : ''}</div>
            </div>
            <Chip tone={job.tone}>{job.label}</Chip>
            <Link className="btn out sm" href={`/jobs/${d.job.id}`}>Open job</Link>
          </div>

          <div className="card col">
            <h2 className="h2">Activity</h2>
            <div className="tl">
              {activity.map((a, i) => (
                <div className="s" key={a.key}>
                  <div className="c">
                    <div className={`d ${a.tone === 'stop' ? 'stop' : a.tone === 'now' ? 'now' : 'ok'}`} />
                    {i < activity.length - 1 ? <i /> : null}
                  </div>
                  <div className="t">{a.title}<span>{a.sub}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          {resolved ? (
            <div className="card col">
              <h2 className="h2">Outcome</h2>
              <div className="note g"><Icon>{ICONS.check}</Icon><span><b>{REPORT_ACTION_TEXT[d.action ?? ''] ?? 'Resolved'}</b>{d.actionReason ? <><br />{d.actionReason}</> : null}<br /><span className="mut">{dateTime(d.resolvedAt)}</span></span></div>
              <span className="mut b" style={{ fontSize: 13 }}>A resolved case cannot be decided again. You can still add notes.</span>
            </div>
          ) : (
            <ReportDecision reportId={d.id} against={{ name: d.against.name, role: d.against.role }} />
          )}

          <div className="card col">
            <h2 className="h2">Log a call</h2>
            <ActionForm
              action={logCallAction}
              hidden={{ reportId: d.id }}
              submit="Save call"
              tone="out"
              fields={[
                { name: 'calledId', kind: 'select', label: 'Who did you call?', required: true, placeholder: 'Choose', options: [{ value: d.reporter.id, label: `${d.reporter.name} (${d.reporter.role})` }, { value: d.against.id, label: `${d.against.name} (${d.against.role})` }] },
                { name: 'outcome', kind: 'text', label: 'What was said (optional)', placeholder: 'Spoke to them, safe now', maxLength: 300 },
              ]}
            />
            {!unsafe ? (
              <div className="row wrap g8">
                <CallButton p={d.reporter} />
                <CallButton p={d.against} />
              </div>
            ) : null}
          </div>

          <div className="card col">
            <h2 className="h2">Add a note</h2>
            <ActionForm action={addReportNoteAction} hidden={{ reportId: d.id }} submit="Save note" tone="out" fields={[{ name: 'note', kind: 'textarea', placeholder: 'What you did or heard. Staff only.', maxLength: 1000, required: true }]} />
          </div>
        </div>
      </div>
    </PortalFrame>
  );
}
