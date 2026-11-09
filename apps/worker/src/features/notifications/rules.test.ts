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
