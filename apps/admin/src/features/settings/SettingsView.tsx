import Link from 'next/link';
import type { ReactNode } from 'react';
import { ActionForm, ButtonForm, PillToggleForm, SwitchForm } from '@/components/FormKit';
import { LoadError } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Avatar, Chip, Icon, ICONS } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { dateOnly } from '@/lib/format';
import { initials } from '../verification/rules';
import { addCategoryAction, inviteStaffAction, removeStaffAction, revokeInviteAction, setCategoryAction, setPhaseAction } from './actions';
import { HelplineForm } from './HelplineForm';
import { parseSettings, parseStaff } from './parse';

const TABS = [
  { key: 'categories', label: 'Service Categories', icon: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /> },
  { key: 'areas', label: 'Areas', icon: <><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></> },
  { key: 'helpline', label: 'Helpline and windows', icon: ICONS.helpline },
  { key: 'admins', label: 'Admin accounts', icon: ICONS.workers },
] as const;

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
const categoryIcon = (name: string) => CATEGORY_ICONS.find((c) => c.test.test(name))?.icon ?? TABS[0].icon;

/** Settings (A14), one topic per tab: categories, phases, helpline and windows, and the staff accounts with invites. */
export async function SettingsView({ tab }: { tab?: string }) {
  const active = TABS.find((t) => t.key === tab)?.key ?? 'categories';
  const { supabase, user } = await requireSession();
  const [s, st] = await Promise.all([supabase.rpc('admin_settings_get'), supabase.rpc('admin_staff_list')]);
  const settings = parseSettings(s.error ? null : s.data);
  const staff = parseStaff(st.error ? null : st.data);

  return (
    <PortalFrame supabase={supabase} user={user} active="/settings" title="Settings" sub="Categories, areas, helpline and staff accounts for the whole app.">
      <nav className="stabs" aria-label="Settings sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/settings?tab=${t.key}`} className={`stab${t.key === active ? ' on' : ''}`} aria-current={t.key === active ? 'page' : undefined}>
            <Icon>{t.icon}</Icon>{t.label}
          </Link>
        ))}
      </nav>
      {(active !== 'admins' && !settings) ? <LoadError /> : null}

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
                <div className="side"><Icon>{ICONS.info}</Icon>Disable a category to hide it from new job creation.</div>
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
          <div>
            <h2 className="h2">DHA phases we serve</h2>
            <div className="mut" style={{ fontSize: 13, marginTop: 4 }}>Residents and workers can only pick phases that are on. Tap a phase to switch it.</div>
          </div>
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

      {active === 'admins' ? (
        <div className="col" style={{ gap: 20, maxWidth: 820 }}>
          <div className="card col" style={{ gap: 12 }}>
            <div>
              <h2 className="h2">Invite an admin</h2>
              <div className="mut" style={{ fontSize: 13, marginTop: 4 }}>Every admin can review, suspend and change settings. A password alone is not enough: each sign-in needs an emailed code.</div>
            </div>
            <ActionForm action={inviteStaffAction} submit="Create invite" inline fields={[{ name: 'email', label: 'Email address', kind: 'email', placeholder: 'name@example.com', maxLength: 254, required: true }]} />
          </div>

          {st.error ? <LoadError /> : null}
          <div className="card col" style={{ gap: 0 }}>
            <h2 className="h2" style={{ paddingBottom: 12 }}>Accounts and invites</h2>
            {staff.admins.map((a) => (
              <div key={a.id} className="col" style={{ padding: '14px 0', borderTop: '1px solid var(--line)', gap: 10 }}>
                <div className="row" style={{ gap: 12 }}>
                  <Avatar initials={initials(a.name)} seed={a.id} />
                  <div className="fx">
                    <div className="xb">{a.name}{a.isMe ? ' (you)' : ''}</div>
                    <div className="mut" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{a.email ?? '-'} · added {dateOnly(a.createdAt)}</div>
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
            ))}
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
            {!st.error && staff.admins.length === 0 && staff.invites.length === 0 ? <div className="mut" style={{ padding: '14px 0' }}>No other admin accounts yet.</div> : null}
          </div>
        </div>
      ) : null}
    </PortalFrame>
  );
}
