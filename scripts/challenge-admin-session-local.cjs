// Attack drill for admin sign-in and sessions (0055 emailed code, 0060, 0061, 0062; sign-in lasts until sign-out).
// Replaces scripts/challenge-admin-local.mjs (authenticator flow, removed 18 Nov). LOCAL stack only (refuses any other URL).
// Run: npm run db:local -- start, then node scripts/challenge-admin-session-local.cjs  (uses supabase/dev/seed_local_admin.sql)
const { execSync } = require('child_process');
const crypto = require('crypto');

// --hosted: run against the separate hosted TEST project instead of the local Docker stack (see scripts/lib/hosted-test.cjs).
const HOSTED = process.argv.includes('--hosted');
let URL, ANON, sql;
if (HOSTED) {
  const h = require('./lib/hosted-test.cjs').hostedContext();
  URL = h.url; ANON = h.anon; sql = h.scalar;
} else {
  const env = Object.fromEntries(execSync('npx supabase status -o env', { encoding: 'utf8' }).split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
  URL = env.API_URL; ANON = env.ANON_KEY;
  if (!/^http:\/\/127\.0\.0\.1:/.test(URL)) throw new Error('refusing: not a local stack ' + URL);
  sql = (q) => execSync('docker exec -i supabase_db_dha-works psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1', { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
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
  if (HOSTED) sql(require('fs').readFileSync('supabase/dev/seed_local_admin.sql', 'utf8'));
  else execSync('docker exec -i supabase_db_dha-works psql -U postgres -d postgres -q', { input: require('fs').readFileSync('supabase/dev/seed_local_admin.sql'), stdio: ['pipe', 'ignore', 'inherit'] });
  sql("delete from auth.mfa_factors where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'; delete from public.admin_verified_sessions where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'; delete from auth.sessions where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'; delete from public.admin_factor_challenges where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';");

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

  console.log('--- E. A real verified session (sign-in lasts until sign-out, owner 18 Nov), then sign-out (stolen cookie case)');
  const s3 = await signIn();
  const sid = sessionOf(s3.access_token);
  sql(`insert into public.admin_verified_sessions (session_id, user_id) values ('${sid}', '${s3.user.id}') on conflict (session_id) do update set verified_at = now(), fresh_at = now();`);
  check((await rpc('admin_session_status', {}, s3.access_token)).body === 'verified', 'E1 (setup) a verified session is an admin');
  const ok = await rpc('admin_save_settings', { p_helpline_number: '1092', p_helpline_enabled: true, p_report_window_days: 7, p_review_window_days: 7 }, s3.access_token);
  check(!refused(ok), 'E2 (control) the verified session can do admin work', `status ${ok.status}`);
  sql(`update public.admin_verified_sessions set verified_at = now() - interval '400 days', fresh_at = now() - interval '400 days' where session_id = '${sid}';`);
  check(!refused(await rpc('admin_save_settings', { p_helpline_number: '1092', p_helpline_enabled: true, p_report_window_days: 7, p_review_window_days: 7 }, s3.access_token)), 'E3 (owner rule) a sign-in 400 days old still works');
  const ref = await call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s3.refresh_token } });
  check(!!ref.body.access_token && sessionOf(ref.body.access_token) === sid, 'E4 (setup) refreshing the token keeps the same session');
  check(refused(await call(`/rest/v1/admin_verified_sessions?session_id=eq.${sid}`, { token: ref.body.access_token, method: 'PATCH', body: { user_id: '00000000-0000-0000-0000-000000000001' } })), 'E5 cannot edit its own verification row');
  check(refused(await rpc('admin_mark_session_verified', {}, ref.body.access_token)), 'E6 the old authenticator function stays closed');
  const out = await call('/auth/v1/logout?scope=local', { token: ref.body.access_token, body: {} });
  check(out.status === 204 || out.status === 200, 'E7 (setup) the staff member signs out', `status ${out.status}`);
  check(refused(await rpc('admin_save_settings', { p_helpline_number: '1092', p_helpline_enabled: true, p_report_window_days: 7, p_review_window_days: 7 }, ref.body.access_token)), 'E8 after sign-out a stolen access token (still unexpired) cannot do admin work');
  check((await rpc('admin_session_status', {}, ref.body.access_token)).body !== 'verified', 'E9 and is not reported as verified');
  const re = await call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: ref.body.refresh_token } });
  check(!re.body.access_token, 'E10 a stolen refresh token cannot start the session again after sign-out');
  check(Number(sql(`select count(*) from public.admin_verified_sessions where session_id = '${sid}';`)) === 0, 'E11 sign-out removed the verification row');

  console.log('--- F. A stranger signs up with an email (email sign-up stays on for staff invites) and tries to become an applicant');
  const mail = `stranger${Date.now()}@evil.test`;
  const su = await call('/auth/v1/signup', { body: { email: mail, password: 'Stranger#2026x' } });
  const st = su.body.access_token || (su.body.session && su.body.session.access_token);
  check(!!st, 'F0 (setup) the email sign-up gives a session', `status ${su.status}`);
  if (st) {
    const reg = await rpc('register_profile', { p_role: 'resident', p_full_name: 'Fake Person', p_phone: '+923001234567' }, st);
    check(refused(reg) || (reg.body && /phone number first/.test(JSON.stringify(reg.body))), 'F1 it cannot register as a resident with a typed phone', `status ${reg.status}`);
    const regw = await rpc('register_profile', { p_role: 'worker', p_full_name: 'Fake Worker', p_phone: '+923001234567' }, st);
    check(regw.status >= 400, 'F2 or as a worker');
    check(refused(await rpc('register_profile', { p_role: 'admin', p_full_name: 'Fake Admin', p_phone: '' }, st)) || (await rpc('register_profile', { p_role: 'admin', p_full_name: 'x', p_phone: '' }, st)).status >= 400, 'F3 or as an admin');
    const own = await call('/rest/v1/profiles?select=id', { token: st, method: 'GET' });
    check(refused(own) || (Array.isArray(own.body) && own.body.length === 0), 'F4 it has no profile and reads none');
    const jobs = await call('/rest/v1/jobs?select=id&limit=1', { token: st, method: 'GET' });
    check(refused(jobs) || (Array.isArray(jobs.body) && jobs.body.length === 0), 'F5 it cannot read any job', `status ${jobs.status}`);
    check(refused(await rpc('admin_session_status', {}, st)) || (await rpc('admin_session_status', {}, st)).body === 'not_admin', 'F6 it is not an admin');
    sql(`delete from auth.users where email = '${mail}';`);
  }

  console.log('--- G. Emailed code rules (replaces the old authenticator drill)');
  const g1 = await signIn();
  const g2 = await signIn();
  const sid1 = sessionOf(g1.access_token);
  sql("delete from public.admin_factor_challenges where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';");
  const code1 = sql(`select public.admin_issue_challenge('${g1.user.id}', '${sid1}');`);
  check(/^\d{6}$/.test(code1), 'G0 (setup) a code is issued for session 1');
  let early = ''; try { sql(`select public.admin_issue_challenge('${g1.user.id}', '${sid1}');`); } catch (e) { early = String(e.stderr || e.message); }
  check(/wait a minute/.test(early), 'G1 a second code within a minute is refused');
  check((await rpc('admin_verify_code', { p_code: code1 }, g2.access_token)).body !== 'ok', 'G2 a code issued for one session does not work in another');
  check((await rpc('admin_session_status', {}, g2.access_token)).body === 'needs_code', 'G3 the other session is still not verified');
  sql(`update public.admin_factor_challenges set expires_at = now() - interval '1 second' where session_id = '${sid1}' and not consumed;`);
  check((await rpc('admin_verify_code', { p_code: code1 }, g1.access_token)).body !== 'ok', 'G4 an expired code (over 10 minutes) is refused');
  sql("update public.admin_factor_challenges set created_at = now() - interval '2 minutes' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';");
  const code2 = sql(`select public.admin_issue_challenge('${g1.user.id}', '${sid1}');`);
  check((await rpc('admin_verify_code', { p_code: code2 }, g1.access_token)).body === 'ok', 'G5 (control) the right fresh code verifies the session');
  check((await rpc('admin_session_status', {}, g1.access_token)).body === 'verified', 'G6 (control) the session is now an admin session');
  check((await rpc('admin_verify_code', { p_code: code2 }, g2.access_token)).body !== 'ok', 'G7 the used code cannot be replayed in another session');
  check((await rpc('admin_session_status', {}, g2.access_token)).body === 'needs_code', 'G8 verifying one session does not verify the other');
  sql("update public.admin_factor_challenges set created_at = now() - interval '2 hours' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';");
  let n = 0, capped = false;
  for (let i = 0; i < 7; i++) {
    sql("update public.admin_factor_challenges set created_at = created_at - interval '61 seconds' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' and created_at > now() - interval '1 hour';");
    try { sql(`select public.admin_issue_challenge('${g1.user.id}', '${sid1}');`); n++; } catch (e) { if (/too many codes/.test(String(e.stderr || e.message))) { capped = true; break; } }
  }
  check(capped && n <= 5, 'G9 at most 5 codes an hour', `issued ${n}`);
  const gout = await call('/auth/v1/logout?scope=local', { token: g1.access_token, body: {} });
  check((gout.status === 204 || gout.status === 200) && refused(await rpc('admin_save_settings', { p_helpline_number: '1092', p_helpline_enabled: true, p_report_window_days: 7, p_review_window_days: 7 }, g1.access_token)), 'G10 after sign-out the verified token is dead');

  sql("delete from auth.mfa_factors where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
