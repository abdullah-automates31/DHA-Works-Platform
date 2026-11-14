import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describe, groupNotices, opensDetail, unreadIds, type Notice } from './rules.ts';

const now = new Date(2026, 9, 30, 15, 0);
const at = (h: number, day = 30) => new Date(2026, 9, day, h, 0).toISOString();
const n = (patch: Partial<Notice>): Notice => ({ id: 'n1', type: 'quote_accepted', jobId: 'j1', payload: { title: 'Bathroom flush tank leak' }, readAt: null, createdAt: at(14), ...patch });

test('quote accepted names the job and the visit, never the resident', () => {
  const v = describe(n({ payload: { title: 'Bathroom flush tank leak', start: new Date(2026, 9, 31, 11, 0).toISOString() } }), now);
  assert.equal(v.title, 'Quote accepted');
  assert.equal(v.body, 'Your quote for Bathroom flush tank leak was accepted. Visit tomorrow, 11 AM.');
  assert.equal(v.opensJob, true);
});

test('each worker-facing type has its own words', () => {
  const title = (type: string) => describe(n({ type }), now).title;
  assert.equal(title('quote_not_selected'), 'Quote rejected');
  assert.equal(title('quote_rejected'), 'You are off this job');
  assert.equal(title('job_cancelled'), 'Job cancelled');
  // A cancelled job is invisible to the worker, so its notice says so plainly and opens nothing.
  const cancelled = describe(n({ type: 'job_cancelled' }), now);
  assert.equal(cancelled.body, "This job has been cancelled. Do not travel to the customer's address.");
  assert.equal(cancelled.opensJob, false);
  assert.equal(describe(n({ type: 'quote_rejected' }), now).opensJob, false);
  assert.equal(describe(n({ type: 'quote_not_selected' }), now).opensJob, false);
  assert.equal(title('job_expired'), 'Job expired');
  assert.equal(title('cash_collected'), 'Job closed');
  // A price difference never disputes a job (Shariq, 27 Oct): an old cash_disputed row must not claim a dispute.
  const legacy = describe(n({ type: 'cash_disputed' }), now);
  assert.equal(legacy.title, 'Cash update');
  assert.doesNotMatch(`${legacy.title} ${legacy.body}`, /differ|match|dispute|DHA staff/i);
  assert.equal(title('job_stuck'), 'Job needs an update');
  assert.equal(title('cancellation_requested'), 'Cancellation requested');
  assert.equal(describe(n({ type: 'verification_decided', jobId: null, payload: { decision: 'approve' } }), now).title, 'You are approved');
  assert.equal(describe(n({ type: 'verification_decided', jobId: null, payload: { decision: 'reject' } }), now).title, 'Application not approved');
  assert.equal(describe(n({ type: 'verification_decided', jobId: null, payload: { decision: 'visit_hq' } }), now).title, 'Please visit the DHA office');
  assert.equal(describe(n({ type: 'account_reactivated', jobId: null, payload: {} }), now).title, 'Account active again');
  const signIn = describe(n({ type: 'new_sign_in', jobId: null, payload: {} }), now);
  assert.equal(signIn.title, 'New sign-in');
  assert.equal(signIn.opensJob, false);
  assert.match(signIn.body, /sign out other devices/i);
  const warn = describe(n({ type: 'report_warning', jobId: null, payload: { message: 'Please be on time.' } }), now);
  assert.equal(warn.title, 'Warning from DHA staff');
  assert.equal(warn.body, 'Please be on time.');
  assert.equal(describe(n({ type: 'staff_message', jobId: null, payload: { text: 'Upload a new certificate.' } }), now).body, 'Upload a new certificate.');
  assert.match(describe(n({ type: 'cancellation_declined', payload: { title: 'Tap job', message: 'Please attend.' } }), now).body, /did not approve the cancellation of Tap job. Please attend./);
  assert.match(describe(n({ type: 'quote_not_selected' }), now).body, /The customer rejected your quote for Bathroom flush tank leak\. Find more jobs\./);
});

test('a missing title is replaced by a neutral phrase, an unknown type still shows something', () => {
  assert.equal(describe(n({ payload: null }), now).body, 'Your quote for your job was accepted.');
  const unknown = describe(n({ type: 'something_new', jobId: null, payload: null }), now);
  assert.equal(unknown.title, 'New update');
  assert.equal(unknown.opensJob, false);
});

test('notices are grouped Today and Earlier, newest first', () => {
  const groups = groupNotices([n({ id: 'a', createdAt: at(9) }), n({ id: 'b', createdAt: at(14) }), n({ id: 'c', createdAt: at(10, 28) })], now);
  assert.deepEqual(groups.map((g) => [g.key, g.items.map((i) => i.id)]), [['today', ['b', 'a']], ['earlier', ['c']]]);
  assert.deepEqual(groupNotices([], now), []);
  assert.deepEqual(groupNotices([n({ createdAt: at(10, 28) })], now).map((g) => g.key), ['earlier']);
});

test('unread ids drive Mark all read', () => {
  assert.deepEqual(unreadIds([n({ id: 'a' }), n({ id: 'b', readAt: at(10) })]), ['a']);
});

test('a worker taken off a job is told neutrally, with no reason and no customer detail', () => {
  const v = describe(n({ type: 'quote_rejected' }), now);
  assert.equal(v.body, "You are no longer on this job. Do not travel to the customer's address.");
  assert.doesNotMatch(v.body, /Bathroom|customer rejected|reason/i);
});

test('a new job notification opens the job detail where the worker can accept it', () => {
  const v = describe(n({ type: 'new_job', payload: { title: 'Tap leak', phase: 6 } }), now);
  assert.equal(v.title, 'New job');
  assert.match(v.body, /Phase 6: Tap leak/);
  assert.equal(v.opensJob, true);
  assert.equal(opensDetail(n({ type: 'new_job' })), true);
  assert.equal(opensDetail(n({ type: 'quote_accepted' })), false);
});

test('report tracking and suspension notices say what happened without naming anyone or the punishment', () => {
  const made = (type: string, payload: Record<string, unknown> | null) => describe(n({ type, jobId: null, payload }), now);
  const received = made('report_received', { code: 'RP-0412' });
  assert.equal(received.title, 'We received your report');
  assert.equal(received.opensReports, true);
  assert.equal(received.opensJob, false);
  assert.equal(made('report_in_review', { code: 'RP-0412' }).title, 'Your report is being reviewed');
  assert.equal(made('report_resolved', { code: 'RP-0412', outcome: 'action_taken' }).body, 'DHA reviewed your report and took action.');
  assert.equal(made('report_resolved', { code: 'RP-0412', outcome: 'no_action' }).body, 'DHA reviewed your report. No action was needed.');
  assert.equal(made('report_resolved', { code: 'RP-0412' }).body, 'DHA reviewed your report. No action was needed.');
  assert.equal(made('report_resolved', null).opensReports, true);
  const all = JSON.stringify([received, made('report_resolved', { outcome: 'action_taken' })]).toLowerCase();
  for (const word of ['suspend', 'warning']) assert.equal(all.includes(word), false, word);
});

test('a suspension notice carries the reason and, when there is one, the end date', () => {
  const made = (payload: Record<string, unknown> | null) => describe(n({ type: 'account_suspended', jobId: null, payload }), now);
  const until = new Date(2026, 10, 21, 10, 0).toISOString();
  assert.equal(made({ message: 'Rude behaviour', until }).title, 'Your account is suspended');
  assert.equal(made({ message: 'Rude behaviour', until }).body, 'Reason: Rude behaviour. It ends on 21 Nov 2026.');
  assert.equal(made({ message: 'Rude behaviour', until: null }).body, 'Reason: Rude behaviour. DHA staff will tell you when it ends.');
  assert.equal(made(null).body, 'DHA staff suspended your account. Contact DHA support.');
  assert.equal(made({ message: 'x', until }).icon, 'alert');
  assert.equal(made({ message: 'x', until }).opensJob, false);
});

test('"active again" says whether the suspension ended by itself', () => {
  const made = (payload: Record<string, unknown> | null) => describe(n({ type: 'account_reactivated', jobId: null, payload }), now);
  assert.equal(made({ expired: true }).body, 'Your suspension has ended. You can use the app again.');
  assert.equal(made({ expired: false }).body, 'DHA staff reactivated your account. You can use the app again.');
  assert.equal(made(null).body, 'DHA staff reactivated your account. You can use the app again.');
});

test('a verification decision tells the applicant what staff wrote, and old notices keep the general sentence', () => {
  const made = (payload: Record<string, unknown> | null) => describe(n({ type: 'verification_decided', jobId: null, payload }), now);
  assert.equal(made({ decision: 'ask_for_changes', reason: 'Utility bill must be less than 3 months old.' }).body, 'What to fix: Utility bill must be less than 3 months old.');
  assert.equal(made({ decision: 'ask_for_changes', reason: 'Utility bill must be less than 3 months old.' }).title, 'Changes needed');
  assert.equal(made({ decision: 'visit_hq', reason: 'Bring your original CNIC.' }).body, 'Visit the DHA office. Bring your original CNIC.');
  assert.equal(made({ decision: 'reject', reason: 'CNIC does not match.' }).body, 'Reason: CNIC does not match.');
  assert.equal(made({ decision: 'approve' }).title, 'You are approved');
  // a notice written before 0053 has no reason
  assert.match(made({ decision: 'ask_for_changes' }).body, /fix something in your application/);
  assert.match(made({ decision: 'reject' }).body, /could not approve/);
  assert.equal(made({ decision: 'ask_for_changes', reason: '   ' }).body, made({ decision: 'ask_for_changes' }).body);
});
