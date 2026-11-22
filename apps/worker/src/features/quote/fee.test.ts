import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dhaFee, NO_FEE, parseFeeRule, payout, percentText } from './fee.ts';

const rule = { percent: 20, min: 50 };

test('the fee is a percentage of labour with a minimum, and never more than the labour', () => {
  assert.equal(dhaFee(1000, rule), 200);
  assert.equal(dhaFee(300, rule), 60);
  assert.equal(dhaFee(240, rule), 50, '20% of 240 is 48: the minimum applies');
  assert.equal(dhaFee(100, rule), 50);
  assert.equal(dhaFee(30, rule), 30, 'the minimum is capped at the labour price');
});

test('no labour, no fee; no rule, no fee', () => {
  assert.equal(dhaFee(0, rule), 0);
  assert.equal(dhaFee(-5, rule), 0);
  assert.equal(dhaFee(Number.NaN, rule), 0);
  assert.equal(dhaFee(1000, NO_FEE), 0);
});

test('it rounds half up on whole rupees, exactly like the database', () => {
  assert.equal(dhaFee(1000, { percent: 12.5, min: 0 }), 125);
  assert.equal(dhaFee(15, { percent: 12.5, min: 0 }), 2, '1.875 rounds to 2');
  assert.equal(dhaFee(10, { percent: 5, min: 0 }), 1, '0.5 rounds up to 1');
  assert.equal(dhaFee(1, { percent: 20, min: 0 }), 0, '0.2 rounds to 0');
  assert.equal(dhaFee(9999999, { percent: 60, min: 0 }), 5999999);
});

test('the breakdown the worker sees: quote, pay to DHA, you get', () => {
  assert.deepEqual(payout(400, 100, { percent: 20, min: 50 }), { total: 500, fee: 80, youGet: 420, byMinimum: false });
  assert.deepEqual(payout(100, 0, rule), { total: 100, fee: 50, youGet: 50, byMinimum: true });
  assert.deepEqual(payout(0, 500, rule), { total: 500, fee: 0, youGet: 500, byMinimum: false });
  assert.deepEqual(payout(500, 0, NO_FEE), { total: 500, fee: 0, youGet: 500, byMinimum: false });
});

test('the rule is read from the two settings; odd values count as no fee', () => {
  assert.deepEqual(parseFeeRule([{ key: 'dha_fee_percent', value: 20 }, { key: 'dha_fee_min', value: 50 }]), rule);
  assert.deepEqual(parseFeeRule([{ key: 'dha_fee_percent', value: '12.5' }]), { percent: 12.5, min: 0 });
  assert.deepEqual(parseFeeRule([{ key: 'dha_fee_percent', value: 'x' }, { key: 'dha_fee_min', value: -3 }]), NO_FEE);
  assert.deepEqual(parseFeeRule(null), NO_FEE);
  assert.deepEqual(parseFeeRule([]), NO_FEE);
});

test('the percent reads naturally in a sentence', () => {
  assert.equal(percentText(20), '20');
  assert.equal(percentText(12.5), '12.5');
  assert.equal(percentText(7.04), '7');
});
