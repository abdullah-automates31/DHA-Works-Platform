// LOCAL ONLY. Attack drill for the busy-worker and scheduling rules (migration 0058, owner notes of 16 Nov):
//   * a worker with a job in progress may accept and quote another only for a booked day and time (never ASAP);
//   * a second job may be started only for the same customer on the same day;
//   * one visiting time (the stored end is one hour later); a quote can be changed once;
//   * the one-hour reminder and its switch; the customer's and the worker's phone numbers appear only after acceptance.
// Real API calls as real signed-in fake users against the LOCAL stack (it refuses any non-local address). Every check
// either follows the rule or tries to get around it. Run from the repository root after seeding the lab:
// see supabase/dev/seed_local_attack_lab.sql.
const { execSync, spawn } = require('child_process');
const root = process.cwd();
// --hosted: run against the separate hosted TEST project instead of the local Docker stack (scripts/lib/hosted-test.cjs).
// It seeds the lab itself and expects a clean project (node scripts/test-db-hosted.cjs --reset --no-tests first).
const HOSTED = process.argv.includes('--hosted');
let anon, api, ids, sql;
if (HOSTED) {
  const h = require('./lib/hosted-test.cjs').hostedContext();
  anon = h.anon; api = h.url; sql = h.scalar;
  h.rows(require('fs').readFileSync('supabase/dev/seed_local_attack_lab.sql', 'utf8'));
  ids = h.rows('select id from atk.jobs order by n').map((r) => r.id);
} else {
  const env = execSync('npx supabase status -o env', { cwd: root, encoding: 'utf8' });
  anon = /ANON_KEY="([^"]+)"/.exec(env)[1];
  api = /API_URL="([^"]+)"/.exec(env)[1];
  if (!/127\.0\.0\.1|localhost/.test(api)) throw new Error('local only');
  ids = execSync('docker exec -i supabase_db_dha-works psql -U postgres -d postgres -At -c "select id from atk.jobs order by n"', { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  sql = (q) => execSync('docker exec -i supabase_db_dha-works psql -U postgres -d postgres -At -c "' + q.replace(/"/g, '\\"') + '"', { encoding: 'utf8' }).trim();
}
const J = (n) => ids[n - 1]; // 1..40 customer one, 41..50 customer two
let pass = 0, fail = 0;
const check = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  <-- ' + detail)); };
const login = async (e) => (await (await fetch(api + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: 'Test#12345' }) })).json()).access_token;
const H = (t, x) => ({ apikey: anon, authorization: 'Bearer ' + (t || anon), 'content-type': 'application/json', ...(x || {}) });
async function rpc(n, b, t) { const r = await fetch(api + '/rest/v1/rpc/' + n, { method: 'POST', headers: H(t), body: JSON.stringify(b || {}) }); const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = {}; } return { status: r.status, msg: (j && j.message) || '', body: j }; }
async function rest(p, t, m = 'GET', b) { const r = await fetch(api + '/rest/v1/' + p, { method: m, headers: H(t, { prefer: 'return=representation' }), body: b ? JSON.stringify(b) : undefined }); const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; } return { status: r.status, body: j }; }

// Karachi calendar: a time on day +n at hh:mm, as an ISO timestamp with the +05:00 offset.
const karachi = (n, hh, mm = 0) => {
  const d = new Date(Date.now() + 5 * 3600 * 1000 + n * 86400000); // "now" on the Karachi wall clock
  const day = d.toISOString().slice(0, 10);
  return `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:00`;
};

// The CUSTOMER picks the visiting time (migration 0059). The seed posts "as soon as possible" jobs, so the drill gives a job
// its date and time the way a customer would have chosen them. Worker apps send a decoy time that must be ignored.
const book = (job, n, hh, mm = 0) => {
  const d = new Date(Date.now() + 5 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);
  const from = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00';
  const to = hh >= 23 ? null : String(hh + 1).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00';
  sql("update public.jobs set urgency='scheduled', preferred_date='" + d + "', window_from='" + from + "', window_to=" + (to ? "'" + to + "'" : 'null') + " where id='" + job + "'");
};

(async () => {
  const w1 = await login('atk-w1@test.dev'), w2 = await login('atk-w2@test.dev');
  const res = await login('atk-res@test.dev'), res2 = await login('atk-res2@test.dev');
  const qid = (job) => sql(`select id from public.quotes where job_id='${job}' and status='sent' order by created_at desc limit 1`);
  const claim = (job, t, extra) => rpc('accept_job', { p_job_id: job, p_labour: 1000, ...extra }, t);
  const claimAt = (job, t, n, hh, mm = 0) => { book(job, n, hh, mm); return claim(job, t, { p_visit_start: karachi(n + 7, 3) }); };
  const mine = (job) => sql("select (q.visit_start = ((j.preferred_date + j.window_from) at time zone 'Asia/Karachi'))::text from public.quotes q join public.jobs j on j.id = q.job_id where q.job_id='" + job + "' order by q.created_at desc limit 1");

  // ---- 1. a free worker, one visiting time -------------------------------------------------------------
  let r = await claimAt(J(1), w1, 1, 10, 0);
  check('S1 free worker claims (the time he sends is only a decoy)', r.status < 300, r.msg);
  check('S1a the quote carries the CUSTOMER time, not the worker time', mine(J(1)) === 'true', 'worker time was used');
  check('S1b the stored end is exactly one hour later', sql(`select (visit_end - visit_start)::text from public.quotes where job_id='${J(1)}'`) === '01:00:00', 'end differs');
  r = await rpc('accept_quote', { p_quote_id: qid(J(1)) }, res);
  check('S2 the customer accepts', r.status < 300, r.msg);
  check('S2b the job is scheduled at the customer time', sql(`select status || ' ' || (scheduled_start = (select visit_start from public.quotes where job_id='${J(1)}' and status='accepted'))::text from public.jobs where id='${J(1)}'`) === 'scheduled true', 'not booked');
  r = await rpc('start_job', { p_job_id: J(1) }, w1);
  check('S3 w1 starts job 1 (now busy)', r.status < 300, r.msg);

  // ---- 2. a busy worker can only quote a job that has a customer time -------------------------------------------------
  for (const [label, extra] of [
    ['no time', {}],
    ['an end without a start', { p_visit_end: karachi(1, 14) }],
    ['a null start', { p_visit_start: null }],
    ['a time in the past', { p_visit_start: new Date(Date.now() - 3600000).toISOString() }],
    ['a start equal to now', { p_visit_start: new Date().toISOString() }],
    ['garbage text', { p_visit_start: 'soon' }],
    ['an empty text', { p_visit_start: '' }],
    ['an end before the start', { p_visit_start: karachi(1, 14), p_visit_end: karachi(1, 13) }],
    ['an end 13 hours after the start', { p_visit_start: karachi(1, 8), p_visit_end: karachi(1, 21, 30) }],
  ]) {
    r = await claim(J(2), w1, extra);
    check(`B1 busy worker, job has no customer time, worker sends ${label}: refused`, r.status >= 400, r.status + ' ' + r.msg);
  }
  check('B1b nothing was created by the refused tries', sql(`select count(*) from public.quotes where job_id='${J(2)}'`) === '0' && sql(`select status from public.jobs where id='${J(2)}'`) === 'open', 'a quote slipped in');

  r = await claimAt(J(2), w1, 1, 14, 0);
  check('B2 busy worker quotes job 2 (same customer, same day as the running job) at the customer time', r.status < 300, r.msg);
  check('B2a and the quote carries the customer time', mine(J(2)) === 'true', 'worker time was used');
  check('B2b nothing is held back; the customer is told at once', sql(`select busy_eta_pending from public.quotes where job_id='${J(2)}'`) === 'f' && sql(`select count(*) from public.notifications where type='quote_received' and job_id='${J(2)}'`) === '1', 'held');
  r = await claimAt(J(3), w1, 2, 10, 0);
  check('B3 and job 3 (same customer, the next day)', r.status < 300, r.msg);
  r = await claimAt(J(41), w1, 1, 14, 0);
  check('B4 and job 41 (another customer, same day)', r.status < 300, r.msg);
  check('B5 the worker was never asked for a finish time', sql(`select count(*) from public.notifications where type='busy_eta_needed'`) === '0', 'asked');

  // ---- 3. the quote times are the booking; the customer cannot be tricked ---------------------------------
  let q = await rest(`resident_quotes?job_id=eq.${J(2)}&select=visit_start,worker_phone`, res);
  check('C1 the customer sees the visit time and NO phone number before accepting', q.body[0] && q.body[0].visit_start && q.body[0].worker_phone === null, JSON.stringify(q.body));
  r = await rest(`quotes?job_id=eq.${J(2)}`, w1, 'PATCH', { visit_start: new Date(Date.now() + 30 * 86400000).toISOString() });
  check('C2 a direct edit of the quote time does nothing', sql(`select (visit_start > now() + interval '10 days')::text from public.quotes where job_id='${J(2)}'`) === 'false', 'edited; ' + r.status);
  for (const id of [2, 3]) await rpc('accept_quote', { p_quote_id: qid(J(id)) }, res);
  await rpc('accept_quote', { p_quote_id: qid(J(41)) }, res2);
  check('C3 all three are scheduled (not ASAP)', sql(`select count(*) from public.jobs where id in ('${J(2)}','${J(3)}','${J(41)}') and status='scheduled' and scheduled_start is not null`) === '3', 'not scheduled');
  q = await rest(`worker_jobs?id=eq.${J(2)}&select=resident_phone`, w1);
  check('C4 after acceptance the worker can read the customer phone (to call)', q.body[0] && /\d{7,}/.test(q.body[0].resident_phone || ''), JSON.stringify(q.body));
  q = await rest(`worker_jobs?id=eq.${J(2)}&select=resident_phone`, w2);
  check('C4b another worker sees no phone', !(q.body[0] && q.body[0].resident_phone), JSON.stringify(q.body));
  q = await rest(`resident_quotes?job_id=eq.${J(2)}&select=worker_phone`, res);
  check('C5 after acceptance the customer can read the worker phone (to call)', q.body[0] && /\d{7,}/.test(q.body[0].worker_phone || ''), JSON.stringify(q.body));
  q = await rest(`resident_quotes?job_id=eq.${J(41)}&select=worker_phone`, res);
  check('C5b the other customer cannot read it', Array.isArray(q.body) && q.body.length === 0, JSON.stringify(q.body));

  // ---- 4. starting a second job: the same customer on the same day only -----------------------------------
  const ref = 'finish your current job before starting';
  r = await rpc('start_job', { p_job_id: J(41) }, w1);
  check('D1 another customer: refused', r.status >= 400 && r.msg.includes(ref), r.status + ' ' + r.msg);
  r = await rpc('start_job', { p_job_id: J(3) }, w1);
  check('D2 same customer, another day: refused', r.status >= 400 && r.msg.includes(ref), r.status + ' ' + r.msg);
  r = await rpc('start_job', { p_job_id: J(2) }, w2);
  check('D3 another worker cannot start it', r.status >= 400, r.status + ' ' + r.msg);
  r = await rest(`jobs?id=eq.${J(41)}`, w1, 'PATCH', { status: 'in_progress' });
  check('D4 a direct edit of the job status does nothing', sql(`select status from public.jobs where id='${J(41)}'`) === 'scheduled', 'status moved; ' + r.status);
  r = await rest(`jobs?id=eq.${J(41)}`, w1, 'PATCH', { accepted_worker_id: '00000000-0000-0000-0000-0000000000b2' });
  check('D4b nor can the worker reassign it', sql(`select accepted_worker_id from public.jobs where id='${J(41)}'`) === '00000000-0000-0000-0000-0000000000b1', 'reassigned; ' + r.status);
  r = await rpc('start_job', { p_job_id: J(2) }, w1);
  check('D5 same customer, same day: allowed', r.status < 300, r.msg);
  r = await rpc('complete_job', { p_job_id: J(1), p_bill_path: null }, w1);
  check('D6 finishing job 1 alone does not free the worker from job 2', r.status < 300 && (await rpc('start_job', { p_job_id: J(41) }, w1)).status >= 400, 'freed too early');
  r = await rpc('complete_job', { p_job_id: J(2), p_bill_path: null }, w1);
  check('D7 job 2 is finished', r.status < 300, r.msg);
  r = await rpc('start_job', { p_job_id: J(41) }, w1);
  check('D8 now the other customer job starts', r.status < 300, r.msg);
  r = await rpc('start_job', { p_job_id: J(3) }, w1);
  check('D9 and job 3 (customer one) still has to wait for it', r.status >= 400 && r.msg.includes(ref), r.status + ' ' + r.msg);
  await rpc('complete_job', { p_job_id: J(41), p_bill_path: null }, w1);

  // ---- 5. the race: two starts for two customers at the same instant ------------------------------------------
  const ra = J(4), rb = J(42);
  await claimAt(ra, w2, 1, 9, 0);
  await claimAt(rb, w2, 1, 9, 0);
  await rpc('accept_quote', { p_quote_id: qid(ra) }, res);
  await rpc('accept_quote', { p_quote_id: qid(rb) }, res2);
  const [s1, s2] = await Promise.all([rpc('start_job', { p_job_id: ra }, w2), rpc('start_job', { p_job_id: rb }, w2)]);
  check('E1 two simultaneous starts for two customers: exactly one wins', (s1.status < 300) !== (s2.status < 300), `${s1.status} ${s2.status}`);
  check('E1b and only one job is in progress', sql(`select count(*) from public.jobs where accepted_worker_id='00000000-0000-0000-0000-0000000000b2' and status='in_progress'`) === '1', 'two running');

  // ---- 6. the Karachi day boundary --------------------------------------------------------------------------------------
  const e1 = J(5), e2 = J(6), e3 = J(7);
  // w1 is free now. 23:30 and 23:59 are the same Karachi day; 00:30 the next morning is another one.
  await claimAt(e1, w1, 3, 23, 30);
  await claimAt(e2, w1, 3, 23, 59);
  await claimAt(e3, w1, 4, 0, 30);
  for (const e of [e1, e2, e3]) await rpc('accept_quote', { p_quote_id: qid(e) }, res);
  r = await rpc('start_job', { p_job_id: e1 }, w1);
  check('F1 start the 23:30 job', r.status < 300, r.msg);
  r = await rpc('start_job', { p_job_id: e2 }, w1);
  check('F2 23:59 the same Karachi day: allowed', r.status < 300, r.msg);
  r = await rpc('start_job', { p_job_id: e3 }, w1);
  check('F3 00:30 the next Karachi day: refused', r.status >= 400 && r.msg.includes(ref), r.status + ' ' + r.msg);
  for (const e of [e1, e2]) await rpc('complete_job', { p_job_id: e, p_bill_path: null }, w1);

  // ---- 7. change the quote once -------------------------------------------------------------------------------------------
  const g = J(8);
  await claimAt(g, w1, 1, 10, 0);
  const gq = qid(g);
  const rev = (t, extra) => rpc('revise_quote', { p_quote_id: gq, p_labour: 900, p_materials: 0, p_materials_note: null, p_note: null, ...extra }, t);
  r = await rev(w2, { p_visit_start: karachi(1, 11) });
  check('G1 another worker cannot change it', r.status >= 400, r.status + ' ' + r.msg);
  r = await rev(res, { p_visit_start: karachi(1, 11) });
  check('G2 the customer cannot change it', r.status >= 400, r.status + ' ' + r.msg);
  check('G3 the customer time is on the quote before the change', mine(g) === 'true', 'wrong time');
  r = await rev(w1, { p_visit_start: karachi(1, 11) });
  check('G5 the worker changes the price once (a time he sends is ignored)', r.status < 300, r.msg);
  check('G4 the visit is still the customer time after the change', mine(g) === 'true', 'the worker moved the visit');
  check('G5b the stored end is one hour after the start', sql(`select (visit_end - visit_start)::text from public.quotes where id='${gq}'`) === '01:00:00', 'end differs');
  r = await rev(w1, { p_visit_start: karachi(1, 12) });
  check('G6 a second change is refused', r.status >= 400 && /already changed/.test(r.msg), r.status + ' ' + r.msg);
  r = await rpc('accept_quote', { p_quote_id: gq, p_revision: 0 }, res);
  check('G7 the customer cannot accept the old version (revision 0)', r.status >= 400, r.status + ' ' + r.msg);
  r = await rpc('accept_quote', { p_quote_id: gq, p_revision: 1 }, res);
  check('G8 and can accept the new one', r.status < 300, r.msg);
  r = await rev(w1, { p_visit_start: karachi(1, 13) });
  check('G9 after acceptance no change at all', r.status >= 400, r.status + ' ' + r.msg);

  // ---- 7b. a customer time that has already passed cannot be quoted -------------------------------------------------------
  book(J(9), -1, 9);
  r = await claim(J(9), w2, {});
  check('I1 a visiting time in the past cannot be quoted', r.status >= 400 && /already passed/.test(r.msg), r.status + ' ' + r.msg);

  // ---- 8. reminders -------------------------------------------------------------------------------------------------------------
  r = await rpc('set_job_reminders', { p_value: false }, w2);
  check('H1 a worker can switch reminders off', r.status < 300 && sql(`select job_reminders from public.worker_details where profile_id='00000000-0000-0000-0000-0000000000b2'`) === 'f', r.status + ' ' + r.msg);
  await rpc('set_job_reminders', { p_value: true }, w2);
  for (const [who, tok] of [['a customer', res], ['an anonymous caller', anon]]) {
    r = await rpc('set_job_reminders', { p_value: false }, tok);
    check(`H2 ${who} cannot use the switch`, r.status >= 400, r.status + ' ' + r.msg);
  }
  for (const bad of [null, [], {}, 'maybe', 'drop table jobs']) {
    r = await rpc('set_job_reminders', { p_value: bad }, w2);
    check(`H3 value ${JSON.stringify(bad)} refused`, r.status >= 400, r.status + ' ' + r.msg);
  }
  // The API turns 'yes' and 1 into plain booleans (standard); what matters is that the stored value stays on or off.
  for (const odd of ['yes', 1, 'off']) await rpc('set_job_reminders', { p_value: odd }, w2);
  check('H3b odd-but-valid values only ever leave a plain on or off', ['t', 'f'].includes(sql(`select job_reminders from public.worker_details where profile_id='00000000-0000-0000-0000-0000000000b2'`)), 'not a boolean');
  await rpc('set_job_reminders', { p_value: true }, w2);
  r = await rest(`worker_details?profile_id=eq.00000000-0000-0000-0000-0000000000b2`, w2, 'PATCH', { job_reminders: false });
  check('H4 the table cannot be written directly', sql(`select job_reminders from public.worker_details where profile_id='00000000-0000-0000-0000-0000000000b2'`) === 't', 'written; ' + r.status);
  r = await rest(`worker_details?profile_id=eq.00000000-0000-0000-0000-0000000000b2`, w1, 'PATCH', { job_reminders: false });
  check('H4b nor another worker', sql(`select job_reminders from public.worker_details where profile_id='00000000-0000-0000-0000-0000000000b2'`) === 't', 'written; ' + r.status);
  r = await rpc('send_job_reminders', {}, w1);
  check('H5 the reminder sweep is not callable from the API', r.status >= 400, r.status + ' ' + r.msg);
  r = await rest(`jobs?id=eq.${g}`, w1, 'PATCH', { worker_reminded_at: null });
  check('H5b the reminder marker cannot be written either', r.status >= 400 || sql(`select count(*) from public.jobs where id='${g}' and worker_reminded_at is null`) === '1', 'unexpected');
  // functional: pretend the visit is 50 minutes away
  sql(`update public.jobs set scheduled_start = now() + interval '50 minutes', scheduled_end = now() + interval '110 minutes' where id='${g}'`);
  sql(`update public.quotes set decided_at = now() - interval '3 hours' where id='${gq}'`);
  check('H6 fifty minutes before the visit the sweep sends exactly one reminder', sql('select private.send_job_reminders()') === '1', 'not sent');
  check('H6b it reached the worker, not the customer', sql(`select count(*) from public.notifications where type='job_reminder' and user_id='00000000-0000-0000-0000-0000000000b1'`) === '1' && sql(`select count(*) from public.notifications where type='job_reminder' and user_id='00000000-0000-0000-0000-0000000000a1'`) === '0', 'misdirected');
  check('H6c and never twice', sql('select private.send_job_reminders()') === '0', 'sent twice');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
