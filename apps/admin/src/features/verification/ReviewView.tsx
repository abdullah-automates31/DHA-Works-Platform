import { notFound } from 'next/navigation';
import { PortalFrame } from '@/components/PortalFrame';
import { Avatar, Chip, Icon, ICONS } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { DecisionForm } from './DecisionForm';
import { isUuid, type Detail, type DetailDoc } from './parse';
import { loadDetail, signedUrls } from './queries';
import { DOC_LABEL, initials, phasesText, phoneText, statusChip, waitingText, type DocType, type Role } from './rules';

const WORKER_DOCS: DocType[] = ['cnic_front', 'cnic_back', 'police_cert', 'profile_photo'];
const RESIDENT_DOCS: DocType[] = ['cnic_front', 'cnic_back', 'utility_bill'];

function DocTile({ type, doc, urls, height }: { type: DocType; doc: DetailDoc | undefined; urls: Record<string, string>; height: number }) {
  const url = doc ? urls[doc.path] : undefined;
  return (
    <div className="col g8">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="doc" style={{ height, overflow: 'hidden' }} aria-label={`Open ${DOC_LABEL[type]} full size`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={DOC_LABEL[type]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </a>
      ) : (
        <div className="doc" style={{ height }}>{doc ? 'Could not load' : 'Not uploaded'}</div>
      )}
      <span className="b" style={{ fontSize: 13 }}>{DOC_LABEL[type]}</span>
    </div>
  );
}

function submittedText(d: Detail): string {
  if (!d.submittedAt) return '';
  const when = new Date(d.submittedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return `Applied ${when} · waiting ${waitingText(d.submittedAt)}`;
}

/** The review screen for one worker (A04) or resident (A06). Opening it is written to the audit log by the database. */
export async function ReviewView({ role, id }: { role: Role; id: string }) {
  const { supabase, user } = await requireSession();
  if (!isUuid(id)) notFound();
  const detail = await loadDetail(supabase, id);
  if (!detail || detail.role !== role) notFound();
  const urls = await signedUrls(supabase, detail);
  const chip = statusChip(detail.status);
  const open = detail.status === 'pending' || detail.status === 'visit_hq';
  const types = role === 'worker' ? WORKER_DOCS : RESIDENT_DOCS;
  const docOf = (t: DocType) => detail.documents.find((x) => x.type === t);
  const w = detail.worker;
  const photoUrl = (() => {
    const p = docOf('profile_photo');
    return p ? urls[p.path] : undefined;
  })();

  return (
    <PortalFrame
      supabase={supabase}
      user={user}
      active={`/${role}s`}
      title={role === 'worker' ? 'Review worker application' : 'Review resident application'}
      sub={submittedText(detail)}
      back={{ href: `/${role}s`, label: 'Queue' }}
      right={<Chip tone={chip.tone}>{chip.label}</Chip>}
    >
      <div className="split">
        <div className="col" style={{ gap: 20 }}>
          <div className="card row" style={{ gap: 18 }}>
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt={detail.name ?? 'Applicant'} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
            ) : (
              <Avatar initials={initials(detail.name)} seed={detail.id} large />
            )}
            <div className="fx">
              <div className="xb" style={{ fontSize: 20 }}>{detail.name ?? 'No name'}</div>
              <div className="mut b" style={{ marginTop: 2 }}>
                {role === 'worker'
                  ? [w?.categories.join(', '), phasesText(w?.phases ?? []), w?.experienceYears != null ? `${w.experienceYears} years of experience` : null].filter(Boolean).join(' · ')
                  : detail.addresses[0] ? `Phase ${detail.addresses[0].phase} · ${detail.addresses[0].lane} · House ${detail.addresses[0].plotNo}` : 'No address'}
              </div>
            </div>
            <dl className="kv" style={{ gridTemplateColumns: '56px auto', fontSize: 13, margin: 0, columnGap: 12 }}>
              {role === 'resident' ? (
                <>
                  <dt>Email</dt>
                  <dd>{detail.email ?? '-'}</dd>
                </>
              ) : null}
              <dt>Phone</dt>
              <dd>{phoneText(detail.phone)}</dd>
              <dt>CNIC</dt>
              <dd>{detail.cnicMasked ?? '-'}</dd>
            </dl>
          </div>

          <div className="card col">
            <h2 className="h2">Documents</h2>
            <div style={{ display: 'grid', gridTemplateColumns: role === 'worker' ? 'repeat(4,minmax(0,1fr))' : 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.4fr)', gap: 14 }}>
              {types.map((t) => <DocTile key={t} type={t} doc={docOf(t)} urls={urls} height={role === 'worker' ? 150 : 210} />)}
            </div>
            <div className="note g" style={{ fontWeight: 700 }}>
              <Icon>{ICONS.info}</Icon>
              Select a document to open it full size in a new tab. The link works for 5 minutes. Check the CNIC number on the card against the masked number above.
            </div>
          </div>

          {role === 'worker' && w ? (
            <>
              <div className="card col">
                <div className="xb">Voice introduction</div>
                {w.voicePath && urls[w.voicePath] ? <audio controls preload="none" src={urls[w.voicePath]} style={{ width: '100%' }} /> : <div className="mut">No voice introduction was recorded.</div>}
                {w.about ? <div><div className="h3" style={{ marginBottom: 6 }}>Written introduction</div><div style={{ whiteSpace: 'pre-wrap' }}>{w.about}</div></div> : null}
              </div>
              {w.references.length > 0 ? (
                <div className="card col">
                  <h2 className="h2">References</h2>
                  {w.references.map((r) => (
                    <div key={`${r.name}${r.phone}`} className="row sb">
                      <span className="xb">{r.name}</span>
                      <span className="mut b">{phoneText(r.phone)}{r.address ? ` · ${r.address}` : ''}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          {role === 'resident' ? (
            <div className="card col">
              <h2 className="h2">Address match</h2>
              <div className="note g" style={{ flexDirection: 'column', gap: 4 }}>
                <span className="mut b" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>Address the resident gave</span>
                {detail.addresses.length === 0 ? <span className="xb">No address</span> : detail.addresses.map((a) => (
                  <span key={`${a.phase}${a.lane}${a.plotNo}`} className="xb" style={{ fontSize: 15 }}>Phase {a.phase} · {a.lane} · House {a.plotNo}{a.floor ? ` · Floor ${a.floor}` : ''}</span>
                ))}
              </div>
              <span className="mut b" style={{ fontSize: 13 }}>Compare it with the address on the utility bill by eye. The bill must be from the last 3 months.</span>
            </div>
          ) : null}

          {detail.history.length > 0 ? (
            <div className="card col">
              <h2 className="h2">Earlier decisions</h2>
              {detail.history.map((h) => (
                <div key={h.decidedAt} className="col g4">
                  <div className="row sb"><span className="xb">{h.decision.replaceAll('_', ' ')}</span><span className="mut b" style={{ fontSize: 12.5 }}>{new Date(h.decidedAt).toLocaleDateString('en-GB')}{h.by ? ` · ${h.by}` : ''}</span></div>
                  {h.reason ? <span className="mut">{h.reason}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="col" style={{ gap: 16, position: 'sticky', top: 16 }}>
          {open ? (
            <DecisionForm role={role} profileId={detail.id} />
          ) : (
            <div className="card col">
              <h2 className="h2">Decision</h2>
              <div className="note g">This application is {chip.label.toLowerCase()}. {detail.reason ? `Reason given: ${detail.reason}` : ''}</div>
              <span className="mut b" style={{ fontSize: 13 }}>Only applications that are pending or asked to visit HQ can get a new decision.</span>
            </div>
          )}
        </div>
      </div>
    </PortalFrame>
  );
}
