import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deviceKind,
  parseRequests,
  parseSessions,
  sendDocumentUpdate,
  sendSupport,
  signOutOtherPhones,
  supportState,
  type DocumentUpdateClient,
  type SupportClient,
} from './requests.ts';

const USER = '11111111-1111-4111-8111-111111111111';

// ---- support
test('a message needs a title of 3 to 80 and a body of 5 to 1000 characters', () => {
  assert.equal(supportState({ subject: 'ab', body: 'long enough' }).canSend, false);
  assert.equal(supportState({ subject: 'abc', body: 'abcd' }).canSend, false);
  assert.equal(supportState({ subject: 'abc', body: 'abcde' }).canSend, true);
  assert.equal(supportState({ subject: 'a'.repeat(81), body: 'abcde' }).subjectOk, false);
  assert.equal(supportState({ subject: 'abc', body: 'a'.repeat(1001) }).bodyOk, false);
  assert.equal(supportState({ subject: '   abc   ', body: '  abcde  ' }).canSend, true);
});

test('support: bad input stays local; good input is trimmed and sent', async () => {
  const calls: string[][] = [];
  const c: SupportClient = { send: (s, b) => (calls.push([s, b]), Promise.resolve({ error: null })) };
  assert.deepEqual(await sendSupport(c, { subject: 'a', body: 'abcde' }), { ok: false, key: 'settings.supportScreen.errTitle' });
  assert.deepEqual(await sendSupport(c, { subject: 'abc', body: 'a' }), { ok: false, key: 'settings.supportScreen.errBody' });
  assert.deepEqual(calls, []);
  assert.deepEqual(await sendSupport(c, { subject: ' Phase ', body: ' wrong phase ' }), { ok: true });
  assert.deepEqual(calls, [['Phase', 'wrong phase']]);
});

test('support: the server limits and a network failure get their own words', async () => {
  const fail = (message: string): SupportClient => ({ send: () => Promise.resolve({ error: { message } }) });
  assert.deepEqual(await sendSupport(fail('you already have 3 open messages; wait for DHA to answer'), { subject: 'abc', body: 'abcde' }), { ok: false, key: 'settings.supportScreen.errOpen' });
  assert.deepEqual(await sendSupport(fail('you sent 5 messages today; try again tomorrow'), { subject: 'abc', body: 'abcde' }), { ok: false, key: 'settings.supportScreen.errToday' });
  assert.deepEqual(await sendSupport(fail('something else'), { subject: 'abc', body: 'abcde' }), { ok: false, key: 'settings.errors.generic' });
  const down: SupportClient = { send: () => Promise.reject(new Error('x')) };
  assert.deepEqual(await sendSupport(down, { subject: 'abc', body: 'abcde' }), { ok: false, key: 'settings.errors.network' });
});

// ---- document update
function docClient(over: { upload?: unknown; submit?: unknown } = {}) {
  const calls: string[] = [];
  const c: DocumentUpdateClient = {
    upload: (bucket, path) => (calls.push(`upload:${bucket}:${path}`), Promise.resolve((over.upload as { error: null }) ?? { error: null })),
    submit: (type, path) => (calls.push(`submit:${type}:${path}`), Promise.resolve((over.submit as { error: null }) ?? { error: null })),
  };
  return { c, calls };
}
const bytes = new ArrayBuffer(3000);

test('a new document goes to the right bucket under an update- name, then is submitted', async () => {
  const a = docClient();
  assert.deepEqual(await sendDocumentUpdate(a.c, { userId: USER, type: 'police_cert', mime: 'application/pdf', bytes, now: 7, random: 'zz' }), { ok: true, path: `${USER}/update-police_cert-7-zz.pdf` });
  assert.deepEqual(a.calls, [`upload:identity:${USER}/update-police_cert-7-zz.pdf`, `submit:police_cert:${USER}/update-police_cert-7-zz.pdf`]);
  const b = docClient();
  await sendDocumentUpdate(b.c, { userId: USER, type: 'profile_photo', mime: 'image/jpeg', bytes, now: 1, random: 'a' });
  assert.equal(b.calls[0], `upload:worker-media:${USER}/update-profile_photo-1-a.jpg`);
});

test('a wrong file never leaves the phone; a PDF is only for the police certificate', async () => {
  const a = docClient();
  assert.deepEqual(await sendDocumentUpdate(a.c, { userId: USER, type: 'cnic_front', mime: 'application/pdf', bytes }), { ok: false, key: 'settings.errors.photoType' });
  assert.deepEqual(await sendDocumentUpdate(a.c, { userId: USER, type: 'cnic_back', mime: 'image/jpeg', bytes: new ArrayBuffer(6 * 1024 * 1024) }), { ok: false, key: 'settings.errors.photoSize' });
  assert.deepEqual(a.calls, []);
});

test('if the upload fails nothing is submitted; a refused submit is reported', async () => {
  const a = docClient({ upload: { error: { message: 'boom' } } });
  assert.deepEqual(await sendDocumentUpdate(a.c, { userId: USER, type: 'cnic_front', mime: 'image/jpeg', bytes }), { ok: false, key: 'settings.errors.generic' });
  assert.equal(a.calls.some((x) => x.startsWith('submit:')), false);
  const b = docClient({ submit: { error: { message: 'too many document updates today; try again tomorrow' } } });
  assert.deepEqual(await sendDocumentUpdate(b.c, { userId: USER, type: 'cnic_front', mime: 'image/jpeg', bytes }), { ok: false, key: 'settings.errors.docsLimit' });
});

// ---- lists
test('requests are parsed and malformed rows dropped', () => {
  const rows = parseRequests([
    { id: 'a', kind: 'support', status: 'done', subject: 'S', body: 'B', staff_reply: ' Fixed ', created_at: '2026-11-19T10:00:00Z', decided_at: '2026-11-19T11:00:00Z' },
    { id: 'b', kind: 'document', status: 'rejected', subject: 'cnic_front', doc_type: 'cnic_front', staff_reply: '   ', created_at: '2026-11-19T10:00:00Z' },
    { id: 'c', kind: 'weird', status: 'open', created_at: 'x' },
    { kind: 'support', status: 'open', created_at: 'x' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.reply, 'Fixed');
  assert.equal(rows[1]?.reply, null);
  assert.equal(rows[1]?.docType, 'cnic_front');
  assert.deepEqual(parseRequests(null), []);
});

test('phones: a plain word, never the raw user agent', () => {
  assert.equal(deviceKind('okhttp/4.12.0'), 'android');
  assert.equal(deviceKind('Dalvik/2.1.0 (Linux; U; Android 14)'), 'android');
  assert.equal(deviceKind('MyApp/1 CFNetwork/1494 Darwin/23'), 'iphone');
  assert.equal(deviceKind(null), 'other');
  const s = parseSessions([{ id: 's1', is_current: true, user_agent: 'okhttp/4', last_active: '2026-11-19T10:00:00Z' }, { id: 's2', user_agent: 'x' }, { nope: 1 }]);
  assert.deepEqual(s.map((x) => [x.id, x.current, x.label]), [['s1', true, 'android'], ['s2', false, 'other']]);
});

test('sign out the other phones: count back, errors mapped', async () => {
  assert.deepEqual(await signOutOtherPhones({ signOutOthers: () => Promise.resolve({ data: 2, error: null }) }, 'tok'), { ok: true, count: 2 });
  assert.deepEqual(await signOutOtherPhones({ signOutOthers: () => Promise.resolve({ data: null, error: { message: 'no' } }) }, null), { ok: false, key: 'settings.errors.generic' });
  assert.deepEqual(await signOutOtherPhones({ signOutOthers: () => Promise.reject(new Error('x')) }, null), { ok: false, key: 'settings.errors.network' });
});
