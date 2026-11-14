import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSuspendDays } from './rules.ts';

test('an empty days box means "until staff lift it"', () => {
  assert.deepEqual(checkSuspendDays(''), { ok: true, days: null });
  assert.deepEqual(checkSuspendDays('   '), { ok: true, days: null });
});

test('a whole number of days from 1 to 365 is accepted', () => {
  assert.deepEqual(checkSuspendDays('1'), { ok: true, days: 1 });
  assert.deepEqual(checkSuspendDays(' 7 '), { ok: true, days: 7 });
  assert.deepEqual(checkSuspendDays('365'), { ok: true, days: 365 });
});

test('zero, too many, decimals, signs and words are refused with a hint', () => {
  for (const bad of ['0', '366', '999', '1.5', '-3', '+3', 'seven', '7 days', '1e2', '0x10', '1000']) {
    const r = checkSuspendDays(bad);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.match(r.hint, /1 to 365|whole number/);
  }
});
