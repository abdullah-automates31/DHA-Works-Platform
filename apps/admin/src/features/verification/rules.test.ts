import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bucketFor, canSubmit, CHECKLIST, DECISIONS, documentsChip, emptyChecks, initials, isDecision, normaliseChecks, parsePositiveInt,
  parseTab, phasesText, phoneText, showsWaiting, statusChip, waitingText,
} from './rules.ts';

const now = new Date('2026-11-07T12:00:00Z');
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

test('tabs: unknown values fall back to pending, and each role has its own tabs', () => {
  assert.equal(parseTab('worker', 'visit_hq'), 'visit_hq');
  assert.equal(parseTab('worker', 'needs_changes'), 'pending'); // a resident-only tab
  assert.equal(parseTab('resident', 'needs_changes'), 'needs_changes');
  for (const bad of [undefined, null, '', 'PENDING', '../x', 'approved; drop', ['approved']]) assert.equal(parseTab('worker', bad), 'pending');
});

test('page numbers from the address bar are safe', () => {
  assert.equal(parsePositiveInt('3', 1), 3);
  for (const bad of [undefined, '', '0', '-1', '1.5', 'abc', '9999999', ' 2', '2e3', ['2']]) assert.equal(parsePositiveInt(bad, 1), 1, String(bad));
});

test('waiting time reads like the design', () => {
  assert.equal(waitingText(ago(0.2), now), 'under 1 h');
  assert.equal(waitingText(ago(20), now), '20 h');
  assert.equal(waitingText(ago(47), now), '47 h');
  assert.equal(waitingText(ago(72), now), '3 d');
  assert.equal(waitingText('not a date', now), 'just now');
  assert.equal(waitingText(ago(-5), now), 'just now');
});

test('the waiting column is shown for open applications, not for decided ones', () => {
  for (const tab of ['pending', 'visit_hq', 'needs_changes'] as const) assert.equal(showsWaiting(tab), true, tab);
  for (const tab of ['approved', 'rejected'] as const) assert.equal(showsWaiting(tab), false, tab);
});

test('names, phases and phones are formatted', () => {
  assert.equal(initials('Ali Raza'), 'AR');
  assert.equal(initials('  maryam   bibi   siddiqui '), 'MS');
  assert.equal(initials('Madonna'), 'M');
  assert.equal(initials('Ali Raza [FAKE]'), 'AR');
  assert.equal(initials('[FAKE] ###'), '?');
  assert.equal(initials('  '), '?');
  assert.equal(initials(''), '?');
  assert.equal(initials(null), '?');
  assert.equal(phasesText([5, 6]), 'Phase 5, 6');
  assert.equal(phasesText([]), 'None');
  assert.equal(phoneText('03215550114'), '0321 555 0114');
  assert.equal(phoneText('+923215550114'), '+923215550114');
  assert.equal(phoneText(null), 'No phone');
});

test('documents chip: full set, references instead of a certificate, and what is missing', () => {
  const full = ['cnic_front', 'cnic_back', 'police_cert', 'profile_photo'];
  assert.deepEqual(documentsChip('worker', full, 0), { label: 'All uploaded', tone: 'ok' });
  assert.deepEqual(documentsChip('worker', ['cnic_front', 'cnic_back', 'profile_photo'], 2), { label: 'References, no certificate', tone: 'wait' });
  assert.deepEqual(documentsChip('worker', ['cnic_front', 'cnic_back', 'profile_photo'], 1), { label: 'No certificate, fewer than 2 references', tone: 'red' });
  assert.deepEqual(documentsChip('worker', ['cnic_front', 'police_cert'], 0), { label: 'Missing: CNIC, photo', tone: 'red' });
  assert.deepEqual(documentsChip('resident', ['cnic_front', 'cnic_back', 'utility_bill'], 0), { label: 'All uploaded', tone: 'ok' });
  assert.deepEqual(documentsChip('resident', ['cnic_front', 'cnic_back'], 0), { label: 'Missing: utility bill', tone: 'red' });
});

test('buckets: ID documents are in identity, photo and voice in worker-media', () => {
  for (const d of ['cnic_front', 'cnic_back', 'utility_bill', 'police_cert'] as const) assert.equal(bucketFor(d), 'identity');
  assert.equal(bucketFor('profile_photo'), 'worker-media');
  assert.equal(bucketFor('voice'), 'worker-media');
});

test('every role has four checklist items and three decisions, with approve first and reject last', () => {
  for (const role of ['worker', 'resident'] as const) {
    assert.equal(CHECKLIST[role].length, 4);
    assert.deepEqual(DECISIONS[role].map((d) => d.key)[0], 'approve');
    assert.equal(DECISIONS[role].at(-1)?.key, 'reject');
    assert.equal(DECISIONS[role].at(-1)?.tone, 'stop');
  }
  assert.ok(DECISIONS.worker.some((d) => d.key === 'visit_hq'));
  assert.ok(DECISIONS.resident.some((d) => d.key === 'ask_for_changes'));
  assert.equal(isDecision('worker', 'ask_for_changes'), false);
  assert.equal(isDecision('resident', 'visit_hq'), false);
  assert.equal(isDecision('resident', 'DROP'), false);
});

test('approve needs every item ticked; every other decision needs a reason of 3 to 500 characters', () => {
  const none = emptyChecks('worker');
  const all = Object.fromEntries(Object.keys(none).map((k) => [k, true]));
  assert.equal(canSubmit('worker', 'approve', none, '').ok, false);
  assert.equal(canSubmit('worker', 'approve', { ...all, voice: false }, '').ok, false);
  assert.equal(canSubmit('worker', 'approve', all, '').ok, true);
  assert.equal(canSubmit('worker', 'reject', none, '').ok, false);
  assert.equal(canSubmit('worker', 'reject', none, '  ab ').ok, false);
  assert.equal(canSubmit('worker', 'reject', none, 'CNIC is blurry').ok, true);
  assert.equal(canSubmit('worker', 'visit_hq', none, 'x'.repeat(501)).ok, false);
  assert.equal(canSubmit('worker', 'visit_hq', none, 'x'.repeat(500)).ok, true);
  assert.equal(canSubmit('worker', 'ask_for_changes' as never, none, 'a reason').ok, false); // not a worker decision
});

test('the checklist sent to the database holds exactly this role keys, as booleans', () => {
  assert.deepEqual(normaliseChecks('worker', { cnic: true, photo: 'yes', police: 1, voice: true, extra: true }), { cnic: true, photo: false, police: false, voice: true });
  assert.deepEqual(normaliseChecks('resident', null), emptyChecks('resident'));
  assert.deepEqual(normaliseChecks('resident', 'nope'), emptyChecks('resident'));
});

test('status chips', () => {
  assert.deepEqual(statusChip('pending'), { label: 'Pending review', tone: 'wait' });
  assert.equal(statusChip('approved').tone, 'ok');
  assert.equal(statusChip('rejected').tone, 'red');
  assert.equal(statusChip('visit_hq').tone, 'blue');
});
