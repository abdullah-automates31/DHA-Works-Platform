import type { ReactNode } from 'react';
import { ActionForm, ButtonForm, PillToggleForm, SwitchForm } from '@/components/FormKit';
import { LoadError } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Avatar, Chip, Icon, ICONS } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { ago, dateOnly, dateTime } from '@/lib/format';
import { initials } from '../verification/rules';
import { savePayToAction } from '../dues/actions';
import { addCategoryAction, inviteStaffAction, removeStaffAction, revokeInviteAction, setCategoryAction, setPhaseAction, signOutOthersAction } from './actions';
import { AuditView, type AuditParams } from './AuditView';
import { HelplineForm } from './HelplineForm';
import { parseRules, parseSettings, parseStaff, parseStaffActivity } from './parse';
import { RulesForm } from './RulesForm';
import { DANGER_ITEM, PASSWORD_MIN, parseSection, SECTION_GROUPS, SIGN_OUT_WORDS, type SectionKey } from './rules';
import { SettingsNav, type NavItem } from './SettingsNav';
import { SystemView } from './SystemView';

const I: Record<SectionKey, ReactNode> = {
  helpline: ICONS.helpline,
  categories: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />,
  areas: <><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
  jobs: ICONS.jobs,
  workers: ICONS.workers,
  dues: <path d="M12 3v18M16.5 7.5c-.8-1.2-2.3-2-4.5-2-2.6 0-4 1.3-4 3s1.4 2.5 4 3 4 1.3 4 3-1.4 3-4 3c-2.2 0-3.7-.8-4.5-2" />,
  admins: ICONS.users,
  security: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  audit: <path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h4" />,
  system: <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>,
  danger: ICONS.reports,
};

// One small outline icon per category, picked from its name; anything new gets the wrench.
const CATEGORY_ICONS: { test: RegExp; icon: ReactNode }[] = [
  { test: /electric/i, icon: <path d="M13 2L4 14h7l-1 8 9-12h-7z" /> },
  { test: /\bac\b|refrig|cool/i, icon: <path d="M12 2v20M4.5 7l15 10M19.5 7l-15 10M9 4l3 2.5L15 4M9 20l3-2.5 3 2.5" /> },
  { test: /carpent|wood/i, icon: <path d="M4 20l9.5-9.5M11 6.5L14.5 3l6.5 6.5-3.5 3.5z" /> },
  { test: /paint/i, icon: <path d="M5 4h12a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM18 7h2v5h-8v3M11 15h2v6h-2z" /> },
  { test: /clean/i, icon: <path d="M20 4l-9 9M9 11c-3 1-5 4-5 9 5 0 8-2 9-5z" /> },
  { test: /weld|iron|metal/i, icon: <path d="M5 12a7 7 0 0 1 14 0M3 12h18v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM8 15h8" /> },
  { test: /handy|general/i, icon: ICONS.jobs },
];
const categoryIcon = (name: string) => CATEGORY_ICONS.find((c) => c.test.test(name))?.icon ?? I.categories;

const HEAD: Record<SectionKey, { title: string; sub: string }> = {
  helpline: { title: 'Helpline and windows', sub: 'The number people can call, and how long after a job they can report a problem or leave a review.' },
  categories: { title: 'Service categories', sub: 'What residents can request. Turn a category off to hide it from new jobs.' },
  areas: { title: 'Areas', sub: 'The DHA phases the platform serves.' },
  jobs: { title: 'Jobs and booking', sub: 'How long jobs stay open and when staff are alerted. The fixed rules are listed below.' },
  workers: { title: 'Workers', sub: 'When a worker counts as Top rated, and how workers are verified.' },
  dues: { title: 'DHA fee and dues', sub: 'DHA’s share of each job, how long workers have to pay it, and where they pay.' },
  admins: { title: 'Admin accounts', sub: 'Who can use this portal, when they last signed in and where they are signed in now.' },
  security: { title: 'Security', sub: 'How sign-in is protected today.' },
  audit: { title: 'Audit log', sub: 'Every change and sensitive action: who did it and when.' },
  system: { title: 'System status', sub: 'Live checks of the services the platform depends on.' },
  danger: { title: 'Danger zone', sub: 'Actions that affect other people. Each one asks for confirmation and is written to the audit log.' },
};

/** A card of rules that are decided by DHA and fixed in the platform: shown so nobody wonders why they cannot be edited. */
function Facts({ title, items }: { title: string; items: { label: string; text: ReactNode }[] }) {
  return (
    <div className="card col" style={{ gap: 0 }}>
      <h2 className="h2" style={{ paddingBottom: 12 }}>{title}</h2>
      {items.map((i) => (
        <div key={i.label} className="srow">
          <div className="fx"><div className="xb">{i.label}</div><div className="mut" style={{ fontSize: 13, lineHeight: 1.5 }}>{i.text}</div></div>
          <div className="st"><Chip tone="gray">Fixed rule</Chip></div>
        </div>
      ))}
    </div>
  );
}

const navItem = (key: SectionKey, label: string): NavItem => ({ key, label, icon: I[key] });

/**
 * Settings (A14). A list of sections on the left, one section on the right. Editable rules save through
 * admin_rules_save, the audit log and system status are read-only views, and the danger zone has one confirmed action.
 */
export async function SettingsView({ tab, params = {} }: { tab?: string; params?: AuditParams }) {
  const active = parseSection(tab);
  const { supabase, user } = await requireSession();
  const needsSettings = active === 'categories' || active === 'areas' || active === 'helpline';
  const needsRules = active === 'jobs' || active === 'workers' || active === 'dues';
  const needsStaff = active === 'admins';
  const [s, r, st, act, payTo] = await Promise.all([
    needsSettings ? supabase.rpc('admin_settings_get') : null,
    needsRules ? supabase.rpc('admin_rules_get') : null,
    needsStaff ? supabase.rpc('admin_staff_list') : null,
    needsStaff ? supabase.rpc('admin_staff_activity') : null,
    active === 'dues' ? supabase.from('app_settings').select('value').eq('key', 'dues_pay_to').maybeSingle() : null,
  ]);
  const settings = s ? parseSettings(s.error ? null : s.data) : null;
  const rules = r ? parseRules(r.error ? null : r.data) : null;
  const staff = parseStaff(st && !st.error ? st.data : null);
  const activity = parseStaffActivity(act && !act.error ? act.data : null);
  const payToText = typeof payTo?.data?.value === 'string' ? payTo.data.value : '';
  const turnstile = !!process.env.TURNSTILE_SECRET_KEY && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const head = HEAD[active];

  return (
    <PortalFrame supabase={supabase} user={user} active="/settings" title="Settings" sub="Rules, accounts and records for the whole platform.">
      <div className="sset">
        <SettingsNav
          groups={SECTION_GROUPS.map((g) => ({ title: g.title, items: g.items.map((i) => navItem(i.key, i.label)) }))}
          danger={navItem(DANGER_ITEM.key, DANGER_ITEM.label)}
          active={active}
        />

        <div className="col" style={{ gap: 20, minWidth: 0 }}>
          <div className="shead"><h2>{head.title}</h2><div className="mut" style={{ fontSize: 13.5 }}>{head.sub}</div></div>
          {needsSettings && !settings ? <LoadError /> : null}
          {needsRules && !rules ? <LoadError /> : null}

          {active === 'categories' && settings ? (
            <div className="col" style={{ gap: 20 }}>
              {(() => {
                const total = settings.categories.length;
                const on = settings.categories.filter((c) => c.active).length;
                return (
                  <div className="sban">
                    <div className="ok"><Icon>{ICONS.check}</Icon></div>
                    <div>
                      <div className="t">{on} of {total} categories active</div>
                      <div className="s">{on === total ? 'All service categories are available for residents to request.' : `${total - on} hidden from new job creation.`}</div>
                    </div>
                  </div>
                );
              })()}
              <div className="ctab">
                <div className="crow h"><span>Category</span><span>Description</span><span className="wkh">Workers</span><span className="st">Status</span></div>
                {settings.categories.map((c) => (
                  <div key={c.id} className={`crow${c.active ? '' : ' off'}`}>
                    <div className="nm"><span className="cic"><Icon>{categoryIcon(c.name)}</Icon></span><span>{c.name}</span></div>
                    <div className="ds">{c.subtitle ?? 'No description'}</div>
                    <span className="wk" aria-label={`${c.workers} workers`}>{c.workers}</span>
                    <div className="st">
                      <SwitchForm action={setCategoryAction} on={c.active} label={`${c.name} is ${c.active ? 'on' : 'off'}`} hidden={{ categoryId: String(c.id), name: c.name, subtitle: c.subtitle ?? '', active: c.active ? '0' : '1' }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="card col" style={{ gap: 12 }}>
                <h2 className="h2">Add a category</h2>
                <ActionForm
                  action={addCategoryAction}
                  submit="Add category"
                  inline
                  fields={[
                    { name: 'name', label: 'Name', kind: 'text', placeholder: 'For example Painting', maxLength: 40, required: true },
                    { name: 'subtitle', label: 'Short description (optional)', kind: 'text', placeholder: 'Shown under the name', maxLength: 80 },
                  ]}
                />
              </div>
            </div>
          ) : null}

          {active === 'areas' && settings ? (
            <div className="card col" style={{ maxWidth: 820, gap: 14 }}>
              <div className="mut" style={{ fontSize: 13 }}>Residents and workers can only pick phases that are on. Tap a phase to switch it.</div>
              <div className="row wrap g8">
                {settings.phases.map((p) => (
                  <PillToggleForm key={p.phase} action={setPhaseAction} on={p.active} label={`Phase ${p.phase}`} hidden={{ phase: String(p.phase), active: p.active ? '0' : '1' }} />
                ))}
              </div>
              <div className="mut" style={{ fontSize: 12.5 }}>
                {settings.phases.filter((p) => p.active).length} of {settings.phases.length} phases are on.
              </div>
            </div>
          ) : null}

          {active === 'helpline' && settings ? (
            <div style={{ maxWidth: 820 }}>
              <HelplineForm number={settings.helplineNumber} enabled={settings.helplineEnabled} reportDays={settings.reportWindowDays} reviewDays={settings.reviewWindowDays} />
            </div>
          ) : null}

          {active === 'jobs' && rules ? (
            <div className="col" style={{ gap: 20, maxWidth: 860 }}>
              <RulesForm group="jobs" rules={rules.jobs} />
              <Facts
                title="Fixed rules"
                items={[
                  { label: 'Cash payment', text: 'Only the worker records the cash received, once, and it cannot be changed afterwards.' },
                  { label: 'Material bill', text: 'A bill photo can be attached while the job is in progress. The worker is reminded at Mark complete if it is missing.' },
                  { label: 'Cancelling a job', text: 'Before a job is accepted the resident can cancel. After that neither person cancels alone: staff decide under Jobs, Cancellation requests.' },
                  { label: 'Quotes', text: 'A worker quotes once. A rejected worker cannot quote the same job again and there are no quote revisions.' },
                  { label: 'Reporting and reviewing', text: 'The number of days after a job is on the Helpline and windows page.' },
                ]}
              />
            </div>
          ) : null}

          {active === 'workers' && rules ? (
            <div className="col" style={{ gap: 20, maxWidth: 860 }}>
              <RulesForm group="workers" rules={rules.workers} />
              <Facts
                title="Fixed rules"
                items={[
                  { label: 'Documents needed to be verified', text: 'CNIC, police certificate and a profile photo. (No licence.)' },
                  { label: 'Verification decisions', text: 'Staff approve, ask for changes, ask the person to visit HQ, or reject. A rejected applicant can be let in to apply again from their review page.' },
                  { label: 'Suspension', text: 'Staff suspend from a report decision or the Users screen, for a number of days (1 to 365) or until reactivated. The worker is told and signed out.' },
                  { label: 'Ratings', text: 'Only residents rate workers, after a job is done.' },
                ]}
              />
            </div>
          ) : null}

          {active === 'dues' && rules ? (
            <div className="col" style={{ gap: 20, maxWidth: 860 }}>
              <div className="note"><span><b>The fee comes out of the quote.</b> The customer pays the quote and nothing more. The worker collects it in cash, then owes DHA the fee. With 20% and a Rs 50 minimum, a job with Rs 400 labour costs the worker Rs 80 (20% is more than the minimum). Set the percent and the minimum to 0 to switch the fee off. A change applies to new quotes and to quotes a worker changes; accepted quotes keep the fee they had.</span></div>
              <RulesForm group="dues" rules={rules.dues} />
              <div className="card col" style={{ gap: 12 }}>
                <div>
                  <h2 className="h2">Where workers pay DHA</h2>
                  <div className="mut" style={{ fontSize: 13, marginTop: 4 }}>Shown in My Dues in the worker app, for example: JazzCash 0300 1234567, account title DHA Works. Workers pay here, then enter the transaction ID.</div>
                </div>
                <ActionForm action={savePayToAction} submit="Save" fields={[{ name: 'text', label: 'Payment details', kind: 'textarea', defaultValue: payToText, maxLength: 500, rows: 3 }]} resetOnOk={false} />
              </div>
              <Facts
                title="Fixed rules"
                items={[
                  { label: 'Who pays', text: 'The worker. The fee is not added to what the customer pays.' },
                  { label: 'Base', text: 'The worker’s labour price. Materials are the worker’s own cost and are never charged.' },
                  { label: 'When a due appears', text: 'When the worker records the cash of the finished job. A job with no labour price creates no due.' },
                  { label: 'Paying', text: 'The worker pays by JazzCash, Easypaisa or bank and enters the transaction ID. Staff confirm it on the Dues page, or record office cash.' },
                  { label: 'Suspension', text: 'By hand for now. A suspended worker can still open My Dues to pay, and is reactivated from their profile once the dues are cleared.' },
                ]}
              />
            </div>
          ) : null}

          {active === 'admins' ? (
            <div className="col" style={{ gap: 20, maxWidth: 860 }}>
              <div className="card col" style={{ gap: 12 }}>
                <div>
                  <h2 className="h2">Invite an admin</h2>
                  <div className="mut" style={{ fontSize: 13, marginTop: 4 }}>Every admin can review, suspend and change settings. A password alone is not enough: each sign-in needs an emailed code.</div>
                </div>
                <ActionForm action={inviteStaffAction} submit="Create invite" inline fields={[{ name: 'email', label: 'Email address', kind: 'email', placeholder: 'name@example.com', maxLength: 254, required: true }]} />
              </div>

              {st?.error ? <LoadError /> : null}
              <div className="card col" style={{ gap: 0 }}>
                <h2 className="h2" style={{ paddingBottom: 12 }}>Accounts and invites</h2>
                {staff.admins.map((a) => {
                  const x = activity[a.id];
                  return (
                    <div key={a.id} className="col" style={{ padding: '14px 0', borderTop: '1px solid var(--line)', gap: 10 }}>
                      <div className="row" style={{ gap: 12 }}>
                        <Avatar initials={initials(a.name)} seed={a.id} />
                        <div className="fx">
                          <div className="xb">{a.name}{a.isMe ? ' (you)' : ''}</div>
                          <div className="mut" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{a.email ?? '-'} · added {dateOnly(a.createdAt)}</div>
                          {a.accountStatus === 'active' && x ? (
                            <div className="mut" style={{ fontSize: 12.5, marginTop: 2 }}>
                              {x.lastSignInAt ? `Last sign-in ${dateTime(x.lastSignInAt)}` : 'Has not signed in yet'}
                              {` · ${x.activeSessions} active ${x.activeSessions === 1 ? 'session' : 'sessions'}`}
                              {x.lastActiveAt ? ` · last seen ${ago(x.lastActiveAt)}` : ''}
                              {x.lastIp ? ` · from ${x.lastIp}` : ''}
                            </div>
                          ) : null}
                        </div>
                        <Chip tone={a.accountStatus === 'active' ? 'ok' : 'red'}>{a.accountStatus === 'active' ? 'Active' : 'Removed'}</Chip>
                      </div>
                      {!a.isMe && a.accountStatus === 'active' ? (
                        <details style={{ marginLeft: 52 }}>
                          <summary className="btn sm" style={{ cursor: 'pointer', background: '#FADCDA', color: '#7A1411', display: 'inline-flex' }}>Remove this admin</summary>
                          <div style={{ marginTop: 10, maxWidth: 420 }}>
                            <ActionForm action={removeStaffAction} hidden={{ profileId: a.id }} submit="Remove and sign out" tone="red" fields={[{ name: 'reason', label: 'Reason (kept in the audit log)', kind: 'text', placeholder: 'Why is this admin being removed?', required: true, maxLength: 500 }]} />
                          </div>
                        </details>
                      ) : null}
                    </div>
                  );
                })}
                {staff.invites.map((i) => (
                  <div key={i.id} className="row" style={{ padding: '14px 0', borderTop: '1px solid var(--line)', gap: 12 }}>
                    <Avatar initials={initials(i.email)} seed={i.id} />
                    <div className="fx">
                      <div className="xb">Invited</div>
                      <div className="mut" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{i.email} · sent {dateOnly(i.createdAt)}</div>
                    </div>
                    <Chip tone={i.expired ? 'gray' : 'wait'}>{i.expired ? 'Invite expired' : 'Invite sent'}</Chip>
                    <ButtonForm action={revokeInviteAction} hidden={{ inviteId: i.id }} label="Cancel invite" tone="red" />
                  </div>
                ))}
                {!st?.error && staff.admins.length === 0 && staff.invites.length === 0 ? <div className="mut" style={{ padding: '14px 0' }}>No other admin accounts yet.</div> : null}
              </div>
            </div>
          ) : null}

          {active === 'security' ? (
            <div className="col" style={{ gap: 20, maxWidth: 860 }}>
              <Facts
                title="How admins sign in"
                items={[
                  { label: 'Password and bot check', text: <>Email and password, then a Cloudflare Turnstile check on the sign-in page. Status: <b>{turnstile ? 'configured' : 'not configured'}</b>.</> },
                  { label: 'Emailed six-digit code', text: 'A new code is emailed at every sign-in. It works for 10 minutes, allows 5 tries, and a new one can be asked for once a minute (5 an hour).' },
                  { label: 'Staying signed in', text: 'An admin stays signed in until they sign out. To end other admins’ sessions at once use the Danger zone.' },
                  { label: 'New admin passwords', text: `At least ${PASSWORD_MIN} characters. New admins are added only by an invite from an existing admin; the invite link is shown once.` },
                  { label: 'Everything is recorded', text: 'Changes and sensitive actions are written to the audit log, which nobody can edit or delete.' },
                ]}
              />
              <div className="card col" style={{ gap: 6 }}>
                <h2 className="h2">Set outside this portal</h2>
                <div className="mut" style={{ fontSize: 13.5, lineHeight: 1.6 }}>Limits on password attempts and the rest of the password policy are part of the Supabase Auth settings, and the Turnstile keys are in the hosting settings. They are not editable here so a mistake on this page cannot lock everyone out.</div>
              </div>
            </div>
          ) : null}

          {active === 'audit' ? <AuditView params={params} /> : null}
          {active === 'system' ? <SystemView /> : null}

          {active === 'danger' ? (
            <div className="col" style={{ gap: 20, maxWidth: 860 }}>
              <div className="card dz col" style={{ gap: 12 }}>
                <div>
                  <h2 className="h2">Sign out every other admin session</h2>
                  <div className="mut" style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.6 }}>
                    Ends all other admin sign-ins on every device. This session stays signed in. Use it when a device is lost or someone else may know a password. The other admins sign in again with their password and a new emailed code.
                  </div>
                </div>
                <ActionForm
                  action={signOutOthersAction}
                  submit="Sign out other sessions"
                  tone="red"
                  fields={[{ name: 'confirm', kind: 'text', label: `Type ${SIGN_OUT_WORDS} to confirm`, placeholder: SIGN_OUT_WORDS, required: true, maxLength: 20 }]}
                />
                <div className="mut" style={{ fontSize: 12.5 }}>Written to the audit log with the number of sessions ended.</div>
              </div>
              <div className="card col" style={{ gap: 6 }}>
                <h2 className="h2">Not available yet</h2>
                <div className="mut" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                  Maintenance mode, turning off new registrations, signing out all app users and an emergency shutdown need the Customer and Worker apps to understand them first, so they are not offered as buttons that would do nothing. Each rules page has Reset to default, and every change is in the audit log.
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </PortalFrame>
  );
}
