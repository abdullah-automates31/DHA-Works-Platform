import assert from 'node:assert/strict';
import { test } from 'node:test';

import { workerDueCounts, METHODS, methodLabel, parseCounts, parseDuesList, parseRupees, parsePayAccounts, parseTab, parseWorkerDues, payAccountsFromForm, safeProofPath, whenText, lastPayments } from './parse.ts';

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

test('a screenshot path is only used if it is exactly worker id / dues / file', () => {
  const ok = `${A}/dues/1700000000000-abc123.jpg`;
  assert.equal(safeProofPath(ok), ok);
  assert.equal(safeProofPath(`${A}/dues/../identity/cnic.jpg`), null, 'no traversal');
  assert.equal(safeProofPath(`${A}/identity/cnic.jpg`), null, 'only the dues folder');
  assert.equal(safeProofPath(`${A}/dues/a/b.jpg`), null, 'no deeper folders');
  assert.equal(safeProofPath('/etc/passwd'), null);
  assert.equal(safeProofPath(null), null);
  assert.equal(safeProofPath(42), null);
});

test('the queue and the ledger carry the screenshot path, and an unsafe one is dropped', () => {
  const good = `${A}/dues/p1.jpg`;
  const l = parseDuesList({ total: 0, rows: [], pending_payments: [
    { id: B, worker_id: A, amount: 50, method: 'sadapay', reference: 'SP-1', proof_path: good, created_at: hours(-1) },
    { id: A, worker_id: A, amount: 50, method: 'other', reference: 'X-2', proof_path: '../../secret', created_at: hours(-1) },
  ] });
  assert.deepEqual(l.pending.map((p) => [p.method, p.proofPath]), [['sadapay', good], ['other', null]]);
  const w = parseWorkerDues({ summary: {}, payments: [{ id: B, amount: 50, method: 'bank', status: 'pending', proof_path: good }, { id: A, amount: 5, method: 'office_cash', status: 'confirmed' }] });
  assert.deepEqual(w?.payments.map((p) => p.proofPath), [good, null]);
});

test('every way to pay can be named and recorded', () => {
  assert.deepEqual([...METHODS], ['jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'other', 'office_cash']);
  assert.equal(methodLabel('sadapay'), 'SadaPay');
  assert.equal(methodLabel('nayapay'), 'NayaPay');
  assert.equal(methodLabel('other'), 'Other');
});

test('the saved accounts are read, and an entry that is not one is dropped', () => {
  const list = parsePayAccounts([
    { method: 'easypaisa', label: null, title: 'DHA Works', number: ' 0300 1234567 ' },
    { method: 'bank', label: 'HBL', title: 'DHA Works (Pvt) Ltd', number: 'PK36HABB0000001234567890' },
    { method: 'cheque', title: 'x', number: '123' },
    { method: 'jazzcash', title: 'x', number: '' },
    'nonsense',
  ]);
  assert.deepEqual(list.map((a) => [a.method, a.label, a.number]), [['easypaisa', '', '0300 1234567'], ['bank', 'HBL', 'PK36HABB0000001234567890']]);
  assert.deepEqual(parsePayAccounts(null), []);
});

test('the accounts form: empty slots are skipped, a half-filled slot is refused by number', () => {
  const form = (o: Record<string, string>) => (n: string) => o[n] ?? '';
  assert.deepEqual(payAccountsFromForm(form({})), { accounts: [] });
  assert.deepEqual(payAccountsFromForm(form({ method1: 'easypaisa', title1: 'DHA Works', number1: '0300 1234567', method3: 'bank', label3: 'HBL', title3: 'DHA Works', number3: 'PK36HABB0000001234567890' })), {
    accounts: [
      { method: 'easypaisa', label: '', title: 'DHA Works', number: '0300 1234567' },
      { method: 'bank', label: 'HBL', title: 'DHA Works', number: 'PK36HABB0000001234567890' },
    ],
  });
  assert.deepEqual(payAccountsFromForm(form({ method1: 'jazzcash', title1: 'DHA Works' })), { error: 'Account 1: enter the number (3 to 40 characters).' });
  assert.deepEqual(payAccountsFromForm(form({ number2: '0300 1234567' })), { error: 'Account 2: choose how workers pay.' });
  assert.deepEqual(payAccountsFromForm(form({ method1: 'cheque', title1: 'x', number1: '123' })), { error: 'Account 1: choose how workers pay.' });
  assert.deepEqual(payAccountsFromForm(form({ method1: 'bank', number1: '123456' })), { error: 'Account 1: enter the account title (the name on the account).' });
});

test('the dues card counts paid, left, overdue, waived and pending', () => {
  const due = (id: string, status: string, amount: number) => ({ id, job_id: B, job_code: 'DW-1', job_title: 'x', amount, paid: status === 'paid' ? amount : 0, remaining: status === 'paid' || status === 'waived' ? 0 : amount, accrued_at: hours(-10), due_at: hours(10), status });
  const w = parseWorkerDues({
    summary: { owed: 100, overdue: 50, next_due_at: hours(5), overdue_since: hours(-5), paid_total: 100, pending_total: 40, pending_count: 2, credit: 0 },
    dues: [due(A, 'paid', 50), due(B, 'paid', 50), due('00000000-0000-0000-0000-0000000000c1', 'due', 50), due('00000000-0000-0000-0000-0000000000c2', 'overdue', 50), due('00000000-0000-0000-0000-0000000000c3', 'waived', 50)],
    payments: [],
    suspended: false,
  });
  assert.ok(w);
  assert.deepEqual(workerDueCounts(w), { paid: 2, left: 2, overdue: 1, waived: 1, pending: 2, total: 5 });
});

test('the screenshot check comes with each payment in the queue and the ledger (migration 0080); no check is null', () => {
  const check = { verdict: 'flagged', reasons: ['amount_mismatch'], extracted: { amount: 2000, transaction_id: 'TX-1' }, owed: 200, engine: 'test', checked_at: hours(-1) };
  const l = parseDuesList({
    total: 0, rows: [], totals: {},
    pending_payments: [
      { id: B, worker_id: A, worker_name: 'Usman One', amount: 200, method: 'jazzcash', reference: 'TX-1', created_at: hours(-2), check },
      { id: 'cccccccc-0000-0000-0000-000000000001', worker_id: A, worker_name: 'Usman One', amount: 50, method: 'bank', reference: 'TX-2', created_at: hours(-2), check: null },
    ],
  });
  assert.equal(l.pending[0]?.check?.verdict, 'flagged');
  assert.deepEqual(l.pending[0]?.check?.reasons, ['amount_mismatch']);
  assert.equal(l.pending[0]?.check?.read.amount, 2000);
  assert.equal(l.pending[1]?.check, null);
  const w = parseWorkerDues({
    summary: {}, dues: [],
    payments: [
      { id: B, amount: 200, method: 'jazzcash', reference: 'TX-1', status: 'pending', created_at: hours(-2), check },
      { id: 'cccccccc-0000-0000-0000-000000000002', amount: 5, method: 'office_cash', status: 'confirmed', created_at: hours(-3) },
    ],
  });
  assert.equal(w?.payments[0]?.check?.verdict, 'flagged');
  assert.equal(w?.payments[1]?.check, null, 'cash recorded by staff has no check');
});

test('the last confirmed payment and the latest screenshot are found whatever the order', () => {
  const p = (id: string, status: 'pending' | 'confirmed' | 'rejected', createdAt: string, proofPath: string | null) =>
    ({ id, amount: 50, method: 'bank', reference: id, note: null, proofPath, status, createdAt, decidedAt: null, reason: null, byStaff: false, createdBy: null, decidedBy: null, check: null });
  const list = [
    p('old', 'confirmed', '2026-11-20T10:00:00Z', null),
    p('new-pending', 'pending', '2026-11-25T10:00:00Z', 'w/dues/a.jpg'),
    p('mid', 'confirmed', '2026-11-22T10:00:00Z', 'w/dues/b.jpg'),
    p('rej', 'rejected', '2026-11-23T10:00:00Z', 'w/dues/c.jpg'),
  ];
  const r = lastPayments(list);
  assert.equal(r.confirmed?.id, 'mid', 'the newest CONFIRMED one, not the pending or rejected');
  assert.equal(r.latestSent?.id, 'new-pending', 'the newest one that has a screenshot');
  assert.deepEqual(lastPayments([]), { confirmed: null, latestSent: null });
});
