import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkBadge, compareRows, filterByCheck, paidAtText, parseCheckFilter, parseScreenCheck, reasonText, REASONS, type PaymentFacts, type Reason } from './screenCheck.ts';

const P: PaymentFacts = { amount: 200, reference: 'TX-AAA-1111', method: 'jazzcash', createdAt: '2026-11-24T08:00:00Z' };
const READ = { app: 'jazzcash', amount: 200, transaction_id: 'TX-AAA-1111', paid_at: '2026-11-24', receiver_name: 'DHA Works', receiver_account: '03001234567', status: 'success' };
const raw = (over: Record<string, unknown> = {}, reasons: string[] = [], verdict = 'matches') => ({ verdict, reasons, extracted: { ...READ, ...over }, owed: 200, engine: 'test', checked_at: '2026-11-24T08:01:00Z' });
const check = (over: Record<string, unknown> = {}, reasons: string[] = [], verdict = 'matches') => {
  const c = parseScreenCheck(raw(over, reasons, verdict));
  assert.ok(c);
  return c;
};

test('a stored check is read with what the screenshot showed', () => {
  const c = check();
  assert.equal(c.verdict, 'matches');
  assert.deepEqual(c.reasons, []);
  assert.equal(c.read.amount, 200);
  assert.equal(c.read.transactionId, 'TX-AAA-1111');
  assert.equal(c.read.receiverName, 'DHA Works');
  assert.equal(c.owed, 200);
  assert.equal(c.engine, 'test');
});

test('no check, or one that does not look right, is "not checked yet"', () => {
  assert.equal(parseScreenCheck(null), null);
  assert.equal(parseScreenCheck(undefined), null);
  assert.equal(parseScreenCheck('matches'), null);
  assert.equal(parseScreenCheck({ verdict: 'approved', reasons: [] }), null, 'a verdict the database never gives');
  assert.deepEqual(checkBadge(null), { tone: 'gray', label: 'Not checked yet' });
});

test('an unknown reason code is dropped, not shown as a raw word', () => {
  assert.deepEqual(check({}, ['amount_mismatch', 'something_new'], 'flagged').reasons, ['amount_mismatch']);
});

test('numbers that arrive as text are still numbers, and bad ones are nothing', () => {
  assert.equal(check({ amount: '200.00' }).read.amount, 200);
  assert.equal(check({ amount: 'lots' }).read.amount, null);
  assert.equal(check({ amount: null }).read.amount, null);
});

test('the badge', () => {
  assert.deepEqual(checkBadge(check()), { tone: 'ok', label: 'Screenshot matches' });
  assert.deepEqual(checkBadge(check({}, ['nothing_readable'], 'unreadable')), { tone: 'gray', label: 'Could not read' });
  assert.deepEqual(checkBadge(check({}, ['amount_unreadable'], 'flagged')), { tone: 'wait', label: 'Needs a closer look' }, 'a thing it could not confirm is yellow');
  assert.deepEqual(checkBadge(check({}, ['amount_less_than_owed'], 'flagged')), { tone: 'wait', label: 'Needs a closer look' }, 'a part payment is yellow');
  for (const r of ['amount_mismatch', 'txn_mismatch', 'txn_reused', 'receiver_unknown', 'status_not_success', 'date_future']) {
    assert.equal(checkBadge(check({}, [r], 'flagged')).tone, 'red', `${r} is red`);
  }
  assert.equal(checkBadge(check({}, ['amount_unreadable', 'amount_mismatch'], 'flagged')).tone, 'red', 'one red reason makes it red');
});

test('the amount mismatch names both numbers', () => {
  const c = check({ amount: 2000 }, ['amount_mismatch'], 'flagged');
  assert.equal(reasonText('amount_mismatch', c, P), 'Amount does not match: the screenshot shows Rs 2,000, the worker typed Rs 200.');
  assert.equal(reasonText('amount_mismatch', check({ amount: null }, ['amount_mismatch'], 'flagged'), P), 'Amount does not match: the screenshot shows not read, the worker typed Rs 200.');
});

test('part payments and over-payments say what is owed', () => {
  const part = check({ amount: 150 }, ['amount_less_than_owed'], 'flagged');
  assert.equal(reasonText('amount_less_than_owed', part, { ...P, amount: 150 }), 'Less than owed: Rs 150 typed, Rs 200 owed. It is a part payment.');
  assert.equal(reasonText('amount_more_than_owed', check({ amount: 500 }, [], 'flagged'), { ...P, amount: 500 }), 'More than owed: Rs 500 typed, Rs 200 owed.');
});

test('every reason has its own sentence', () => {
  const c = check({}, [], 'flagged');
  const seen = new Set<string>();
  for (const r of REASONS) {
    const t = reasonText(r as Reason, c, P);
    assert.ok(t.length > 10 && t.endsWith('.'), `${r} reads as a sentence`);
    assert.ok(!seen.has(t), `${r} has text of its own`);
    seen.add(t);
  }
});

test('the side-by-side rows for a payment that matches', () => {
  const rows = compareRows(check(), P);
  assert.deepEqual(rows.map((r) => r.label), ['Amount', 'Transaction ID', 'Sent to', 'Status', 'Date', 'Paid with']);
  assert.ok(rows.every((r) => r.state === 'same'), 'all six agree');
  assert.deepEqual([rows[0]?.typed, rows[0]?.read], ['Rs 200', 'Rs 200']);
  assert.equal(rows[2]?.read, 'DHA Works / 03001234567');
  assert.equal(rows[4]?.read, '24 Nov 2026');
});

test('a different amount, transaction ID and receiver are marked different', () => {
  const rows = compareRows(check({ amount: 2000, transaction_id: 'TX-ZZZ-9', receiver_name: 'Somebody Else' }, ['amount_mismatch', 'txn_mismatch', 'receiver_unknown'], 'flagged'), P);
  assert.deepEqual(rows.map((r) => r.state), ['different', 'different', 'different', 'same', 'same', 'same']);
  assert.deepEqual([rows[0]?.typed, rows[0]?.read], ['Rs 200', 'Rs 2,000']);
});

test('the transaction ID ignores case, spaces and dashes like the database does', () => {
  assert.equal(compareRows(check({ transaction_id: 'tx aaa 1111' }), P)[1]?.state, 'same');
  assert.equal(compareRows(check({ transaction_id: 'TX-AAA-1111' }, ['txn_reused'], 'flagged'), P)[1]?.state, 'different', 'an ID that was reused is not "same"');
});

test('what could not be read is marked "not read", never "same"', () => {
  const rows = compareRows(check({ amount: null, transaction_id: null, receiver_name: null, receiver_account: null, status: null, paid_at: null, app: null }, ['nothing_readable'], 'unreadable'), P);
  assert.ok(rows.every((r) => r.state === 'unknown'));
  assert.ok(rows.every((r) => r.read === 'Not read'));
});

test('status, date and app rows follow the reasons', () => {
  const rows = compareRows(check({ status: 'failed', app: 'easypaisa', paid_at: '2026-11-10T09:05' }, ['status_not_success', 'date_old', 'method_mismatch'], 'flagged'), P);
  assert.deepEqual([rows[3]?.read, rows[3]?.state], ['Failed', 'different']);
  assert.deepEqual([rows[4]?.read, rows[4]?.state], ['10 Nov 2026, 09:05', 'different']);
  assert.deepEqual([rows[5]?.read, rows[5]?.state], ['Easypaisa', 'different']);
  assert.equal(compareRows(check({ app: 'other' }), P)[5]?.state, 'unknown', 'an app that was not recognised is not held against the worker');
});

test('the date text', () => {
  assert.equal(paidAtText('2026-11-24'), '24 Nov 2026');
  assert.equal(paidAtText('2026-01-05T14:30'), '5 Jan 2026, 14:30');
  assert.equal(paidAtText('2026-13-05'), '2026-13-05', 'a month that does not exist is shown as it came');
  assert.equal(paidAtText('yesterday'), 'yesterday');
  assert.equal(paidAtText(null), 'Not read');
});

test('the queue filter', () => {
  assert.equal(parseCheckFilter('matches'), 'matches');
  assert.equal(parseCheckFilter('attention'), 'attention');
  assert.equal(parseCheckFilter('weird'), 'all');
  assert.equal(parseCheckFilter(undefined), 'all');
  const items = [
    { id: 'a', check: check() },
    { id: 'b', check: check({}, ['amount_mismatch'], 'flagged') },
    { id: 'c', check: check({}, ['nothing_readable'], 'unreadable') },
    { id: 'd', check: null },
  ];
  assert.deepEqual(filterByCheck(items, 'all').map((i) => i.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(filterByCheck(items, 'matches').map((i) => i.id), ['a']);
  assert.deepEqual(filterByCheck(items, 'attention').map((i) => i.id), ['b', 'c', 'd'], 'anything not matched, including not checked yet');
});
