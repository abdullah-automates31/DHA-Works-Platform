import assert from 'node:assert/strict';
import { test } from 'node:test';

import { methodLabel, parseCounts, parseDuesList, parseRupees, parseTab, parseWorkerDues, whenText } from './parse.ts';

const A = '00000000-0000-0000-0000-0000000000a1';
const B = '00000000-0000-0000-0000-0000000000b1';
const NOW = new Date('2026-11-22T10:00:00Z');
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

test('the tab comes from the address; anything else is "owing"', () => {
  assert.equal(parseTab('pending'), 'pending');
  assert.equal(parseTab('suspended'), 'suspended');
  assert.equal(parseTab('weird'), 'owing');
  assert.equal(parseTab(undefined), 'owing');
});

test('the sidebar counts', () => {
  assert.deepEqual(parseCounts({ pending: 3, overdue_workers: 2 }), { pending: 3, overdueWorkers: 2 });
  assert.deepEqual(parseCounts(null), { pending: 0, overdueWorkers: 0 });
});

test('the list is read with its totals and the queue of payments to check', () => {
  const l = parseDuesList({
    total: 1,
    rows: [{ id: A, name: 'Usman One', phone: '03003334444', account_status: 'suspended', owed: 550, overdue: 50, next_due_at: hours(24), overdue_since: hours(-24), pending_count: 2, pending_total: 60, paid_total: 200 }, { id: 'x' }],
    totals: { owed: 550, overdue: 50, pending: 2, collected_this_month: 1200 },
    pending_payments: [{ id: B, worker_id: A, worker_name: 'Usman One', amount: 40, method: 'bank', reference: 'TX-1', created_at: hours(-2) }, { id: 'bad' }],
    pay_to: '  JazzCash 0300  ',
  });
  assert.equal(l.total, 1);
  assert.equal(l.rows.length, 1, 'a row without a proper id is dropped');
  assert.deepEqual([l.rows[0]?.name, l.rows[0]?.suspended, l.rows[0]?.owed, l.rows[0]?.overdue, l.rows[0]?.pendingCount], ['Usman One', true, 550, 50, 2]);
  assert.deepEqual(l.totals, { owed: 550, overdue: 50, pending: 2, collectedThisMonth: 1200 });
  assert.equal(l.pending.length, 1);
  assert.equal(l.pending[0]?.reference, 'TX-1');
  assert.equal(l.payTo, 'JazzCash 0300');
  assert.deepEqual(parseDuesList(null), { total: 0, rows: [], totals: { owed: 0, overdue: 0, pending: 0, collectedThisMonth: 0 }, pending: [], payTo: '' });
});

test("one worker's ledger", () => {
  const w = parseWorkerDues({
    worker: { account_status: 'active' },
    summary: { owed: 350, overdue: 0, next_due_at: hours(48), overdue_since: null, paid_total: 200, pending_total: 0, pending_count: 0, credit: 0 },
    dues: [
      { id: A, job_id: B, job_code: 'DW-2101', job_title: 'Kitchen tap', amount: 200, paid: 200, remaining: 0, accrued_at: hours(-72), due_at: hours(48), status: 'paid' },
      { id: B, amount: 5, status: 'odd' },
    ],
    payments: [
      { id: B, amount: 150, method: 'office_cash', reference: null, note: 'paid at the office', status: 'confirmed', created_at: hours(-5), decided_at: hours(-5), reason: null, by_staff: true, created_by_name: 'Staff One', decided_by_name: 'Staff One' },
    ],
  });
  assert.ok(w);
  assert.equal(w.summary.owed, 350);
  assert.equal(w.suspended, false);
  assert.deepEqual(w.dues.map((d) => [d.jobCode, d.status, d.remaining]), [['DW-2101', 'paid', 0]]);
  assert.equal(w.payments[0]?.byStaff, true);
  assert.equal(w.payments[0]?.decidedBy, 'Staff One');
  assert.equal(parseWorkerDues({ summary: {} })?.dues.length, 0);
  assert.equal(parseWorkerDues(null), null);
  assert.equal(parseWorkerDues({ worker: { account_status: 'suspended' }, summary: {} })?.suspended, true);
});

test('rupees typed by staff', () => {
  assert.equal(parseRupees('1,250'), 1250);
  assert.equal(parseRupees('Rs 150'), 150);
  assert.equal(parseRupees('  40 '), 40);
  assert.equal(parseRupees('0'), null);
  assert.equal(parseRupees('12.5'), null);
  assert.equal(parseRupees('10000001'), null);
  assert.equal(parseRupees(''), null);
  assert.equal(parseRupees(5), null);
});

test('how far away a due date is', () => {
  assert.equal(whenText(hours(72), NOW), 'in 3 days');
  assert.equal(whenText(hours(24), NOW), 'in 1 day');
  assert.equal(whenText(hours(5), NOW), 'in 5 hours');
  assert.equal(whenText(hours(-48), NOW), '2 days ago');
  assert.equal(whenText(hours(-0.2), NOW), 'just now');
  assert.equal(whenText(hours(0.2), NOW), 'in under an hour');
  assert.equal(whenText(null, NOW), '-');
});

test('payment methods read plainly', () => {
  assert.equal(methodLabel('jazzcash'), 'JazzCash');
  assert.equal(methodLabel('office_cash'), 'Cash at the office');
  assert.equal(methodLabel('cheque'), 'cheque');
});
