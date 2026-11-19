import assert from 'node:assert/strict';
import { test } from 'node:test';

import { saveProfessional, type ProfessionalClient } from './professional.ts';

const saved = { trades: [1, 2], years: 5, about: 'Old text' };

function client(failOn?: string | 'throw') {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const c: ProfessionalClient = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      if (failOn === 'throw') return Promise.reject(new Error('network'));
      return Promise.resolve({ error: failOn === fn ? { message: 'refused' } : null });
    },
  };
  return { c, calls };
}

test('only what changed is sent', async () => {
  const a = client();
  assert.deepEqual(await saveProfessional(a.c, saved, { trades: [1, 2], years: '5', about: 'New text' }), { ok: true, sent: 1 });
  assert.deepEqual(a.calls, [{ fn: 'update_worker_details', args: { p_about: 'New text' } }]);

  const b = client();
  assert.deepEqual(await saveProfessional(b.c, saved, { trades: [3], years: '7', about: 'Old text' }), { ok: true, sent: 2 });
  assert.deepEqual(b.calls, [
    { fn: 'update_worker_details', args: { p_experience_years: 7 } },
    { fn: 'set_my_categories', args: { p_category_ids: [3] } },
  ]);
});

test('nothing changed sends nothing', async () => {
  const a = client();
  assert.deepEqual(await saveProfessional(a.c, saved, { trades: [2, 1], years: '5', about: ' Old text ' }), { ok: true, sent: 0 });
  assert.deepEqual(a.calls, []);
});

test('clearing the about text sends an empty string, which the database reads as "clear it"', async () => {
  const a = client();
  await saveProfessional(a.c, saved, { trades: [1, 2], years: '5', about: '   ' });
  assert.deepEqual(a.calls, [{ fn: 'update_worker_details', args: { p_about: '' } }]);
});

test('bad input never reaches the server', async () => {
  const a = client();
  assert.deepEqual(await saveProfessional(a.c, saved, { trades: [1, 2], years: '99', about: 'x' }), { ok: false, key: 'settings.errors.years' });
  assert.deepEqual(await saveProfessional(a.c, saved, { trades: [], years: '5', about: 'x' }), { ok: false, key: 'settings.errors.trade' });
  assert.deepEqual(a.calls, []);
});

test('a refusal or a network failure is reported, not thrown', async () => {
  const draft = { trades: [3], years: '7', about: 'Old text' };
  assert.deepEqual(await saveProfessional(client('update_worker_details').c, saved, draft), { ok: false, key: 'settings.errors.generic' });
  assert.deepEqual(await saveProfessional(client('set_my_categories').c, saved, draft), { ok: false, key: 'settings.errors.generic' });
  assert.deepEqual(await saveProfessional(client('throw').c, saved, draft), { ok: false, key: 'settings.errors.network' });
});

test('if the details fail, the skills are not touched', async () => {
  const a = client('update_worker_details');
  await saveProfessional(a.c, saved, { trades: [3], years: '7', about: 'Old text' });
  assert.deepEqual(a.calls.map((x) => x.fn), ['update_worker_details']);
});
