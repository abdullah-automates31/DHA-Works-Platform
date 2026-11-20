// Attack drill for the admin "Forgot password?" feature (migration 0068). LOCAL stack only (refuses any other URL).
// Run: npm run db:local -- start, then node scripts/challenge-admin-reset-local.cjs  (uses supabase/dev/seed_local_admin.sql)
// Part A tries to take an admin account over with only the mailbox (Supabase's own recovery, magic link, one-time code).
// Part B attacks the new functions directly (wrong callers, odd emails, brute force, replay, races).
// Part C (only if `supabase functions serve` is running with ADMIN_MAIL_MODE=dev-log) attacks the Edge Function over HTTP.
const { execSync } = require('child_process');

const env = Object.fromEntries(execSync('npx supabase status -o env', { encoding: 'utf8' }).split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const URL = env.API_URL, ANON = env.ANON_KEY, SERVICE = env.SERVICE_ROLE_KEY, MAIL = env.INBUCKET_URL;
if (!/^http:\/\/127\.0\.0\.1:/.test(URL)) throw new Error('refusing: not a local stack ' + URL);
const psql = (q) => execSync('docker exec -i supabase_db_dha-works psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1', { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
let pass = 0, fail = 0;
const check = (ok, name, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  [' + extra + ']' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADMIN = 'admin@dha-local.test', OLD = 'LocalAdmin#2026', ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

async function call(path, { token = ANON, method = 'POST', body, headers = {} } = {}) {
  const r = await fetch(URL + path, { method, headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j, headers: r.headers };
}
const rpc = (fn, args, token) => call(`/rest/v1/rpc/${fn}`, { token, body: args ?? {} });
const svc = (fn, args) => rpc(fn, args, SERVICE);
const refused = (r) => r.status === 401 || r.status === 403 || r.status === 404 || (r.body && (r.body.code === '42501' || r.body.code === 'PGRST202'));
const signIn = (email = ADMIN, password = OLD) => call('/auth/v1/token?grant_type=password', { body: { email, password } });
const sessionOf = (tok) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()).session_id;
const resetDb = () => psql(`delete from public.admin_reset_signins; delete from public.admin_reset_challenges; delete from public.admin_factor_challenges; delete from public.audit_log where action like 'admin_%' and false;
  update auth.users set encrypted_password = extensions.crypt('${OLD}', extensions.gen_salt('bf', 10)) where id = '${ADMIN_ID}';`);

async function mailFor(to, subjectPart) {
  for (let i = 0; i < 10; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/messages`)).json();
    const m = (list.messages || []).find((x) => x.To.some((t) => t.Address === to) && (!subjectPart || x.Subject.includes(subjectPart)));
    if (m) return (await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json());
    await sleep(500);
  }
  return null;
}
const linkIn = (msg) => ((msg.HTML || msg.Text || '').match(/https?:\/\/[^\s"'<>)]+/g) || []).map((u) => u.replace(/&amp;/g, '&')).find((u) => /verify|token/.test(u));
async function openLink(link) {
  const r = await fetch(link.replace(/^http:\/\/[^/]+/, URL), { redirect: 'manual' });
  const frag = new URLSearchParams((r.headers.get('location') || '').split('#')[1] || '');
  return { status: r.status, access: frag.get('access_token'), refresh: frag.get('refresh_token') };
}

(async () => {
  execSync('docker exec -i supabase_db_dha-works psql -U postgres -d postgres -q', { input: require('fs').readFileSync('supabase/dev/seed_local_admin.sql'), stdio: ['pipe', 'pipe', 'pipe'] });
  resetDb();
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });

  console.log('--- A. Attacker controls the mailbox only (no portal password)');
  const newPw = 'AttackerChosen#99x';
  await call('/auth/v1/recover', { body: { email: ADMIN } });
  const rm = await mailFor(ADMIN, 'Reset');
  check(!!rm, 'A0 (setup) Supabase still emails a recovery link to an admin address');
  const rl = rm && linkIn(rm);
  const rs = rl ? await openLink(rl) : {};
  check(!!rs.access, 'A1 (setup) the link gives the attacker a session', 'this part is Supabase behaviour and cannot be switched off');
  const put = rs.access ? await call('/auth/v1/user', { method: 'PUT', token: rs.access, body: { password: newPw } }) : { status: 0 };
  check(put.status >= 400, 'A2 the recovery session CANNOT set a new password for an admin', `status ${put.status}`);
  check((await signIn(ADMIN, newPw)).status === 400, 'A3 the attacker-chosen password does not work');
  check(!!(await signIn()).body.access_token, 'A4 the real password still works');
  if (rs.access) {
    const sid = sessionOf(rs.access);
    check(psql(`select count(*) from auth.mfa_amr_claims where session_id = '${sid}' and authentication_method = 'password'`) === '0', 'A5 (setup) the recovery session is not a password session', psql(`select string_agg(authentication_method, ',') from auth.mfa_amr_claims where session_id = '${sid}'`));
    check(refused(await svc('admin_issue_challenge', { p_user: ADMIN_ID, p_session: sid })), 'A6 no admin code can be issued for a recovery session');
    check((await rpc('admin_session_status', {}, rs.access)).body !== 'verified', 'A7 the recovery session is not verified');
    check(refused(await rpc('admin_dashboard', { p_range: 'today' }, rs.access)), 'A8 the recovery session cannot read the admin dashboard');
    const f = await call('/functions/v1/admin-2fa', { token: rs.access, body: {} });
    check(f.status === 0 || f.status === 404 || f.status >= 400, 'A9 the admin-2fa function does not send a code for a recovery session', `status ${f.status}`);
  }
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });
  await sleep(62000); // Supabase sends one email per address a minute
  await call('/auth/v1/otp', { body: { email: ADMIN, create_user: false } });
  const om = await mailFor(ADMIN);
  // the project sends an emailed one-time CODE (not a link) for email sign-in: the attacker types it into /auth/v1/verify
  const oc = om && ((om.Text || '').match(/\b(\d{6})\b/) || [])[1];
  const ov = oc ? await call('/auth/v1/verify', { body: { type: 'email', email: ADMIN, token: oc } }) : { body: {} };
  const os = { access: ov.body && ov.body.access_token };
  if (os.access) {
    const sid = sessionOf(os.access);
    check(psql(`select count(*) from auth.mfa_amr_claims where session_id = '${sid}' and authentication_method = 'password'`) === '0', 'A10 (setup) the attacker has a session made from the emailed one-time code, not the password');
    check(refused(await svc('admin_issue_challenge', { p_user: ADMIN_ID, p_session: sid })), 'A10b no admin code can be issued for that session');
    check(refused(await rpc('admin_dashboard', { p_range: 'today' }, os.access)), 'A11 that session cannot read the admin dashboard');
  } else check(false, 'A10 (setup) the emailed one-time code gave no session, so the attack was not exercised', om ? 'mail arrived' : 'no mail');
  // the admin password is still the real one, so the owner can still sign in
  const good = await signIn();
  check(!!good.body.access_token, 'A12 the real password still signs in after all of that');
  check(psql(`select count(*) from auth.mfa_amr_claims where session_id = '${sessionOf(good.body.access_token)}' and authentication_method = 'password'`) === '1', 'A13 a normal sign-in is recorded as a password session');
  check(!refused(await svc('admin_issue_challenge', { p_user: ADMIN_ID, p_session: sessionOf(good.body.access_token) })), 'A14 and it can get its code');
  psql('delete from public.admin_factor_challenges;');

  console.log('--- B. The new functions');
  const userTok = good.body.access_token;
  check(refused(await rpc('admin_reset_issue', { p_email: ADMIN })), 'B1 anon cannot issue a reset code');
  check(refused(await rpc('admin_reset_issue', { p_email: ADMIN }, userTok)), 'B2 a signed-in user cannot issue a reset code');
  check(refused(await rpc('admin_reset_confirm', { p_email: ADMIN, p_code: '123456', p_password: 'x'.repeat(14) })), 'B3 anon cannot confirm a reset');
  check(refused(await rpc('admin_reset_confirm', { p_email: ADMIN, p_code: '123456', p_password: 'x'.repeat(14) }, userTok)), 'B4 a signed-in user cannot confirm a reset');
  const tbl = await call('/rest/v1/admin_reset_challenges?select=*', { method: 'GET', token: userTok });
  check(refused(tbl) || (Array.isArray(tbl.body) && tbl.body.length === 0), 'B5 the code table cannot be read through the API', `status ${tbl.status}`);
  const tbl2 = await call('/rest/v1/admin_reset_challenges', { token: userTok, body: { user_id: ADMIN_ID, code_hash: 'x' } });
  check(refused(tbl2) || tbl2.status >= 400, 'B6 nobody can write a code row through the API');

  const odd = ["admin@dha-local.test'--", "' or '1'='1", '%', 'admin@dha-local.test%', 'ADMIN@dha-local.test\u0000', 'аdmin@dha-local.test', 'admin@dha-local.test ,x@y.z', ' ', 'a@b'.repeat(200)];
  let bad = 0;
  for (const e of odd) { const r = await svc('admin_reset_issue', { p_email: e }); if (r.status === 200 && r.body && r.body.status === 'sent') bad++; }
  check(bad === 0, 'B7 odd emails (quotes, wildcards, a look-alike letter, a null byte, a list) never get a code', `${bad} got one`);
  check(psql('select count(*) from public.admin_reset_challenges') === '0', 'B8 and nothing was stored');

  const r1 = await svc('admin_reset_issue', { p_email: 'ADMIN@DHA-Local.test' });
  const code = r1.body && r1.body.code;
  check(r1.body && r1.body.status === 'sent' && /^\d{6}$/.test(code) && r1.body.email === ADMIN, 'B9 a real admin gets a six-digit code, case does not matter');
  const wrong = (c) => String(c) === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i++) await svc('admin_reset_confirm', { p_email: ADMIN, p_code: wrong(code), p_password: 'A long new password 1' });
  const fifth = await svc('admin_reset_confirm', { p_email: ADMIN, p_code: wrong(code), p_password: 'A long new password 1' });
  check(fifth.body === 'locked', 'B10 five wrong guesses lock the code');
  const rightLate = await svc('admin_reset_confirm', { p_email: ADMIN, p_code: code, p_password: 'A long new password 1' });
  check(rightLate.body === 'locked', 'B11 the right code no longer works once locked');
  check(!!(await signIn()).body.access_token, 'B12 the password is unchanged');
  resetDb();

  const r2 = await svc('admin_reset_issue', { p_email: ADMIN });
  const code2 = r2.body.code;
  const weak = await svc('admin_reset_confirm', { p_email: ADMIN, p_code: code2, p_password: 'short' });
  check(weak.body === 'weak', 'B13 the right code with a weak password is refused');
  const sess = await signIn();
  const before = { refresh: sess.body.refresh_token, access: sess.body.access_token };
  const okr = await svc('admin_reset_confirm', { p_email: ADMIN, p_code: code2, p_password: 'A long new password 1' });
  check(okr.body === 'ok', 'B14 the right code and a good password reset the password');
  check((await signIn(ADMIN, OLD)).status === 400, 'B15 the old password stops working');
  const signed = await signIn(ADMIN, 'A long new password 1');
  check(!!signed.body.access_token, 'B16 the new password signs in through the real auth service (bcrypt hash accepted)');
  const rf = await call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: before.refresh } });
  check(rf.status >= 400, 'B17 a refresh token from before the reset is dead', `status ${rf.status}`);
  check(refused(await rpc('admin_dashboard', { p_range: 'today' }, before.access)), 'B18 an old access token cannot read the admin dashboard');
  check((await svc('admin_reset_confirm', { p_email: ADMIN, p_code: code2, p_password: 'Another long password 2' })).body === 'none', 'B19 the same code cannot be used twice (replay)');
  check(psql(`select count(*) from public.audit_log where action = 'admin_password_reset'`) >= '1', 'B20 the reset is in the audit log');
  check(psql(`select count(*) from public.audit_log where reason like '%${code2}%' or new_data::text like '%${code2}%' or new_data::text like '%Long new password%'`) === '0', 'B21 neither the code nor the password is in the audit log');
  resetDb();

  // races: many requests at the same moment
  const many = await Promise.all(Array.from({ length: 12 }, () => svc('admin_reset_issue', { p_email: ADMIN })));
  const sent = many.filter((r) => r.body && r.body.status === 'sent').length;
  check(sent === 1, 'B22 twelve code requests at the same moment produce exactly one code', `${sent} codes`);
  const live = psql('select count(*) from public.admin_reset_challenges where not consumed');
  check(live === '1', 'B23 and exactly one is open');
  const code3 = many.find((r) => r.body && r.body.status === 'sent').body.code;
  const race = await Promise.all(Array.from({ length: 12 }, () => svc('admin_reset_confirm', { p_email: ADMIN, p_code: code3, p_password: 'Race winner password 3' })));
  const oks = race.filter((r) => r.body === 'ok').length;
  check(oks === 1, 'B24 twelve confirmations of the same code at the same moment: exactly one succeeds', `${oks} ok`);
  resetDb();

  // another admin's code does not work on this account; a resident cannot be reset
  const rid = psql(`select id from public.profiles where role = 'resident' limit 1`);
  const rEmail = rid && psql(`select email from auth.users where id = '${rid}'`);
  if (rEmail) check((await svc('admin_reset_issue', { p_email: rEmail })).body.status === 'not_admin', 'B25 a resident address gets no code');
  psql(`update public.profiles set account_status = 'suspended' where id = '${ADMIN_ID}'`);
  check((await svc('admin_reset_issue', { p_email: ADMIN })).body.status === 'not_admin', 'B26 a suspended admin gets no code');
  psql(`update public.profiles set account_status = 'active' where id = '${ADMIN_ID}'`);
  check(psql(`select count(*) from information_schema.triggers where trigger_name = 'block_admin_password_change'`) !== '0', 'B27 the password-change lock is installed');

  console.log('--- D. The first sign-in after a reset does not ask for the emailed code (0069)');
  resetDb();
  const dStart = psql('select now()'); // the audit log is append-only: count only this run's rows
  const NEWPW = 'After reset pass 12';
  const d0 = await signIn();
  check((await rpc('admin_verify_after_reset', {}, d0.body.access_token)).body === 'none', 'D1 with no reset, a normal password sign-in gets none (it needs the emailed code)');
  check((await rpc('admin_session_status', {}, d0.body.access_token)).body === 'needs_code', 'D2 and is still waiting for the code');
  check(refused(await rpc('admin_dashboard', { p_range: 'today' }, d0.body.access_token)), 'D3 and cannot read the dashboard');
  const dr = await svc('admin_reset_issue', { p_email: ADMIN });
  check((await svc('admin_reset_confirm', { p_email: ADMIN, p_code: dr.body.code, p_password: NEWPW })).body === 'ok', 'D4 (setup) a reset is completed');
  check(refused(await rpc('admin_verify_after_reset', {})), 'D5 anon cannot use the marker');
  const d1 = await signIn(ADMIN, NEWPW);
  check((await rpc('admin_session_status', {}, d1.body.access_token)).body === 'needs_code', 'D6 the new sign-in starts without the code');
  check((await rpc('admin_verify_after_reset', {}, d1.body.access_token)).body === 'ok', 'D7 the first password sign-in after the reset is verified without a code');
  check((await rpc('admin_session_status', {}, d1.body.access_token)).body === 'verified', 'D8 and the portal now sees a verified session');
  check(!refused(await rpc('admin_dashboard', { p_range: 'today' }, d1.body.access_token)), 'D9 and it can read the dashboard');
  const d2 = await signIn(ADMIN, NEWPW);
  check((await rpc('admin_verify_after_reset', {}, d2.body.access_token)).body === 'none', 'D10 the next sign-in needs the emailed code again (one use only)');
  check(refused(await rpc('admin_dashboard', { p_range: 'today' }, d2.body.access_token)), 'D11 and cannot read the dashboard');
  const dr2 = await svc('admin_reset_issue', { p_email: ADMIN });
  psql("update public.admin_reset_challenges set created_at = now() - interval '2 minutes'");
  const dr3 = await svc('admin_reset_issue', { p_email: ADMIN });
  check((await svc('admin_reset_confirm', { p_email: ADMIN, p_code: dr3.body.code, p_password: NEWPW + 'x' })).body === 'ok', 'D12 (setup) a second reset');
  psql("update public.admin_reset_signins set expires_at = now() - interval '1 second'");
  const d3 = await signIn(ADMIN, NEWPW + 'x');
  check((await rpc('admin_verify_after_reset', {}, d3.body.access_token)).body === 'none', 'D13 an expired marker (more than 10 minutes later) gives none');
  const rid2 = psql("select id from public.profiles where role = 'resident' limit 1");
  check(refused(await rpc('admin_verify_after_reset', {}, d3.body.access_token.slice(0, -3) + 'AAA')), 'D14 a tampered token is refused');
  check(psql(`select count(*) from public.audit_log where action = 'admin_signed_in_after_reset' and created_at >= '${dStart}'`) === '1', 'D15 the one use is in the audit log');
  resetDb();
  psql(`update auth.users set encrypted_password = extensions.crypt('${OLD}', extensions.gen_salt('bf', 10)) where id = '${ADMIN_ID}'`);

  console.log('--- C. The Edge Function over HTTP (skipped if it is not being served)');
  const probe = await call('/functions/v1/admin-password-reset', { body: {} });
  if (probe.status === 404 || probe.status === 0 || probe.status === 503) console.log('SKIP the function is not served (run: supabase functions serve --env-file <file with ADMIN_MAIL_MODE=dev-log>)');
  else {
    check((await call('/functions/v1/admin-password-reset', { method: 'GET' })).status === 405, 'C1 GET is refused');
    check((await call('/functions/v1/admin-password-reset', { body: { action: 'request' } })).status === 400, 'C2 a body without an email is refused');
    check((await call('/functions/v1/admin-password-reset', { body: { action: 'request', email: ADMIN, extra: 'x'.repeat(3000) } })).status === 413, 'C3 an oversized body is refused');
    const raw = await fetch(URL + '/functions/v1/admin-password-reset', { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${ANON}` }, body: '{not json' });
    check(raw.status === 400, 'C4 bad JSON is refused');
    const q = await call('/functions/v1/admin-password-reset', { body: { action: 'request', email: ADMIN, turnstile: 'x' } });
    check(q.status === 200 && q.body.status === 'sent' && !JSON.stringify(q.body).match(/\d{6}/), 'C5 a request for a real admin says sent and never includes the code', JSON.stringify(q.body));
    check((await call('/functions/v1/admin-password-reset', { body: { action: 'request', email: 'nobody@dha-local.test', turnstile: 'x' } })).body.status === 'not_admin', 'C6 an unknown address is told so');
    check((await call('/functions/v1/admin-password-reset', { body: { action: 'confirm', email: ADMIN, code: '12345', password: 'A long new password 1' } })).status === 400, 'C7 a short code is refused before the database');
    // end to end: the function mails the code (dev log), the confirm call sets the password, the auth service accepts it
    const logs = process.env.FN_LOG ? require('fs').readFileSync(process.env.FN_LOG, 'utf8') : execSync('docker logs --tail 60 supabase_edge_runtime_dha-works', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    // set FN_LOG to the file that `supabase functions serve` writes to
    const m = [...logs.matchAll(/admin-password-reset dev\] to=(\S+) .*code is (\d{6})/g)].pop();
    check(!!m && m[1] === ADMIN, 'C8 (setup) the code was mailed to the address on the account', m ? m[1] : 'no log line');
    if (m) {
      const wrongC = m[2] === '000000' ? '000001' : '000000';
      check((await call('/functions/v1/admin-password-reset', { body: { action: 'confirm', email: ADMIN, code: wrongC, password: 'End to end password 4' } })).body.status === 'wrong', 'C9 a wrong code is wrong');
      check((await call('/functions/v1/admin-password-reset', { body: { action: 'confirm', email: ADMIN, code: m[2], password: 'weak' } })).body.status === 'weak', 'C10 a weak password is refused over HTTP');
      check((await call('/functions/v1/admin-password-reset', { body: { action: 'confirm', email: ADMIN, code: m[2], password: 'End to end password 4' } })).body.status === 'ok', 'C11 the right code and a good password work over HTTP');
      check(!!(await signIn(ADMIN, 'End to end password 4')).body.access_token, 'C12 and the real auth service signs in with it');
    }
    // a recovery session cannot ask the admin-2fa function for a code (the function is served now)
    await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });
    await sleep(62000);
    await call('/auth/v1/recover', { body: { email: ADMIN } });
    const rm2 = await mailFor(ADMIN, 'Reset');
    const rs2 = rm2 ? await openLink(linkIn(rm2)) : {};
    if (rs2.access) {
      const f2 = await call('/functions/v1/admin-2fa', { token: rs2.access, body: {} });
      check(f2.status === 403 || f2.status === 401, 'C13 admin-2fa refuses to send a code for a recovery session', `status ${f2.status}`);
    } else check(false, 'C13 (setup) no recovery session');
  }
  resetDb();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
