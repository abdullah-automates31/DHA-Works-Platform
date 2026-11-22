import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  amountDigits,
  checkPayment,
  dueView,
  duesErrorKey,
  methodLabel,
  parseMyDues,
  paymentView,
  sendPayment,
  spanText,
  whatsappLink,
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

test('the form: amount, method and transaction ID are checked before anything is sent', () => {
  const ok = { amount: '250', method: 'jazzcash' as const, reference: ' TX-1001 ' };
  assert.deepEqual(checkPayment(ok, 550), { ok: true, args: { p_amount: 250, p_method: 'jazzcash', p_reference: 'TX-1001' } });
  assert.deepEqual(checkPayment({ ...ok, amount: '' }, 550), { ok: false, field: 'amount', key: 'dues.errors.amount' });
  assert.deepEqual(checkPayment({ ...ok, amount: '0' }, 550), { ok: false, field: 'amount', key: 'dues.errors.amount' });
  assert.deepEqual(checkPayment({ ...ok, amount: '551' }, 550), { ok: false, field: 'amount', key: 'dues.errors.tooMuch' });
  assert.deepEqual(checkPayment({ ...ok, method: null }, 550), { ok: false, field: 'method', key: 'dues.errors.method' });
  assert.deepEqual(checkPayment({ ...ok, reference: 'ab' }, 550), { ok: false, field: 'reference', key: 'dues.errors.reference' });
  assert.deepEqual(checkPayment({ ...ok, reference: 'x'.repeat(61) }, 550), { ok: false, field: 'reference', key: 'dues.errors.reference' });
  assert.equal(amountDigits('Rs 1,250.50'), '125050', 'only digits are kept');
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

test('sending a payment: success, a refusal and a lost connection', async () => {
  const args = { p_amount: 10, p_method: 'bank' as const, p_reference: 'TX-9' };
  assert.deepEqual(await sendPayment({ submit: async () => ({ error: null }) }, args), { ok: true });
  assert.deepEqual(await sendPayment({ submit: async () => ({ error: { message: 'this transaction ID was already sent' } }) }, args), { ok: false, key: 'dues.errors.used' });
  assert.deepEqual(await sendPayment({ submit: () => Promise.reject(new Error('offline')) }, args), { ok: false, key: 'dues.errors.network' });
});

test('a WhatsApp link only for a mobile number', () => {
  assert.equal(whatsappLink('03001234567'), 'https://wa.me/923001234567');
  assert.equal(whatsappLink('+92 300 1234567'), 'https://wa.me/923001234567');
  assert.equal(whatsappLink('923001234567'), 'https://wa.me/923001234567');
  assert.equal(whatsappLink('1092'), null, 'a short helpline has no WhatsApp');
  assert.equal(whatsappLink(''), null);
  assert.equal(whatsappLink(null), null);
});
