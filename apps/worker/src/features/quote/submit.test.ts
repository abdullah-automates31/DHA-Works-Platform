import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSubmitArgs } from './rules.ts';
import { claimErrorKey, claimJob } from './submit.ts';

const args = buildSubmitArgs('job-1', { labour: '1500', withMaterials: false, items: [] }, { p_visit_start: '2026-11-10T05:00:00.000Z', p_visit_end: '2026-11-10T07:00:00.000Z' });

test('every database refusal maps to a friendly key', () => {
  const cases: [string, string][] = [
    ['the resident did not accept your quote on this job', 'quote.errors.rejected'],
    ['this job has expired', 'quote.errors.expired'],
    ['you have already changed this quote once', 'quote.errors.alreadyChanged'],
    ['the customer already decided on your quote', 'quote.errors.decided'],
    ['the visit must be in the future', 'quote.errors.visit'],
    ['choose when you will come', 'quote.errors.visit'],
    ['this job is not available', 'quote.errors.notAvailable'],
    ['your account is not approved yet', 'quote.errors.notAvailable'],
    ['your account is suspended', 'quote.errors.notAvailable'],
    ['enter a price', 'quote.errors.total'],
    ['amounts cannot be negative', 'quote.errors.total'],
    ['new row violates check constraint "quotes_total_positive"', 'quote.errors.total'],
    ['Network request failed', 'quote.errors.network'],
    ['something internal', 'quote.errors.generic'],
  ];
  for (const [message, key] of cases) assert.equal(claimErrorKey({ message }), key, message);
  assert.equal(claimErrorKey(null), 'quote.errors.generic');
  assert.equal(claimErrorKey({ name: 'TypeError', message: 'x' }), 'quote.errors.network');
});

test('an accepted job is reported as ok and the request is passed through unchanged', async () => {
  const seen: unknown[] = [];
  const client = {
    async acceptJob(a: typeof args) {
      seen.push(a);
      return { error: null };
    },
  };
  assert.deepEqual(await claimJob(client, args), { ok: true });
  assert.deepEqual(seen, [args]);
});

test('a worker who lost the race gets "not available", not an exception', async () => {
  const client = { acceptJob: async () => ({ error: { message: 'this job is not available' } }) };
  assert.deepEqual(await claimJob(client, args), { ok: false, key: 'quote.errors.notAvailable' });
});

test('a refusal is returned, not thrown', async () => {
  const client = { acceptJob: async () => ({ error: { message: 'this job has expired' } }) };
  assert.deepEqual(await claimJob(client, args), { ok: false, key: 'quote.errors.expired' });
});

test('a lost connection is a network message without its text', async () => {
  const client = {
    acceptJob: async () => {
      throw new TypeError('Network request failed');
    },
  };
  assert.deepEqual(await claimJob(client, args), { ok: false, key: 'quote.errors.network' });
});
