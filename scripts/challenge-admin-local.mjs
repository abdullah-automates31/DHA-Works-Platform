// Attack drill for the admin portal's second factor and its database functions. LOCAL STACK ONLY.
// Needs: local stack running, supabase/dev/seed_local_admin.sql applied, and `supabase functions serve` running with
// ADMIN_MAIL_MODE=dev-log writing its output to the file named in FN_LOG (the dev code is read from that log).
//   FN_LOG=path/to/fn.log node scripts/challenge-admin-local.mjs
// It bypasses the portal screens and talks to the API directly, the way an attacker with a stolen password would.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:55321';
const anon = readFileSync(join(root, 'apps/worker/.env'), 'utf8').match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim();
const FN_LOG = process.env.FN_LOG;
if (!anon || !FN_LOG) throw new Error('need the worker .env (anon key) and FN_LOG');

const ADMIN = { email: 'admin@dha-local.test', password: 'LocalAdmin#2026' };
const NONADMIN = { email: 'resident.pw@dha-local.test', password: 'LocalResident#2026' };
const sql = (q) => execFileSync('docker', ['exec', '-i', 'supabase_db_dha-works', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', q], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failed++; };

const call = async (method, path, { token, body, headers } = {}) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { apikey: anon, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
};
const rpc = (name, args, token) => call('POST', `/rest/v1/rpc/${name}`, { token, body: args });
const signIn = async (u) => (await call('POST', '/auth/v1/token?grant_type=password', { body: u })).json?.access_token;
const allCodes = () => [...readFileSync(FN_LOG, 'utf8').matchAll(/code is (\d{6})\./g)].map((m) => m[1]);
// The function log is written a moment after the reply, so wait for a code that was not there before the request.
const newCode = async (before) => {
  for (let i = 0; i < 40; i++) {
    const fresh = allCodes().filter((c) => !before.includes(c));
    if (fresh.length) return fresh.at(-1);
    await sleep(250);
  }
  return undefined;
};

// A fake non-admin account with a password (local only).
sql(`insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token)
 values ('cccccccc-0000-4000-8000-0000000000f1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${NONADMIN.email}', now(), extensions.crypt('${NONADMIN.password}', extensions.gen_salt('bf')), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', '') on conflict (id) do nothing`);
sql(`insert into public.profiles (id, role, full_name, email, phone, cnic, verification_status) values ('cccccccc-0000-4000-8000-0000000000f1','resident','Pw Resident [FAKE]','${NONADMIN.email}','03001230099','42101-9990099-9','approved') on conflict (id) do nothing`);
sql(`delete from auth.sessions where user_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','cccccccc-0000-4000-8000-0000000000f1')`);
sql(`delete from public.admin_factor_challenges`);
const WORKER = 'bbbbbbbb-0000-4000-8000-000000000002';
sql(`update public.profiles set verification_status = 'pending' where id = '${WORKER}'`);

// 1. Stolen password, no code ------------------------------------------------------------------------------------
const pwOnly = await signIn(ADMIN);
check('the admin password gives a session', !!pwOnly);
const st = await rpc('admin_session_status', {}, pwOnly);
check('the database says this session still needs a code', st.json === 'needs_code', String(st.text));
for (const [name, args] of [
  ['admin_verification_counts', { p_role: 'worker' }],
  ['admin_verification_queue', { p_role: 'worker', p_status: 'pending' }],
  ['admin_verification_detail', { p_profile: WORKER }],
  ['admin_decide_verification', { p_profile: WORKER, p_decision: 'approve', p_reason: '', p_checklist: { a: true } }],
  ['admin_set_account_status', { p_profile: WORKER, p_suspend: true, p_reason: 'because' }],
  ['invite_staff', { p_email: 'evil@example.com' }],
]) {
  const r = await rpc(name, args, pwOnly);
  check(`password only: ${name} is refused`, r.status >= 400 && !/"rows"|"full_name"/.test(r.text), `status ${r.status}`);
}
const audit = await call('GET', '/rest/v1/audit_log?select=id&limit=5', { token: pwOnly });
check('password only: the audit log reads as empty', Array.isArray(audit.json) && audit.json.length === 0);
const profiles = await call('GET', `/rest/v1/profiles?select=cnic&id=eq.${WORKER}`, { token: pwOnly });
check('password only: another person\'s profile (CNIC) is not readable', Array.isArray(profiles.json) && profiles.json.length === 0);
const docs = await call('POST', `/storage/v1/object/sign/identity/bbbbbbbb-0000-4000-8000-000000000001/cnic_front.png`, { token: pwOnly, body: { expiresIn: 60 } });
check('password only: an identity document (a file that exists) cannot be opened', docs.status >= 400, `status ${docs.status}`);
const forge = await call('PATCH', `/rest/v1/profiles?id=eq.${WORKER}`, { token: pwOnly, body: { verification_status: 'approved' } });
const stillPending = sql(`select verification_status from public.profiles where id = '${WORKER}'`);
check('password only: writing a status straight into the table does nothing', stillPending === 'pending', `status ${forge.status}, now ${stillPending}`);
const selfPromote = await call('POST', '/rest/v1/admin_verified_sessions', { token: pwOnly, body: { session_id: '11111111-1111-4111-8111-111111111111', user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' } });
check('password only: cannot mark the session verified by hand', selfPromote.status >= 400, `status ${selfPromote.status}`);

// 2. The email-code function --------------------------------------------------------------------------------------
check('code function: no token is refused', (await call('POST', '/functions/v1/admin-2fa', { body: {} })).status === 401);
check('code function: the anon key is not a user', (await call('POST', '/functions/v1/admin-2fa', { token: anon, body: {} })).status === 401);
const named = await call('POST', '/functions/v1/admin-2fa', { token: pwOnly, body: { email: 'evil@example.com', user_id: 'cccccccc-0000-4000-8000-0000000000f1' } });
check('code function: a body naming another address or user is refused', named.status === 400 || named.status === 413, `status ${named.status}`);
const nonAdmin = await signIn(NONADMIN);
const na = await call('POST', '/functions/v1/admin-2fa', { token: nonAdmin, body: {} });
check('code function: a non-admin cannot get a code', na.status === 403, `status ${na.status}`);
check('non-admin: the database says "not_admin"', (await rpc('admin_session_status', {}, nonAdmin)).json === 'not_admin');
check('non-admin: the queue is refused', (await rpc('admin_verification_queue', { p_role: 'worker', p_status: 'pending' }, nonAdmin)).status >= 400);
check('non-admin: invite_staff is refused', (await rpc('invite_staff', { p_email: 'evil@example.com' }, nonAdmin)).status >= 400);
const makeAdmin = await rpc('accept_staff_invite', { p_email: NONADMIN.email, p_token: 'guess', p_full_name: 'Evil' }, nonAdmin);
check('non-admin: cannot claim an admin account without an invite token', makeAdmin.status >= 400 && sql(`select role from public.profiles where id = 'cccccccc-0000-4000-8000-0000000000f1'`) === 'resident');

// 3. Brute force the code ---------------------------------------------------------------------------------------------
const seen1 = allCodes();
const issue = await call('POST', '/functions/v1/admin-2fa', { token: pwOnly, body: {} });
check('code function: the real admin gets a code (it is not in the response)', issue.status === 200 && !/\d{6}/.test(issue.text), `status ${issue.status}`);
const early = await call('POST', '/functions/v1/admin-2fa', { token: pwOnly, body: {} });
check('code function: asking again within a minute is refused', early.status === 429, `status ${early.status}`);
const real = await newCode(seen1);
check('(set-up) the dev code can be read from the function log', /^\d{6}$/.test(real ?? ''));
const results = [];
for (const guess of ['000000', '111111', '222222', '333333', '444444']) results.push((await rpc('admin_verify_code', { p_code: guess }, pwOnly)).json);
check('five wrong guesses: four "wrong" then "locked"', results.slice(0, 4).every((r) => r === 'wrong') && results[4] === 'locked', results.join(','));
check('after the lock even the real code is refused', (await rpc('admin_verify_code', { p_code: real }, pwOnly)).json === 'locked');
check('and the session is still not an admin session', (await rpc('admin_session_status', {}, pwOnly)).json === 'needs_code');

// 4. A real sign-in, replay, and a second session -------------------------------------------------------------------------
console.log('      waiting 61 s for the one-code-a-minute limit...'); await sleep(61_000);
const seen2 = allCodes();
const issue2 = await call('POST', '/functions/v1/admin-2fa', { token: pwOnly, body: {} });
check('a new code can be requested after the wait', issue2.status === 200, `status ${issue2.status}`);
const code2 = await newCode(seen2);
check('(set-up) the second code is a new one', !!code2 && code2 !== real);
const otherSession = await signIn(ADMIN);
check('a code issued for one session does not open another', (await rpc('admin_verify_code', { p_code: code2 }, otherSession)).json === 'none');
check('the right code opens the right session', (await rpc('admin_verify_code', { p_code: code2 }, pwOnly)).json === 'ok');
check('the verified session is an admin session', (await rpc('admin_session_status', {}, pwOnly)).json === 'verified');
check('and can read the queue', ((await rpc('admin_verification_queue', { p_role: 'worker', p_status: 'pending' }, pwOnly)).json?.rows ?? []).length >= 1);
check('the code cannot be used twice', (await rpc('admin_verify_code', { p_code: code2 }, pwOnly)).json === 'none');
check('the other session of the same admin is still locked out', (await rpc('admin_session_status', {}, otherSession)).json === 'needs_code');
const doc = await call('POST', `/storage/v1/object/sign/identity/bbbbbbbb-0000-4000-8000-000000000001/cnic_front.png`, { token: pwOnly, body: { expiresIn: 60 } });
check('the verified session can open an identity document (control)', doc.status === 200, `status ${doc.status}`);

// 5. Ending the session ends the admin power ------------------------------------------------------------------------------
const out = await call('POST', '/auth/v1/logout?scope=global', { token: pwOnly });
check('signing out works', out.status === 204 || out.status === 200, `status ${out.status}`);
check('the verification went with the session', sql(`select count(*) from public.admin_verified_sessions`) === '0');
const afterOut = await rpc('admin_verification_queue', { p_role: 'worker', p_status: 'pending' }, pwOnly);
check('the old token no longer works for admin calls', afterOut.status >= 400 && !/"rows"/.test(afterOut.text), `status ${afterOut.status}`);

console.log(failed === 0 ? '\nAll admin guards held.' : `\n${failed} admin guard(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
