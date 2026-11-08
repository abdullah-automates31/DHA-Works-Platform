import { ActionForm, ButtonForm, PillToggleForm, SwitchForm } from '@/components/FormKit';
import { LoadError } from '@/components/ListBits';
import { PortalFrame } from '@/components/PortalFrame';
import { Avatar, Chip } from '@/components/ui';
import { requireSession } from '@/lib/auth';
import { dateOnly } from '@/lib/format';
import { initials } from '../verification/rules';
import { addCategoryAction, inviteStaffAction, removeStaffAction, revokeInviteAction, setCategoryAction, setPhaseAction } from './actions';
import { HelplineForm } from './HelplineForm';
import { parseSettings, parseStaff } from './parse';

/** Settings (A14): categories, phases, helpline and windows, and the staff accounts with invites. */
export async function SettingsView() {
  const { supabase, user } = await requireSession();
  const [s, st] = await Promise.all([supabase.rpc('admin_settings_get'), supabase.rpc('admin_staff_list')]);
  const settings = parseSettings(s.error ? null : s.data);
  const staff = parseStaff(st.error ? null : st.data);

  return (
    <PortalFrame supabase={supabase} user={user} active="/settings" title="Settings" sub="Categories, areas, helpline and staff accounts for the whole app.">
      {!settings ? <LoadError /> : null}
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card col">
          <div className="row sb"><h2 className="h2">Service categories</h2><span className="mut b" style={{ fontSize: 13 }}>Workers can pick several</span></div>
          {(settings?.categories ?? []).map((c) => (
            <div key={c.id} className="row" style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <div className="fx">
                <div className="xb">{c.name}</div>
                <div className="mut" style={{ fontSize: 12.5 }}>{c.subtitle ?? 'No description'} · {c.workers} worker{c.workers === 1 ? '' : 's'} · {c.active ? 'shown in the apps' : 'hidden from new jobs'}</div>
              </div>
              <SwitchForm action={setCategoryAction} on={c.active} label={`${c.name} is ${c.active ? 'on' : 'off'}`} hidden={{ categoryId: String(c.id), name: c.name, subtitle: c.subtitle ?? '', active: c.active ? '0' : '1' }} />
            </div>
          ))}
          <ActionForm action={addCategoryAction} submit="Add" tone="soft" inline fields={[{ name: 'name', kind: 'text', placeholder: 'New category name', maxLength: 40, required: true }, { name: 'subtitle', kind: 'text', placeholder: 'Short description (optional)', maxLength: 80 }]} />
        </div>

        <div className="col" style={{ gap: 20 }}>
          <div className="card col">
            <div className="row sb"><h2 className="h2">Phases we serve</h2><span className="mut b" style={{ fontSize: 13 }}>Tap to turn on or off</span></div>
            <div className="row wrap g8">
              {(settings?.phases ?? []).map((p) => (
                <PillToggleForm key={p.phase} action={setPhaseAction} on={p.active} label={`Phase ${p.phase}`} hidden={{ phase: String(p.phase), active: p.active ? '0' : '1' }} />
              ))}
            </div>
          </div>

          <div className="card col">
            <h2 className="h2">Helpline and reports</h2>
            {settings ? <HelplineForm number={settings.helplineNumber} enabled={settings.helplineEnabled} reportDays={settings.reportWindowDays} reviewDays={settings.reviewWindowDays} /> : null}
          </div>
        </div>
      </div>

      <div className="card col">
        <div className="row sb wrap">
          <div><h2 className="h2">Admin accounts</h2><div className="mut b" style={{ fontSize: 13 }}>Every admin can review, suspend and change settings. A password alone is not enough: each sign-in needs an emailed code.</div></div>
        </div>
        <div style={{ maxWidth: 640 }}>
          <ActionForm action={inviteStaffAction} submit="Invite admin" inline fields={[{ name: 'email', kind: 'email', placeholder: 'name@example.com', maxLength: 254, required: true }]} />
        </div>
        {st.error ? <LoadError /> : null}
        <div className="tw" style={{ boxShadow: 'none' }}>
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Added</th><th>Status</th><th /></tr></thead>
            <tbody>
              {staff.admins.map((a) => (
                <tr key={a.id}>
                  <td><div className="row"><Avatar initials={initials(a.name)} seed={a.id} /><span className="xb">{a.name}{a.isMe ? ' (you)' : ''}</span></div></td>
                  <td className="mut">{a.email ?? '-'}</td>
                  <td>{dateOnly(a.createdAt)}</td>
                  <td><Chip tone={a.accountStatus === 'active' ? 'ok' : 'red'}>{a.accountStatus === 'active' ? 'Active' : 'Removed'}</Chip></td>
                  <td style={{ minWidth: 200 }}>
                    {!a.isMe && a.accountStatus === 'active' ? (
                      <details>
                        <summary className="btn sm" style={{ cursor: 'pointer', background: '#FADCDA', color: '#7A1411', display: 'inline-flex' }}>Remove</summary>
                        <div style={{ marginTop: 8 }}>
                          <ActionForm action={removeStaffAction} hidden={{ profileId: a.id }} submit="Remove and sign out" tone="red" fields={[{ name: 'reason', kind: 'text', placeholder: 'Reason', required: true, maxLength: 500 }]} />
                        </div>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
              {staff.invites.map((i) => (
                <tr key={i.id}>
                  <td><div className="row"><Avatar initials={initials(i.email)} seed={i.id} /><span className="xb">Invited</span></div></td>
                  <td className="mut">{i.email}</td>
                  <td>{dateOnly(i.createdAt)}</td>
                  <td><Chip tone={i.expired ? 'gray' : 'wait'}>{i.expired ? 'Invite expired' : 'Invite sent'}</Chip></td>
                  <td><ButtonForm action={revokeInviteAction} hidden={{ inviteId: i.id }} label="Cancel invite" tone="red" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PortalFrame>
  );
}
