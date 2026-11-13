// Pure logic of the operations screens: reports, jobs, helpline, settings. No network, no React.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCall, isCallerRole, isOutcome, isReason, outcomeChip, reasonLabel } from './helpline/rules.ts';
import { parseCancellations, parseJobCounts, parseJobDetail, parseJobs } from './jobs/parse.ts';
import { parseReportCounts, parseReportDetail, parseReports } from './reports/parse.ts';
import { activityOf, canDecide, choicesFor, isChoice, unsafeBanner } from './reports/rules.ts';
import { parseReviews, starsOf } from './reviews/parse.ts';
import { checkInviteEmail, checkNewPassword, checkSettings, inviteLink, tokenFromHash } from './settings/rules.ts';
import { parseSettings, parseStaff } from './settings/parse.ts';
import { parseUserDetail, parseUsers } from './users/parse.ts';

const ID = '00000000-0000-4000-8000-0000000000b1';
const ID2 = '00000000-0000-4000-8000-0000000000b2';
const T = '2026-11-07T08:00:00Z';

test('report list rows: bad rows are dropped, good rows are kept', () => {
  const list = parseReports({
    total: 3,
    rows: [
      { id: ID, code: 'RP-0412', kind: 'unsafe', status: 'new', created_at: T, reporter_name: 'Usman', reporter_role: 'worker', against_name: 'Hira', against_role: 'resident', job_code: 'DW-2043', job_title: 'Kitchen sink' },
      { id: 'nope', code: 'RP-1', kind: 'unsafe', status: 'new', created_at: T },
      { id: ID2, code: 'RP-2', kind: 'other' },
    ],
  });
  assert.equal(list.total, 3);
  assert.equal(list.rows.length, 1);
  assert.equal(list.rows[0]!.jobCode, 'DW-2043');
  assert.deepEqual(parseReports(null), { total: 0, rows: [] });
});

test('report counts: garbage becomes zeros', () => {
  const c = parseReportCounts({ open: 4, open_by_kind: { unsafe: 1, bad: 'x' }, first_call_minutes: null, resolved_this_week: '9' });
  assert.equal(c.open, 4);
  assert.deepEqual(c.openByKind, { unsafe: 1 });
  assert.equal(c.firstCallMinutes, null);
  assert.equal(c.resolvedThisWeek, 9);
  assert.equal(parseReportCounts('x').open, 0);
});

const detailJson = {
  report: { id: ID, code: 'RP-0412', kind: 'unsafe', status: 'new', created_at: T, reason_text: 'I feel unsafe' },
  reporter: { id: ID, name: 'Usman Khan', role: 'worker', phone: '03214567890', detail: 'Plumber' },
  against: { id: ID2, name: 'Hira Farooq', role: 'resident', phone: '03215550148' },
  job: { id: ID, code: 'DW-2043', title: 'Kitchen sink', status: 'in_progress', phase: 6, lane: 'Lane 7', quote_total: 3200 },
  photos: ['a/b.jpg', 5],
  notes: [{ id: ID, note: 'Called first', created_at: '2026-11-07T08:30:00Z', author_name: 'Staff' }, { note: 'no id' }],
  calls: [{ id: ID2, called_id: ID, called_name: 'Usman Khan', outcome: 'Safe now', called_at: '2026-11-07T08:20:00Z', called_by_name: 'Staff' }],
};

test('a case: parsed, and the activity list reads in order', () => {
  const d = parseReportDetail(detailJson)!;
  assert.equal(d.reporter.name, 'Usman Khan');
  assert.deepEqual(d.photos, ['a/b.jpg']);
  assert.equal(d.notes.length, 1);
  const a = activityOf(d);
  assert.equal(a[0]!.title, 'Worker reported feeling unsafe');
  assert.equal(a[0]!.tone, 'stop');
  assert.equal(a[1]!.title, 'DHA staff alerted automatically');
  assert.equal(a[2]!.title, 'Called Usman Khan');
  assert.equal(a[3]!.title, 'Called first');
  assert.ok(!a.some((x) => x.key === 'waiting'), 'no "waiting for a call" once a call was made');
  assert.equal(unsafeBanner(d).title, 'Usman says they feel unsafe at DW-2043.');
});

test('an unsafe case with no call yet says it is waiting; a resolved one shows its outcome', () => {
  const open = parseReportDetail({ ...detailJson, calls: [], notes: [] })!;
  assert.equal(activityOf(open).at(-1)!.title, 'Waiting for a staff call');
  const resolved = parseReportDetail({ ...detailJson, report: { ...detailJson.report, status: 'resolved', action: 'warning', action_reason: 'Be polite', resolved_at: '2026-11-07T09:00:00Z' } })!;
  assert.equal(activityOf(resolved).at(-1)!.title, 'Warning sent');
  assert.equal(parseReportDetail({ report: {} }), null);
  assert.equal(parseReportDetail(null), null);
});

test('case decisions', () => {
  assert.equal(isChoice('suspend'), true);
  assert.equal(isChoice('delete'), false);
  assert.deepEqual(canDecide('keep_open', ''), { ok: true });
  assert.equal(canDecide('warning', '  ').ok, false);
  assert.equal(canDecide('close', 'Resolved by phone').ok, true);
  assert.equal(canDecide('suspend', 'x'.repeat(501)).ok, false);
  const opts = choicesFor({ name: 'Hira', role: 'resident' });
  assert.deepEqual(opts.map((o) => o.key), ['keep_open', 'warning', 'suspend', 'close']);
  assert.match(opts[2]!.hint, /resident cannot post or book/);
  assert.equal(opts[0]!.needsReason, false);
  assert.equal(opts[2]!.tone, 'stop');
});

test('jobs list, counts, detail and cancellation requests', () => {
  const j = parseJobs({ total: 41, rows: [{ id: ID, code: 'DW-2043', title: 'Sink', status: 'in_progress', phase: 6, category: 'Plumbing', updated_at: T, resident_name: 'Hira', worker_name: null, quote_total: '3200', open_reports: 1, cancel_pending: true }, { id: 'x' }] });
  assert.equal(j.total, 41);
  assert.equal(j.rows.length, 1);
  assert.equal(j.rows[0]!.quoteTotal, 3200);
  assert.equal(j.rows[0]!.cancelPending, true);
  assert.deepEqual(parseJobCounts({ total: 9, by_status: { open: 3, odd: 'x' }, cancellations_pending: 2 }), { total: 9, byStatus: { open: 3 }, cancellationsPending: 2 });
  const d = parseJobDetail({
    job: { id: ID, code: 'DW-1', status: 'scheduled', title: 'T', description: 'D', phase: 6, lane: 'L', category: 'Plumbing' },
    photos: ['a/b.jpg'], resident: { id: ID, name: 'R' }, worker: null,
    quote: { labour: 2200, materials: 1000, total: 3200 }, cash: { agreed_amount: 3200, worker_amount: null, matched: null },
    counts: { interested: 2, quotes: 1 }, events: [{ type: 'posted', at: T }, { type: 'x' }], reports: [], cancellations: [],
  })!;
  assert.equal(d.quote!.total, 3200);
  assert.equal(d.cash!.workerAmount, null);
  assert.equal(d.worker, null);
  assert.equal(d.events.length, 1);
  assert.equal(parseJobDetail({ job: {} }), null);
  const c = parseCancellations({ total: 1, rows: [{ id: ID, job_id: ID2, created_at: T, requester_name: 'Hira', reason_code: 'schedule_conflict', job_code: 'DW-1', job_title: 'T' }] });
  assert.equal(c.rows[0]!.jobCode, 'DW-1');
});

test('helpline: choices, the outcome chip and the form check', () => {
  assert.equal(isCallerRole('worker'), true);
  assert.equal(isCallerRole('robot'), false);
  assert.equal(isReason('cash_price'), true);
  assert.equal(isOutcome('callback_pending'), true);
  assert.equal(reasonLabel('cash_price'), 'Cash and price');
  assert.deepEqual(outcomeChip({ outcome: 'callback_pending', reportCode: null, callbackDoneAt: null }), { label: 'Callback pending', tone: 'red' });
  assert.deepEqual(outcomeChip({ outcome: 'callback_pending', reportCode: null, callbackDoneAt: T }), { label: 'Call-back done', tone: 'ok' });
  assert.equal(outcomeChip({ outcome: 'answered', reportCode: 'RP-0412', callbackDoneAt: null }).label, 'Case opened');
  assert.equal(outcomeChip({ outcome: 'advised', reportCode: null, callbackDoneAt: null }).label, 'Advised');
  const good = { name: 'Imran', phone: '0321 456 7890', role: 'worker', reason: 'question', outcome: 'answered', notes: '' };
  assert.deepEqual(checkCall(good), { ok: true });
  assert.equal(checkCall({ ...good, name: 'A' }).ok, false);
  assert.equal(checkCall({ ...good, phone: 'abc' }).ok, false);
  assert.equal(checkCall({ ...good, role: 'x' }).ok, false);
  assert.equal(checkCall({ ...good, reason: 'x' }).ok, false);
  assert.equal(checkCall({ ...good, outcome: 'x' }).ok, false);
  assert.equal(checkCall({ ...good, notes: 'x'.repeat(1001) }).ok, false);
});

test('users and the person page', () => {
  const u = parseUsers({ total: 184, rows: [{ id: ID, full_name: 'Usman', phone: '0321', account_status: 'suspended', open_reports: 1, categories: 'Plumbing', phases: [5, 6, 'x'], rating_avg: '4.80', rating_count: 276, jobs_count: 312 }, { full_name: 'no id' }] });
  assert.equal(u.rows.length, 1);
  assert.equal(u.rows[0]!.ratingAvg, 4.8);
  assert.deepEqual(u.rows[0]!.phases, [5, 6]);
  const d = parseUserDetail({ id: ID, role: 'worker', full_name: 'Usman', cnic_masked: '42101-*******-1', created_at: T, documents: [{ type: 'cnic_front', path: 'a/b.jpg' }, { type: 5 }], notes: [], worker: { experience_years: 8, rating_avg: 4.8, rating_count: 3, jobs_done: 312 }, categories: ['Plumbing'], phases: [5], recent_jobs: [] })!;
  assert.equal(d.cnicMasked, '42101-*******-1');
  assert.equal(d.documents.length, 1);
  assert.equal(d.worker!.jobsDone, 312);
  assert.equal(parseUserDetail({ id: ID, role: 'admin' }), null);
});

test('reviews: stars are the rounded average', () => {
  assert.equal(starsOf(5), 5);
  assert.equal(starsOf(4.5), 5);
  assert.equal(starsOf(2.33), 2);
  assert.equal(starsOf(0), 0);
  assert.equal(starsOf(9), 5);
  const r = parseReviews({ total: 1, hidden: 2, all: 9, rows: [{ id: ID, worker_id: ID2, created_at: T, score: '2.00', behaviour: 2, completeness: 2, quality: 2, hire_again: false, comment: 'No', worker_name: 'Bilal', resident_name: 'Ayesha', job_id: ID, job_code: 'DW-2038' }] });
  assert.equal(r.rows[0]!.score, 2);
  assert.equal(r.hidden, 2);
  assert.equal(r.all, 9);
});

test('settings and staff', () => {
  const s = parseSettings({ categories: [{ id: 1, name: 'Plumbing', subtitle: null, active: true, workers: 4 }, { id: 'x' }], phases: [{ phase: 5, active: true }], helpline_number: '1092', helpline_enabled: true, report_window_days: 10, review_window_days: 14 })!;
  assert.equal(s.categories.length, 1);
  assert.equal(s.reportWindowDays, 10);
  assert.equal(parseSettings(null), null);
  const st = parseStaff({ admins: [{ id: ID, name: 'A', email: 'a@x.io', created_at: T, account_status: 'active', is_me: true }], invites: [{ id: ID2, email: 'n@x.io', expired: true }, { id: 'bad' }] });
  assert.equal(st.admins[0]!.isMe, true);
  assert.equal(st.invites.length, 1);
  assert.deepEqual(parseStaff('x'), { admins: [], invites: [] });
});

test('settings form rules', () => {
  const ok = { number: '1092', enabled: true, reportDays: 7, reviewDays: 7 };
  assert.deepEqual(checkSettings(ok), { ok: true });
  assert.equal(checkSettings({ ...ok, number: 'abc' }).ok, false);
  assert.equal(checkSettings({ ...ok, number: '' }).ok, false, 'cannot show an empty number');
  assert.deepEqual(checkSettings({ ...ok, number: '', enabled: false }), { ok: true });
  assert.equal(checkSettings({ ...ok, reportDays: 0 }).ok, false);
  assert.equal(checkSettings({ ...ok, reportDays: 31 }).ok, false);
  assert.equal(checkSettings({ ...ok, reviewDays: 1.5 }).ok, false);
  assert.equal(checkSettings({ ...ok, reviewDays: NaN }).ok, false);
});

test('invites: email check, link, and password rules', () => {
  assert.equal(checkInviteEmail('new.staff@dha.example').ok, true);
  assert.equal(checkInviteEmail('nope').ok, false);
  assert.equal(checkInviteEmail('a@b').ok, false);
  // the token is in the fragment, which a browser never sends to the server
  assert.equal(inviteLink('https://admin.example', 'a+b@x.io', 'abc123'), 'https://admin.example/accept-invite?email=a%2Bb%40x.io#token=abc123');
  assert.equal(inviteLink('https://admin.example', 'a@x.io', 'abc123').includes('?token'), false);
  const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';
  assert.equal(tokenFromHash(`#token=${hex}`), hex);
  assert.equal(tokenFromHash(`token=${hex}`), hex);
  for (const bad of ['', '#', '#token=', '#token=short', '#token=zzzzzzzzzzzzzzzzzzzzzzzz', `#other=${hex}`, `#token=${hex}&x=1&${'y'.repeat(400)}`, null, undefined]) assert.equal(tokenFromHash(bad), null);
  assert.equal(checkNewPassword('short', 'short').ok, false);
  assert.equal(checkNewPassword('long enough password', 'different password!').ok, false);
  assert.deepEqual(checkNewPassword('long enough password', 'long enough password'), { ok: true });
  assert.equal(checkNewPassword('x'.repeat(73), 'x'.repeat(73)).ok, false);
});
