import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canReport,
  canRequestCancellation,
  chipFor,
  dayWord,
  canCall,
  dialable,
  initials,
  inTab,
  jobKind,
  noteFor,
  primaryAction,
  progressSegments,
  reportableJobs,
  shortName,
  sortJobs,
  stamp,
  timeline,
  visitLine,
  windowText,
  type JobKind,
  type MyJob,
} from './rules.ts';

const now = new Date(2026, 9, 24, 9, 0); // Sat 24 Oct 2026, 9 AM
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();

const base: MyJob = {
  id: 'j1', code: 'DW-2043', status: 'scheduled', title: 'Kitchen sink leakage', phase: 6, lane: 'Lane 7',
  scheduledStart: at(24, 11), scheduledEnd: at(24, 13), startedAt: null, completedAt: null,
  isMine: true, myQuoteStatus: 'accepted', myQuoteTotal: 3200,
  residentName: 'Hira Farooq', residentPhone: '+923215550148', plotNo: '118-C', floor: null, cancellationPending: false,
};
const j = (patch: Partial<MyJob>): MyJob => ({ ...base, ...patch });

test('reportableJobs keeps started jobs and drops completed ones older than 7 days', () => {
  const jobs = [
    j({ id: 'a', status: 'scheduled' }),
    j({ id: 'b', status: 'in_progress' }),
    j({ id: 'c', status: 'completed', completedAt: at(20, 10) }),
    j({ id: 'd', status: 'completed', completedAt: at(10, 10) }),
    j({ id: 'e', status: 'quoted', isMine: false, myQuoteStatus: 'sent' }),
  ];
  assert.deepEqual(reportableJobs(jobs, now).map((x) => x.id), ['b', 'c']);
});

test('the kind of a job comes from its status, my quote and whether I won it', () => {
  assert.equal(jobKind(j({ status: 'open', isMine: null, myQuoteStatus: null })), 'interested');
  assert.equal(jobKind(j({ status: 'interested', isMine: null, myQuoteStatus: null })), 'interested');
  assert.equal(jobKind(j({ status: 'quoted', isMine: false, myQuoteStatus: 'sent' })), 'quoted');
  assert.equal(jobKind(j({ status: 'quoted', isMine: false, myQuoteStatus: 'withdrawn' })), 'interested');
  assert.equal(jobKind(j({ status: 'quoted', isMine: false, myQuoteStatus: 'rejected' })), 'not_chosen');
  assert.equal(jobKind(j({ status: 'scheduled' })), 'scheduled');
  assert.equal(jobKind(j({ status: 'accepted' })), 'scheduled');
  assert.equal(jobKind(j({ status: 'in_progress' })), 'in_progress');
  assert.equal(jobKind(j({ status: 'completed' })), 'completed');
  assert.equal(jobKind(j({ status: 'cash_collected' })), 'cash_collected');
  assert.equal(jobKind(j({ status: 'reviewed' })), 'reviewed');
  assert.equal(jobKind(j({ status: 'disputed' })), 'disputed');
  assert.equal(jobKind(j({ status: 'cancelled', isMine: null })), 'cancelled');
  assert.equal(jobKind(j({ status: 'expired', isMine: null })), 'expired');
});

test('a job won by someone else is "not chosen", never shown as mine', () => {
  for (const status of ['scheduled', 'in_progress', 'completed', 'cash_collected', 'reviewed', 'disputed']) {
    assert.equal(jobKind(j({ status, isMine: false, myQuoteStatus: 'not_selected' })), 'not_chosen', status);
    assert.equal(jobKind(j({ status, isMine: null, myQuoteStatus: null })), 'not_chosen', status);
  }
});

test('tabs: a completed job stays Active until its cash is recorded', () => {
  assert.equal(inTab('interested', 'active'), true);
  assert.equal(inTab('completed', 'active'), true);
  assert.equal(inTab('cash_collected', 'active'), false);
  assert.equal(inTab('cash_collected', 'completed'), true);
  assert.equal(inTab('reviewed', 'completed'), true);
  assert.equal(inTab('scheduled', 'completed'), false);
  for (const k of ['cancelled', 'expired', 'not_chosen'] as JobKind[]) {
    assert.equal(inTab(k, 'active'), false, k);
    assert.equal(inTab(k, 'completed'), false, k);
    assert.equal(inTab(k, 'all'), true, k);
  }
});

test('sorting: in progress, then scheduled by time, then waiting jobs', () => {
  const list = [
    j({ id: 'a', status: 'quoted', isMine: false, myQuoteStatus: 'sent' }),
    j({ id: 'b', status: 'scheduled', scheduledStart: at(25, 11) }),
    j({ id: 'c', status: 'in_progress' }),
    j({ id: 'd', status: 'scheduled', scheduledStart: at(24, 11) }),
    j({ id: 'e', status: 'completed', completedAt: at(23, 12) }),
  ];
  assert.deepEqual(sortJobs(list).map((x) => x.id), ['c', 'd', 'b', 'e', 'a']);
});

test('progress segments follow the design (3, 5, 6, 7 of 9)', () => {
  assert.equal(progressSegments('interested'), 3);
  assert.equal(progressSegments('scheduled'), 5);
  assert.equal(progressSegments('in_progress'), 6);
  assert.equal(progressSegments('completed'), 7);
  assert.equal(progressSegments('reviewed'), 9);
  assert.equal(progressSegments('cancelled'), 0);
  assert.equal(progressSegments('not_chosen'), 0);
});

test('chips and main actions', () => {
  assert.equal(chipFor('scheduled').label, 'Scheduled');
  assert.equal(chipFor('not_chosen').label, 'Rejected');
  assert.equal(chipFor('disputed').label, 'Under review');
  assert.equal(primaryAction('interested'), 'create_quote');
  assert.equal(primaryAction('quoted'), 'waiting');
  assert.equal(primaryAction('scheduled'), 'start');
  assert.equal(primaryAction('in_progress'), 'complete');
  assert.equal(primaryAction('completed'), 'record_cash');
  assert.equal(primaryAction('cash_collected'), 'back');
  assert.equal(primaryAction('disputed'), 'help');
  assert.equal(primaryAction('cancelled'), 'find_jobs');
});

test('reports and cancellation requests are offered only in the right states', () => {
  assert.equal(canReport('scheduled'), false);
  assert.equal(canReport('in_progress'), true);
  assert.equal(canReport('cash_collected'), true);
  assert.equal(canReport('interested'), false);
  assert.equal(canRequestCancellation('scheduled', false), true);
  assert.equal(canRequestCancellation('in_progress', false), true);
  assert.equal(canRequestCancellation('scheduled', true), false);
  assert.equal(canRequestCancellation('completed', false), false);
  assert.equal(canRequestCancellation('interested', false), false);
});

test('dates and windows', () => {
  assert.equal(dayWord(at(24, 11), now), 'today');
  assert.equal(dayWord(at(25, 11), now), 'tomorrow');
  assert.equal(dayWord(at(27, 11), now), 'Tue 27 Oct');
  assert.equal(windowText(at(24, 11), at(24, 13)), '11 AM to 1 PM');
  assert.equal(windowText(at(24, 14), at(24, 16)), '2 to 4 PM');
  assert.equal(visitLine(at(24, 11), at(24, 13), now), 'Today, 11 AM to 1 PM');
  assert.equal(visitLine(at(25, 14), at(25, 16), now), 'Tomorrow, 2 to 4 PM');
  assert.equal(visitLine(at(28, 14), at(28, 16), now), 'Wed 28 Oct, 2 to 4 PM');
  assert.equal(visitLine(null, null, now), '');
  assert.equal(stamp(at(24, 9, 40)), 'Sat 24 Oct, 9:40 AM');
});

test('the timeline marks done, current and todo steps like the design', () => {
  const steps = timeline({ kind: 'scheduled', interestAt: at(24, 9, 40), quoteAt: at(24, 10, 30), quoteTotal: 3200, scheduledStart: at(24, 11), scheduledEnd: at(24, 13), startedAt: null, completedAt: null, cashAmount: null });
  assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo']);
  assert.equal(steps[0]?.sub, 'Sat 24 Oct, 9:40 AM');
  assert.equal(steps[1]?.sub, 'Rs 3,200 sent at 10:30 AM');
  assert.equal(steps[2]?.sub, 'Sat 24 Oct, 11 AM to 1 PM');
  assert.equal(steps[3]?.sub, '');
});

test('a finished job shows every step as done', () => {
  const steps = timeline({ kind: 'reviewed', interestAt: at(24, 9), quoteAt: at(24, 10), quoteTotal: 3200, scheduledStart: at(24, 11), scheduledEnd: at(24, 13), startedAt: at(24, 11, 8), completedAt: at(24, 12, 20), cashAmount: 3200 });
  assert.ok(steps.every((s) => s.state === 'done'));
  assert.equal(steps[3]?.sub, 'Started at 11:08 AM');
  assert.equal(steps[4]?.sub, 'Finished at 12:20 PM');
  assert.equal(steps[5]?.sub, 'Rs 3,200 in cash');
  assert.equal(steps[6]?.sub, 'Customer rated the job');
});

test('completed is done (green tick) as soon as the worker completes the job; cash collected waits', () => {
  const steps = timeline({ kind: 'completed', interestAt: at(24, 9), quoteAt: at(24, 10), quoteTotal: 3200, scheduledStart: at(24, 11), scheduledEnd: at(24, 13), startedAt: at(24, 11, 8), completedAt: at(24, 12, 20), cashAmount: null });
  assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'done', 'done', 'done', 'current', 'todo']);
  assert.equal(steps[4]?.sub, 'Finished at 12:20 PM');
});

test('in progress is the current step while the work is going on', () => {
  const steps = timeline({ kind: 'in_progress', interestAt: at(24, 9), quoteAt: at(24, 10), quoteTotal: 3200, scheduledStart: at(24, 11), scheduledEnd: at(24, 13), startedAt: at(24, 11, 8), completedAt: null, cashAmount: null });
  assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'done', 'current', 'todo', 'todo', 'todo']);
});

test('once the cash is collected that step is done and the review is still to come', () => {
  const steps = timeline({ kind: 'cash_collected', interestAt: at(24, 9), quoteAt: at(24, 10), quoteTotal: 3200, scheduledStart: at(24, 11), scheduledEnd: at(24, 13), startedAt: at(24, 11, 8), completedAt: at(24, 12, 20), cashAmount: 3200 });
  assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'done', 'done', 'done', 'done', 'todo']);
  assert.equal(steps[6]?.sub, '');
});

test('stopped jobs end with a stop step after the stages they reached', () => {
  const cancelled = timeline({ kind: 'cancelled', interestAt: at(24, 9), quoteAt: at(24, 10), quoteTotal: 3200, scheduledStart: null, scheduledEnd: null, startedAt: null, completedAt: null, cashAmount: null });
  assert.deepEqual(cancelled.map((s) => s.state), ['done', 'done', 'stop']);
  assert.equal(cancelled[2]?.label, 'Cancelled');
  const lost = timeline({ kind: 'not_chosen', interestAt: at(24, 9), quoteAt: at(24, 10), quoteTotal: 3000, scheduledStart: at(25, 11), scheduledEnd: at(25, 13), startedAt: null, completedAt: null, cashAmount: null });
  assert.equal(lost.at(-1)?.label, 'Rejected');
  const disputed = timeline({ kind: 'disputed', interestAt: at(24, 9), quoteAt: at(24, 10), quoteTotal: 3200, scheduledStart: at(24, 11), scheduledEnd: at(24, 13), startedAt: at(24, 11, 8), completedAt: at(24, 12, 20), cashAmount: null });
  assert.equal(disputed.length, 6);
  assert.equal(disputed.at(-1)?.state, 'stop');
  const interestOnly = timeline({ kind: 'expired', interestAt: at(24, 9), quoteAt: null, quoteTotal: null, scheduledStart: null, scheduledEnd: null, startedAt: null, completedAt: null, cashAmount: null });
  assert.deepEqual(interestOnly.map((s) => s.state), ['done', 'stop']);
});

test('the note card uses the corrected wording and reveals the address only after acceptance', () => {
  const sched = noteFor(base, 'scheduled', now);
  assert.equal(sched.headline, 'Visit today, 11 AM to 1 PM');
  assert.equal(sched.body, 'Phase 6, Lane 7, House 118-C. The customer chose this time. Running late? Call the customer and tell them when you will arrive. Tap Start job when you arrive.');
  // A job with no fixed time (ASAP) tells the worker to agree one by phone; the app offers no way to set it.
  const noTime = noteFor(j({ ...base, scheduledStart: null, scheduledEnd: null }), 'scheduled', now);
  assert.equal(noTime.headline, 'Visit time to be confirmed');
  assert.match(noTime.body, /Call the customer to agree when you will come\./);
  const quoted = noteFor(j({ status: 'quoted', isMine: false, myQuoteStatus: 'sent', residentName: null }), 'quoted', now);
  assert.ok(!/call/i.test(quoted.body) && !/she|he /.test(quoted.body), 'no call advice and no gendered pronoun');
  assert.ok(/change your quote once/i.test(noteFor(j({ status: 'quoted', isMine: false, myQuoteStatus: 'sent', residentName: null }), 'quoted', now, true).body), 'while a change is still possible the note says so');
  assert.ok(!/cannot be edited/i.test(noteFor(j({ status: 'quoted', isMine: false, myQuoteStatus: 'sent', residentName: null }), 'quoted', now, true).body));
  assert.ok(/cannot be changed again/i.test(quoted.body), 'after the one change it says it is final');
  assert.ok(!/call the customer/i.test(noteFor(base, 'interested', now).headline + noteFor(base, 'interested', now).body));
  assert.equal(noteFor(base, 'completed', now).body, 'Enter the amount Hira F. paid you in cash. This closes the job.');
  assert.equal(noteFor(j({ residentName: null }), 'cash_collected', now).body.startsWith('The customer will rate'), true);
  const interested = noteFor(j({ status: 'interested', isMine: null, myQuoteStatus: null, plotNo: null, residentName: null }), 'interested', now);
  assert.ok(!interested.body.includes('118'), 'no plot number before acceptance');
});

test('names, initials and phone numbers', () => {
  assert.equal(shortName('Hira Farooq'), 'Hira F.');
  assert.equal(shortName('Madonna'), 'Madonna');
  assert.equal(shortName(null), '');
  assert.equal(initials('Hira Farooq'), 'HF');
  assert.equal(dialable('+92 321 555-0148'), '+923215550148');
  assert.equal(dialable('0321 5550148'), '03215550148');
  assert.equal(dialable('abc'), null);
  assert.equal(dialable(null), null);
  assert.equal(dialable('123'), null);
});

test('after the worker records the cash the job waits for the customer', () => {
  assert.equal(primaryAction('completed', true), 'waiting');
  assert.equal(primaryAction('completed', false), 'record_cash');
  const note = noteFor(j({ status: 'completed', isMine: true, cashRecorded: true }), 'completed');
  assert.equal(note.headline, 'Cash recorded');
  assert.match(note.body, /Waiting for Hira F\. to confirm/);
});

test('the customer can be called from acceptance on, in every later stage, and never before (16 Nov)', () => {
  for (const kind of ['scheduled', 'in_progress', 'completed', 'cash_collected', 'reviewed', 'disputed'] as const) assert.equal(canCall(kind), true, kind);
  for (const kind of ['interested', 'quoted', 'cancelled', 'expired', 'not_chosen'] as const) assert.equal(canCall(kind), false, kind);
});

test('a requote (change quote) is offered for a sent quote that was never changed, and only then', () => {
  assert.equal(primaryAction('quoted', false, true), 'change_quote');
  assert.equal(primaryAction('quoted', false, false), 'waiting');
  assert.equal(primaryAction('scheduled', false, true), 'start');
  assert.equal(primaryAction('interested', false, true), 'create_quote');
});
