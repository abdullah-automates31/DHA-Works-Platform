import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canEditName,
  canResubmitDocuments,
  displayPhone,
  documentItems,
  parsePrefs,
  PREF_KEYS,
  personalState,
  professionalCanSave,
  professionalChanges,
  savePref,
  staffReason,
  versionText,
  type PrefClient,
} from './rules.ts';

// ---- personal information
test('the name is editable only while the application is open', () => {
  assert.equal(canEditName('incomplete'), true);
  assert.equal(canEditName('needs_changes'), true);
  for (const s of ['pending', 'approved', 'visit_hq', 'rejected'] as const) assert.equal(canEditName(s), false, s);
  assert.equal(canEditName(null), false);
});

test('an approved worker cannot change the name, even by typing in the field', () => {
  const s = personalState({ name: 'Usman Khan' }, { name: 'Someone Else', photoChosen: false }, 'approved');
  assert.deepEqual(s, { dirty: false, nameError: false, canSave: false });
});

test('a new photo is a change on its own, also after approval', () => {
  const s = personalState({ name: 'Usman Khan' }, { name: 'Usman Khan', photoChosen: true }, 'approved');
  assert.equal(s.canSave, true);
});

test('Save needs a real change and a valid name', () => {
  assert.equal(personalState({ name: 'Usman Khan' }, { name: '  Usman   Khan ', photoChosen: false }, 'incomplete').dirty, false);
  assert.equal(personalState({ name: 'Usman Khan' }, { name: 'Usman Ali', photoChosen: false }, 'incomplete').canSave, true);
  const bad = personalState({ name: 'Usman Khan' }, { name: '1234', photoChosen: false }, 'incomplete');
  assert.equal(bad.nameError, true);
  assert.equal(bad.canSave, false);
  assert.equal(personalState({ name: 'Usman Khan' }, { name: '   ', photoChosen: false }, 'incomplete').canSave, false);
});

// ---- professional details
const saved = { trades: [1, 2], years: 5, about: 'Fifteen years of wiring.' };

test('nothing changed: nothing to save', () => {
  const draft = { trades: [2, 1], years: '5', about: '  Fifteen years of wiring. ' };
  assert.equal(professionalCanSave(saved, draft), false);
});

test('each part is noticed on its own', () => {
  assert.equal(professionalChanges(saved, { trades: [1], years: '5', about: saved.about }).trades, true);
  assert.equal(professionalChanges(saved, { trades: [1, 2], years: '6', about: saved.about }).years, true);
  assert.equal(professionalChanges(saved, { trades: [1, 2], years: '5', about: 'New text' }).about, true);
});

test('years must be a whole number from 0 to 70; a blank leaves the saved value alone', () => {
  assert.equal(professionalChanges(saved, { trades: [1, 2], years: '71', about: saved.about }).yearsInvalid, true);
  assert.equal(professionalChanges(saved, { trades: [1, 2], years: '4.5', about: saved.about }).yearsInvalid, true);
  assert.equal(professionalCanSave(saved, { trades: [1, 2], years: '71', about: 'x' }), false);
  assert.equal(professionalChanges(saved, { trades: [1, 2], years: '', about: saved.about }).years, false);
});

test('at least one trade is required to save', () => {
  assert.equal(professionalCanSave(saved, { trades: [], years: '5', about: 'x' }), false);
});

// ---- verification and documents
const rows = [
  { doc_type: 'cnic_front', uploaded_at: '2026-11-01T10:00:00Z' },
  { doc_type: 'cnic_back', uploaded_at: '2026-11-02T10:00:00Z' },
  { doc_type: 'police_cert', uploaded_at: '2026-11-03T10:00:00Z' },
  { doc_type: 'profile_photo', uploaded_at: '2026-11-04T10:00:00Z' },
];
const statuses = (r: typeof rows, refs: number, s: Parameters<typeof documentItems>[2]) => documentItems(r, refs, s).map((d) => d.status);

test('nothing sent: every document says not submitted, with no date', () => {
  const items = documentItems([], 0, 'incomplete');
  assert.deepEqual(items.map((d) => d.status), ['not_submitted', 'not_submitted', 'not_submitted']);
  assert.deepEqual(items.map((d) => d.submittedAt), [null, null, null]);
});

test('a file takes the state of the application', () => {
  assert.deepEqual(statuses(rows, 0, 'incomplete'), ['uploaded', 'uploaded', 'uploaded']);
  assert.deepEqual(statuses(rows, 0, 'pending'), ['pending', 'pending', 'pending']);
  assert.deepEqual(statuses(rows, 0, 'visit_hq'), ['pending', 'pending', 'pending']);
  assert.deepEqual(statuses(rows, 0, 'approved'), ['approved', 'approved', 'approved']);
  assert.deepEqual(statuses(rows, 0, 'needs_changes'), ['changes_needed', 'changes_needed', 'changes_needed']);
  assert.deepEqual(statuses(rows, 0, 'rejected'), ['rejected', 'rejected', 'rejected']);
});

test('the CNIC needs both sides; the date is the latest upload', () => {
  const front = rows.filter((r) => r.doc_type === 'cnic_front');
  assert.equal(documentItems(front, 0, 'pending')[0]?.status, 'not_submitted');
  assert.equal(documentItems(rows, 0, 'pending')[0]?.submittedAt, '2026-11-02T10:00:00Z');
});

test('references stand in for the police certificate', () => {
  const noPolice = rows.filter((r) => r.doc_type !== 'police_cert');
  const items = documentItems(noPolice, 2, 'pending');
  assert.equal(items[1]?.status, 'pending');
  assert.equal(items[1]?.submittedAt, null);
  assert.equal(documentItems(noPolice, 0, 'pending')[1]?.status, 'not_submitted');
});

test('the staff reason shows only when staff wrote one for a decision that needs it', () => {
  assert.equal(staffReason('needs_changes', ' Photo is blurry '), 'Photo is blurry');
  assert.equal(staffReason('rejected', 'No match'), 'No match');
  assert.equal(staffReason('approved', 'old reason'), null);
  assert.equal(staffReason('needs_changes', '   '), null);
  assert.equal(staffReason('pending', 'x'), null);
});

test('documents can be sent again only while the application is open', () => {
  assert.equal(canResubmitDocuments('needs_changes'), true);
  assert.equal(canResubmitDocuments('incomplete'), true);
  for (const s of ['pending', 'approved', 'visit_hq', 'rejected'] as const) assert.equal(canResubmitDocuments(s), false, s);
});

// ---- notification preferences
test('a missing or empty row means every switch is on', () => {
  for (const row of [null, undefined, {}]) {
    const p = parsePrefs(row);
    assert.deepEqual(PREF_KEYS.map((k) => p[k]), [true, true, true, true, true]);
  }
});

test('only an explicit false turns a switch off', () => {
  const p = parsePrefs({ notify_new_jobs: false, notify_job_updates: true, job_reminders: false, notify_report_updates: null, notify_announcements: false });
  assert.deepEqual(p, { new_jobs: false, job_updates: true, job_reminders: false, report_updates: true, announcements: false });
});

function fakeClient(result: { error: unknown } | 'throw') {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: PrefClient = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      if (result === 'throw') return Promise.reject(new Error('network'));
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

test('reminders use their own function; the rest share the preference function', async () => {
  const a = fakeClient({ error: null });
  assert.equal(await savePref(a.client, 'job_reminders', false), true);
  assert.deepEqual(a.calls, [{ fn: 'set_job_reminders', args: { p_value: false } }]);
  const b = fakeClient({ error: null });
  assert.equal(await savePref(b.client, 'new_jobs', true), true);
  assert.deepEqual(b.calls, [{ fn: 'set_notification_preference', args: { p_key: 'new_jobs', p_value: true } }]);
});

test('a server refusal or a network failure is a failed save, never a thrown error', async () => {
  assert.equal(await savePref(fakeClient({ error: { message: 'no' } }).client, 'job_updates', false), false);
  assert.equal(await savePref(fakeClient('throw').client, 'announcements', false), false);
});

// ---- small display helpers
test('version text', () => {
  assert.deepEqual(versionText('1.2.0', 34), { version: '1.2.0', build: '34' });
  assert.deepEqual(versionText(null, null), { version: '0.0.0', build: null });
  assert.deepEqual(versionText('1.0.0', ' '), { version: '1.0.0', build: null });
});

test('phone display', () => {
  assert.equal(displayPhone('+923214567890'), '+92 321 4567890');
  assert.equal(displayPhone('03214567890'), '03214567890');
  assert.equal(displayPhone(null), '');
});
