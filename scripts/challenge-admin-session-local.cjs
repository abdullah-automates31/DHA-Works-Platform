// Attack drill for admin sessions (migrations 0055, 0060, 0061). LOCAL stack only (refuses any other URL).
// Run: npm run db:local -- start, then node scripts/challenge-admin-session-local.cjs  (uses supabase/dev/seed_local_admin.sql)
const { execSync } = require('child_process');
const crypto = require('crypto');

const env = Object.fromEntries(execSync('npx supabase status -o env', { encoding: 'utf8' }).split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const URL = env.API_URL, ANON = env.ANON_KEY;
if (!/^http:\/\/127\.0\.0\.1:/.test(URL)) throw new Error('refusing: not a local stack ' + URL);
const sql = (q) => execSync('docker exec -i supabase_db_dha-works psql -U postgres -d postgres -tA', { input: q, encoding: 'utf8' }).trim();
let pass = 0, fail = 0;
const check = (ok, name, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  [' + extra + ']' : ''}`); };

async function call(path, { token = ANON, method = 'POST', body, headers = {} } = {}) {
  const r = await fetch(URL + path, { method, headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
const rpc = (fn, args, token) => call(`/rest/v1/rpc/${fn}`, { token, body: args ?? {} });
const refused = (r) => r.status === 401 || r.status === 403 || r.status === 404 || (r.body && (r.body.code === '42501' || r.body.code === 'PGRST202'));
const sessionOf = (tok) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).session_id;

function totp(secretB32, t = Date.now()) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secretB32.replace(/=+$/, '').toUpperCase()) bits += alpha.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', key).update(ctr).digest(); const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}

async function signIn() {
  const r = await call('/auth/v1/token?grant_type=password', { body: { email: 'admin@dha-local.test', password: 'LocalAdmin#2026' } });
  if (!r.body.access_token) throw new Error('sign-in failed ' + JSON.stringify(r.body));
  return r.body;
}

(async () => {
  execSync('docker exec -i supabase_db_dha-works psql -U postgres -d postgres -q', { input: require('fs').readFileSync('supabase/dev/seed_local_admin.sql'), stdio: ['pipe', 'ignore', 'inherit'] });
  sql("delete from auth.mfa_factors where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'; delete from public.admin_verified_sessions where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'; delete from public.admin_factor_challenges where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';");

  console.log('--- A. Attacker has the password but not the mailbox');
  const s1 = await signIn();
  check((await rpc('admin_session_status', {}, s1.access_token)).body === 'needs_code', 'A1 password-only session is told it needs the code');
  check(refused(await rpc('admin_save_settings', { p_helpline_number: '1092', p_helpline_enabled: true, p_report_window_days: 7, p_review_window_days: 7 }, s1.access_token)), 'A2 cannot save settings');
  check(refused(await rpc('admin_set_account_status', { p_profile: "00000000-0000-0000-0000-000000000001", p_suspend: true, p_reason: 'x' }, s1.access_token)), 'A3 cannot suspend anyone');
  check(refused(await rpc('invite_staff', { p_email: 'evil@x.test' }, s1.access_token)), 'A4 cannot invite staff');
  const prof = await call('/rest/v1/profiles?select=id,phone&limit=5', { token: s1.access_token, method: 'GET' });
  check(refused(prof) || (Array.isArray(prof.body) && prof.body.length <= 1), 'A5 cannot list other people\'s profiles', `status ${prof.status}`);
  check(refused(await call('/rest/v1/admin_verified_sessions', { token: s1.access_token, body: { session_id: sessionOf(s1.access_token), user_id: s1.user.id } })), 'A6 cannot write its own verification row');
  check(refused(await rpc('admin_issue_challenge', { p_user: s1.user.id, p_session: sessionOf(s1.access_token) }, s1.access_token)), 'A7 cannot mint a code itself (only the email function can)');

  console.log('--- B. Attacker enrols their own authenticator app through the Auth API (old 0052 path)');
  const en = await call('/auth/v1/factors', { token: s1.access_token, body: { factor_type: 'totp', friendly_name: 'evil' + Date.now() } });
  if (en.body && en.body.id) {
    const ch = await call(`/auth/v1/factors/${en.body.id}/challenge`, { token: s1.access_token, body: {} });
    const vr = await call(`/auth/v1/factors/${en.body.id}/verify`, { token: s1.access_token, body: { challenge_id: ch.body.id, code: totp(en.body.totp.secret) } });
    const aal2 = vr.body.access_token;
    check(!!aal2, 'B0 (setup) attacker got an aal2 token from their own authenticator');
    if (aal2) {
      check(refused(await rpc('admin_mark_session_verified', {}, aal2)), 'B1 old authenticator function cannot mark the session verified');
      check(refused(await rpc('admin_register_totp', { p_factor: en.body.id }, aal2)), 'B2 cannot register the authenticator');
      check(refused(await rpc('admin_reset_totp', {}, aal2)), 'B3 cannot reset the real authenticator');
      check((await rpc('admin_session_status', {}, aal2)).body === 'needs_code', 'B4 still needs the emailed code');
      check(refused(await rpc('admin_save_settings', { p_helpline_number: '1092', p_helpline_enabled: true, p_report_window_days: 7, p_review_window_days: 7 }, aal2)), 'B5 still cannot do admin work');
    }
  } else check(false, 'B0 (setup) could not enrol a factor', JSON.stringify(en.body).slice(0, 120));

  console.log('--- C. Guessing the emailed code');
  const s2 = await signIn();
  sql(`select public.admin_issue_challenge('${s2.user.id}', '${sessionOf(s2.access_token)}');`);
  let locked = false;
  for (let i = 0; i < 12; i++) { const r = await rpc('admin_verify_code', { p_code: String(100000 + i) }, s2.access_token); if (r.body !== 'invalid' && r.body !== 'ok') locked = true; if (r.body === 'ok') { check(false, 'C1 a guess succeeded'); } }
  check(locked, 'C1 guessing is cut off before 12 tries');
  check((await rpc('admin_session_status', {}, s2.access_token)).body === 'needs_code', 'C2 guessing never verified the session');

  console.log('--- D. Forged or tampered tokens');
  const [h, p] = s1.access_token.split('.');
  const forged = h + '.' + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), session_id: '00000000-0000-0000-0000-000000000000', role: 'service_role' })).toString('base64url') + '.' + crypto.randomBytes(32).toString('base64url');
  check(refused(await rpc('admin_save_settings', { p_helpline_number: '1092', p_helpline_enabled: true, p_report_window_days: 7, p_review_window_days: 7 }, forged)), 'D1 a token with a changed payload is rejected');
  const none = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + p + '.';
  check(refused(await rpc('admin_session_status', {}, none)) || (await rpc('admin_session_status', {}, none)).body !== 'verified', 'D2 an unsigned (alg none) token is rejected');

  console.log('--- E. A real verified session, then 7 days later (stolen cookie case)');
  const s3 = await signIn();
  const sid = sessionOf(s3.access_token);
  sql(`insert into public.admin_verified_sessions (session_id, user_id) values ('${sid}', '${s3.user.id}') on conflict (session_id) do update set verified_at = now(), fresh_at = now();`);
  check((await rpc('admin_session_status', {}, s3.access_token)).body === 'verified', 'E1 (setup) a verified session is an admin');
  const ok = await rpc('admin_save_settings', { p_helpline_number: '1092', p_helpline_enabled: true, p_report_window_days: 7, p_review_window_days: 7 }, s3.access_token);
  check(!refused(ok), 'E2 (control) the verified session can do admin work', `status ${ok.status}`);
  sql(`update public.admin_verified_sessions set verified_at = now() - interval '7 days 1 minute', fresh_at = now() - interval '7 days 1 minute' where session_id = '${sid}';`);
  check((await rpc('admin_session_status', {}, s3.access_token)).body === 'needs_code', 'E3 after 7 days the session needs the emailed code again');
  check(refused(await rpc('admin_save_settings', { p_helpline_number: '1092', p_helpline_enabled: true, p_report_window_days: 7, p_review_window_days: 7 }, s3.access_token)), 'E4 after 7 days it cannot do admin work');
  const ref = await call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s3.refresh_token } });
  check(!!ref.body.access_token && sessionOf(ref.body.access_token) === sid, 'E5 (setup) refreshing the token keeps the same session');
  check(refused(await rpc('admin_save_settings', { p_helpline_number: '1092', p_helpline_enabled: true, p_report_window_days: 7, p_review_window_days: 7 }, ref.body.access_token)), 'E6 a refreshed token does not reset the 7 days');
  check(refused(await call(`/rest/v1/admin_verified_sessions?session_id=eq.${sid}`, { token: ref.body.access_token, method: 'PATCH', body: { verified_at: new Date().toISOString() } })), 'E7 cannot move its own verification date');
  check(refused(await rpc('admin_mark_session_verified', {}, ref.body.access_token)), 'E8 cannot renew through the old authenticator function');
  check((await rpc('admin_verify_code', { p_code: '000000' }, ref.body.access_token)).body !== 'ok', 'E9 a guessed code does not renew it');

  sql("delete from auth.mfa_factors where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
