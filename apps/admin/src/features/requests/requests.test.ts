import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bucketForDoc, docLabel, parseCounts, parseRequests } from './parse.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const W = '22222222-2222-4222-8222-222222222222';

test('rows are parsed; unknown kinds, statuses and bad ids are dropped', () => {
  const { total, rows } = parseRequests({
    total: 4,
    rows: [
      { id: ID, worker_id: W, worker_name: 'Ali', worker_phone: '+923001234567', kind: 'support', status: 'open', subject: 'S', body: 'B', created_at: '2026-11-19T10:00:00Z' },
      { id: ID, worker_id: W, kind: 'hack', status: 'open', created_at: 'x' },
      { id: ID, worker_id: W, kind: 'support', status: 'weird', created_at: 'x' },
      { id: 'nope', worker_id: W, kind: 'support', status: 'open', created_at: 'x' },
    ],
  });
  assert.equal(total, 4);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.workerName, 'Ali');
  assert.equal(rows[0]?.reply, null);
});

test('nothing or junk gives empty results, not a crash', () => {
  assert.deepEqual(parseRequests(null), { total: 0, rows: [] });
  assert.deepEqual(parseCounts('x'), { open: 0, support: 0, document: 0, changes: 0 });
  assert.deepEqual(parseCounts({ open: 5, support: 2, document: 1, changes: 2 }), { open: 5, support: 2, document: 1, changes: 2 });
});

test('document labels and buckets', () => {
  assert.equal(docLabel('police_cert'), 'Police certificate');
  assert.equal(docLabel(null), 'Document');
  assert.equal(bucketForDoc('profile_photo'), 'worker-media');
  assert.equal(bucketForDoc('cnic_front'), 'identity');
  assert.equal(bucketForDoc('police_cert'), 'identity');
});
