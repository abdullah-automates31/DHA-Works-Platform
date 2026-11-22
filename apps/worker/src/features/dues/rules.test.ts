import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  amountDigits,
  buildProofPath,
  checkPayment,
  latestRejection,
  parseSearch,
  SEARCH_FROM,
  searchText,
  dueView,
  duesErrorKey,
  METHODS,
  methodLabel,
  accountName,
  type PayAccount,
  parseDueDetail,
  parseMyDues,
  parsePayAccounts,
  paymentView,
  sendPayment,
  spanText,
  whatsappLink,
  whereText,
  type DuesPayment,
  type DueRow,
} from './rules.ts';

const NOW = new Date('2026-11-22T10:00:00Z');
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

const answer = {
  account: { status: 'active', reason: null, until: null },
  summary: { owed: 350, overdue: 50, next_due_at: hours(24), overdue_since: hours(-24), paid_total: 200, pending_total: 40, pending_count: 1, credit: 0 },
  pay_to: '  JazzCash 0300 1234567  ',
  helpline: '1092',
  dues: [
    { id: 'd1', job_id: 'j1', job_code: 'DW-2101', job_title: 'Kitchen tap', amount: 300, paid: 250, remaining: 50, accrued_at: hours(-96), due_at: hours(-24), status: 'overdue' },
    { id: 'bad', status: 'weird' },
    { id: 'd2', job_code: 'DW-2102', job_title: 'Fan', amount: 50, paid: 0, remaining: 50, accrued_at: hours(-1), due_at: hours(120), status: 'due' },
  ],
  payments: [
    { id: 'p1', amount: 40, method: 'bank', reference: 'TX-1', status: 'pending', created_at: hours(-2), decision_reason: null, by_staff: false },
    { id: 'p2', amount: 150, method: 'office_cash', reference: null, status: 'confirmed', created_at: hours(-50), reason: null, by_staff: true },
  ],
};

test('my_dues is read into plain values; a bad row is skipped', () => {
  const d = parseMyDues(answer);
  assert.ok(d);
  assert.equal(d.summary.owed, 350);
  assert.equal(d.summary.overdue, 50);
  assert.equal(d.summary.pendingCount, 1);
  assert.equal(d.payTo, 'JazzCash 0300 1234567', 'the pay-to text is trimmed');
  assert.equal(d.helpline, '1092');
  assert.deepEqual(d.dues.map((x) => x.id), ['d1', 'd2'], 'the row with an unknown status is skipped');
  assert.deepEqual(d.payments.map((x) => [x.id, x.byStaff]), [['p1', false], ['p2', true]]);
  assert.equal(d.accountStatus, 'active');
});

test('an answer that is not my_dues is refused, and a suspended account is recognised', () => {
  assert.equal(parseMyDues(null), null);
  assert.equal(parseMyDues([]), null);
  assert.equal(parseMyDues({ summary: {} }), null);
  const s = parseMyDues({ ...answer, account: { status: 'suspended', reason: 'Unpaid DHA dues', until: null }, helpline: null });
  assert.equal(s?.accountStatus, 'suspended');
  assert.equal(s?.suspensionReason, 'Unpaid DHA dues');
  assert.equal(s?.helpline, null);
});

test('how long is left reads in days, then hours', () => {
  assert.equal(spanText(3 * 24 * 3_600_000 + 5), '3 days');
  assert.equal(spanText(24 * 3_600_000), '1 day');
  assert.equal(spanText(5 * 3_600_000), '5 hours');
  assert.equal(spanText(30 * 60_000), '1 hour');
  assert.equal(spanText(-5), '1 hour', 'never a negative span');
});

test('a due says Due, Overdue, Paid or Waived', () => {
  const base: DueRow = { id: 'd', jobCode: 'DW-1', jobTitle: 'x', amount: 300, paid: 0, remaining: 300, accruedAt: hours(-5), dueAt: hours(72), status: 'due' };
  const due = dueView(base, NOW);
  assert.equal(due.label, 'Due');
  assert.equal(due.tone, 'wait');
  assert.match(due.hint, /Due in 3 days/);
  const late = dueView({ ...base, status: 'overdue', dueAt: hours(-48), paid: 250, remaining: 50 }, NOW);
  assert.equal(late.label, 'Overdue');
  assert.equal(late.tone, 'declined');
  assert.match(late.hint, /Overdue by 2 days/);
  assert.match(late.hint, /250/, 'a part payment is shown');
  assert.equal(dueView({ ...base, status: 'paid', remaining: 0, paid: 300 }, NOW).label, 'Paid');
  assert.equal(dueView({ ...base, status: 'waived', remaining: 0 }, NOW).label, 'Waived');
});

test('a payment says Waiting, Confirmed or Not accepted', () => {
  const base = { id: 'p', amount: 1, method: 'bank', reference: 'x', createdAt: '', reason: '', byStaff: false };
  assert.deepEqual(paymentView({ ...base, status: 'pending' }), { label: 'Waiting for DHA', tone: 'wait' });
  assert.deepEqual(paymentView({ ...base, status: 'confirmed' }), { label: 'Confirmed', tone: 'done' });
  assert.deepEqual(paymentView({ ...base, status: 'rejected' }), { label: 'Not accepted', tone: 'declined' });
  assert.equal(methodLabel('jazzcash'), 'JazzCash');
  assert.equal(methodLabel('office_cash'), 'Paid at DHA office');
});

const SHOT = { bytes: new ArrayBuffer(2048), mime: 'image/jpeg' };

test('the form: amount, method, transaction ID and screenshot are checked before anything is sent', () => {
  const ok = { amount: '250', method: 'jazzcash' as const, reference: ' TX-1001 ', proof: SHOT };
  assert.deepEqual(checkPayment(ok, 550), { ok: true, args: { p_amount: 250, p_method: 'jazzcash', p_reference: 'TX-1001' }, proof: SHOT });
  assert.deepEqual(checkPayment({ ...ok, amount: '' }, 550), { ok: false, field: 'amount', key: 'dues.errors.amount' });
  assert.deepEqual(checkPayment({ ...ok, amount: '0' }, 550), { ok: false, field: 'amount', key: 'dues.errors.amount' });
  assert.deepEqual(checkPayment({ ...ok, amount: '551' }, 550), { ok: false, field: 'amount', key: 'dues.errors.tooMuch' });
  assert.deepEqual(checkPayment({ ...ok, method: null }, 550), { ok: false, field: 'method', key: 'dues.errors.method' });
  assert.deepEqual(checkPayment({ ...ok, reference: 'ab' }, 550), { ok: false, field: 'reference', key: 'dues.errors.reference' });
  assert.deepEqual(checkPayment({ ...ok, reference: 'x'.repeat(61) }, 550), { ok: false, field: 'reference', key: 'dues.errors.reference' });
  assert.equal(amountDigits('Rs 1,250.50'), '125050', 'only digits are kept');
});

test('the screenshot is required, and it must be a real photo under 5 MB', () => {
  const base = { amount: '50', method: 'bank' as const, reference: 'TX-9' };
  assert.deepEqual(checkPayment({ ...base, proof: null }, 100), { ok: false, field: 'proof', key: 'dues.errors.proof' });
  assert.deepEqual(checkPayment({ ...base, proof: { bytes: new ArrayBuffer(10), mime: 'application/pdf' } }, 100), { ok: false, field: 'proof', key: 'dues.errors.proofFile' });
  assert.deepEqual(checkPayment({ ...base, proof: { bytes: new ArrayBuffer(0), mime: 'image/png' } }, 100), { ok: false, field: 'proof', key: 'dues.errors.proofFile' });
  assert.deepEqual(checkPayment({ ...base, proof: { bytes: new ArrayBuffer(5 * 1024 * 1024 + 1), mime: 'image/png' } }, 100), { ok: false, field: 'proof', key: 'dues.errors.proofFile' });
  assert.equal(checkPayment({ ...base, proof: { bytes: new ArrayBuffer(10), mime: 'IMAGE/WEBP' } }, 100).ok, true, 'the type is read without regard to case');
});

test('every way to pay has a name, and Other, SadaPay and NayaPay are among them', () => {
  assert.deepEqual([...METHODS], ['jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'other']);
  assert.equal(methodLabel('sadapay'), 'SadaPay');
  assert.equal(methodLabel('nayapay'), 'NayaPay');
  assert.equal(methodLabel('other'), 'Other');
});

test('the screenshot goes to the own dues folder of the worker', () => {
  assert.equal(buildProofPath('u1', 'image/jpeg', 1700000000000, 'abc123'), 'u1/dues/1700000000000-abc123.jpg');
  assert.equal(buildProofPath('u1', 'image/png', 5, 'z'), 'u1/dues/5-z.png');
  assert.equal(buildProofPath('u1', 'image/webp', 5, 'z'), 'u1/dues/5-z.webp');
});

test("the database's refusals become the app's own messages", () => {
  assert.equal(duesErrorKey('the amount is more than you owe'), 'dues.errors.tooMuch');
  assert.equal(duesErrorKey('you do not owe DHA anything right now'), 'dues.errors.nothing');
  assert.equal(duesErrorKey('DHA is still checking your earlier payments; please wait for them to be confirmed'), 'dues.errors.pending');
  assert.equal(duesErrorKey('this transaction ID was already sent'), 'dues.errors.used');
  assert.equal(duesErrorKey('choose how you paid: JazzCash, Easypaisa or bank'), 'dues.errors.method');
  assert.equal(duesErrorKey('enter the transaction ID from your payment (3 to 60 characters)'), 'dues.errors.reference');
  assert.equal(duesErrorKey('enter the amount you paid'), 'dues.errors.amount');
  assert.equal(duesErrorKey('something else'), 'dues.errors.generic');
  assert.equal(duesErrorKey(null), 'dues.errors.generic');
});

test('sending a payment: the screenshot is uploaded first, then the payment is sent with its path', async () => {
  const input = { userId: 'u1', args: { p_amount: 10, p_method: 'bank' as const, p_reference: 'TX-9' }, proof: SHOT, now: 123, random: 'r' };
  const calls: string[] = [];
  const ok = {
    upload: async (path: string) => {
      calls.push('upload ' + path);
      return { error: null };
    },
    submit: async (a: { p_proof_path: string }) => {
      calls.push('submit ' + a.p_proof_path);
      return { error: null };
    },
  };
  assert.deepEqual(await sendPayment(ok, input), { ok: true });
  assert.deepEqual(calls, ['upload u1/dues/123-r.jpg', 'submit u1/dues/123-r.jpg'], 'upload first, then the same path in the payment');
});

test('sending a payment: a failed upload sends nothing; a refusal and a lost connection are named', async () => {
  const input = { userId: 'u1', args: { p_amount: 10, p_method: 'bank' as const, p_reference: 'TX-9' }, proof: SHOT };
  let submitted = 0;
  const submit = async () => {
    submitted++;
    return { error: null };
  };
  assert.deepEqual(await sendPayment({ upload: async () => ({ error: { message: 'x' } }), submit }, input), { ok: false, key: 'dues.errors.proofUpload' });
  assert.equal(submitted, 0, 'nothing is sent when the screenshot did not upload');
  assert.deepEqual(
    await sendPayment({ upload: async () => ({ error: null }), submit: async () => ({ error: { message: 'this transaction ID was already sent' } }) }, input),
    { ok: false, key: 'dues.errors.used' },
  );
  assert.deepEqual(
    await sendPayment({ upload: async () => ({ error: null }), submit: async () => ({ error: { message: 'attach a screenshot of your payment' } }) }, input),
    { ok: false, key: 'dues.errors.proof' },
  );
  assert.deepEqual(await sendPayment({ upload: () => Promise.reject(new Error('offline')), submit }, input), { ok: false, key: 'dues.errors.network' });
});

test('a WhatsApp link only for a mobile number', () => {
  assert.equal(whatsappLink('03001234567'), 'https://wa.me/923001234567');
  assert.equal(whatsappLink('+92 300 1234567'), 'https://wa.me/923001234567');
  assert.equal(whatsappLink('923001234567'), 'https://wa.me/923001234567');
  assert.equal(whatsappLink('1092'), null, 'a short helpline has no WhatsApp');
  assert.equal(whatsappLink(''), null);
  assert.equal(whatsappLink(null), null);
});

const detailAnswer = {
  due: { id: 'd1', fee: 200, paid: 50, remaining: 150, accrued_at: hours(-72), due_at: hours(48), status: 'due', waive_reason: null },
  job: { id: 'j1', code: 'DW-2101', title: 'Kitchen tap', description: 'Leaks', category: 'Plumbing', phase: 6, lane: '8', completed_at: hours(-80), scheduled_start: hours(-90) },
  money: { labour: 1000, materials: 0, total: 1000, fee: 200, earned: 800, cash_recorded: 1000, cash_recorded_at: hours(-79) },
  owed_total: 550,
};

test('one due in full is read into plain values', () => {
  const d = parseDueDetail(detailAnswer);
  assert.ok(d);
  assert.deepEqual([d.due.fee, d.due.paid, d.due.remaining, d.due.status], [200, 50, 150, 'due']);
  assert.deepEqual([d.job.code, d.job.title, d.job.category, d.job.phase, d.job.lane], ['DW-2101', 'Kitchen tap', 'Plumbing', 6, '8']);
  assert.deepEqual([d.money.total, d.money.fee, d.money.earned, d.money.cashRecorded], [1000, 200, 800, 1000]);
  assert.equal(d.owedTotal, 550);
  assert.ok(d.job.completedAt);
});

test('an answer that is not a due, or has an unknown state, is refused', () => {
  assert.equal(parseDueDetail(null), null);
  assert.equal(parseDueDetail({}), null);
  assert.equal(parseDueDetail({ ...detailAnswer, due: { ...detailAnswer.due, status: 'weird' } }), null);
  assert.equal(parseDueDetail({ ...detailAnswer, job: { code: 'x' } }), null);
  assert.equal(parseDueDetail({ ...detailAnswer, money: { ...detailAnswer.money, cash_recorded: null } })?.money.cashRecorded, null, 'no cash recorded yet is allowed');
});

test('where the job was reads as phase and lane', () => {
  assert.equal(whereText(6, '8'), 'Phase 6, Lane 8');
  assert.equal(whereText(7, '  '), 'Phase 7');
});

test('DHA accounts are read and named for the worker', () => {
  const list = parsePayAccounts([
    { method: 'easypaisa', label: null, title: 'DHA Works', number: ' 0300 1234567 ' },
    { method: 'bank', label: 'HBL', title: 'DHA Works (Pvt) Ltd', number: 'PK36HABB0000001234567890' },
    { method: 'raast', title: '', number: '03001234567' },
    { method: '', title: 'x', number: '123' },
    { method: 'jazzcash', title: 'x', number: '  ' },
    42,
  ]);
  assert.equal(list.length, 3);
  const [first, second, third] = list as [PayAccount, PayAccount, PayAccount];
  assert.equal(first.number, '0300 1234567');
  assert.equal(accountName(first), 'Easypaisa');
  assert.equal(accountName(second), 'Bank - HBL');
  assert.equal(accountName(third), 'Raast');
  assert.deepEqual(parsePayAccounts(undefined), []);
});

test('the search text is tidied and cut, and its answer is read like My Dues', () => {
  assert.equal(searchText('  sink   leak  '), 'sink leak');
  assert.equal(searchText('x'.repeat(100)).length, 40);
  assert.equal(searchText('   '), '');
  const found = parseSearch({ dues: [{ id: 'd1', status: 'paid', job_code: 'DW-1', job_title: 'Sink', amount: 50, paid: 50, remaining: 0, accrued_at: '2026-11-22T00:00:00Z', due_at: '2026-11-27T00:00:00Z' }, { id: 'bad', status: 'weird' }], payments: [{ id: 'p1', status: 'confirmed', amount: 50, method: 'bank', reference: 'TX1' }, 7] });
  assert.equal(found?.dues.length, 1);
  assert.equal(found?.dues[0]?.jobTitle, 'Sink');
  assert.equal(found?.payments.length, 1);
  assert.equal(parseSearch('nonsense'), null);
  assert.equal(SEARCH_FROM, 5);
});

test('the rejection message shows only while the latest payment is the rejected one', () => {
  const pay = (id: string, status: DuesPayment['status']): DuesPayment => ({ id, amount: 250, method: 'easypaisa', reference: 'TX1', status, createdAt: '2026-11-22T00:00:00Z', reason: 'Transaction not found', byStaff: false });
  assert.equal(latestRejection([pay('a', 'rejected'), pay('b', 'confirmed')])?.id, 'a');
  assert.equal(latestRejection([pay('c', 'pending'), pay('a', 'rejected')]), null);
  assert.equal(latestRejection([pay('d', 'confirmed'), pay('a', 'rejected')]), null);
  assert.equal(latestRejection([]), null);
});
