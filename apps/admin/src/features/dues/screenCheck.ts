// The automatic screenshot check of a dues payment (migration 0080). The database decides (dues_check_apply); this file only reads
// what it stored and words it for staff: the badge, the reasons, and the numbers side by side. Nothing here decides or confirms
// anything, and a check that is missing or looks wrong is simply "not checked yet".
import { rupees } from '../../lib/format.ts';
import { num, obj, str, strs } from '../../lib/json.ts';

export type CheckVerdict = 'matches' | 'flagged' | 'unreadable';
const VERDICTS: readonly string[] = ['matches', 'flagged', 'unreadable'];

/** Every reason the database can give. A code it does not know is dropped rather than shown as a raw word. */
export const REASONS = [
  'nothing_readable',
  'amount_mismatch', 'amount_unreadable', 'amount_less_than_owed', 'amount_more_than_owed',
  'txn_mismatch', 'txn_unreadable', 'txn_reused',
  'receiver_unknown', 'receiver_unreadable', 'receiver_not_checked',
  'status_not_success', 'status_unreadable',
  'date_old', 'date_future', 'date_before_due', 'date_unreadable',
  'method_mismatch',
] as const;
export type Reason = (typeof REASONS)[number];

/** A mismatch to look at first (red). Everything else is something the check could not confirm (yellow). */
const RED: readonly Reason[] = ['amount_mismatch', 'txn_mismatch', 'txn_reused', 'receiver_unknown', 'status_not_success', 'date_future'];

export type Read = {
  app: string | null;
  amount: number | null;
  transactionId: string | null;
  paidAt: string | null;
  receiverName: string | null;
  receiverAccount: string | null;
  status: string | null;
};

export type ScreenCheck = { verdict: CheckVerdict; reasons: Reason[]; read: Read; owed: number | null; engine: string | null; checkedAt: string | null };

/** What the payment itself says (what the worker typed). */
export type PaymentFacts = { amount: number; reference: string | null; method: string; createdAt: string };

/** The check as the database returned it, or null when there is none (not checked yet) or it does not look right. */
export function parseScreenCheck(json: unknown): ScreenCheck | null {
  const o = obj(json);
  if (!o || !VERDICTS.includes(String(o.verdict))) return null;
  const ex = obj(o.extracted) ?? {};
  return {
    verdict: o.verdict as CheckVerdict,
    reasons: strs(o.reasons).filter((r): r is Reason => (REASONS as readonly string[]).includes(r)),
    read: {
      app: str(ex.app),
      amount: num(ex.amount),
      transactionId: str(ex.transaction_id),
      paidAt: str(ex.paid_at),
      receiverName: str(ex.receiver_name),
      receiverAccount: str(ex.receiver_account),
      status: str(ex.status),
    },
    owed: num(o.owed),
    engine: str(o.engine),
    checkedAt: str(o.checked_at),
  };
}

export type Badge = { tone: 'ok' | 'wait' | 'red' | 'gray'; label: string };

export function checkBadge(check: ScreenCheck | null): Badge {
  if (!check) return { tone: 'gray', label: 'Not checked yet' };
  if (check.verdict === 'matches') return { tone: 'ok', label: 'Screenshot matches' };
  if (check.verdict === 'unreadable') return { tone: 'gray', label: 'Could not read' };
  return { tone: check.reasons.some((r) => RED.includes(r)) ? 'red' : 'wait', label: 'Needs a closer look' };
}

const APP_LABEL: Record<string, string> = { jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank: 'a bank app', sadapay: 'SadaPay', nayapay: 'NayaPay', other: 'another app' };
const METHOD_LABEL: Record<string, string> = { jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank: 'bank transfer', sadapay: 'SadaPay', nayapay: 'NayaPay', other: 'other' };
const appText = (v: string | null): string => (v ? APP_LABEL[v] ?? v : 'an app that was not recognised');

const rs = (n: number | null): string => (n === null ? 'not read' : rupees(n));
/** Letters and digits only, upper case: the same rule the database uses to compare transaction IDs. */
const key = (v: string | null): string => (v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** One plain sentence for staff per reason, with the numbers that caused it. */
export function reasonText(code: Reason, check: ScreenCheck, p: PaymentFacts): string {
  switch (code) {
    case 'nothing_readable': return 'Nothing could be read from the screenshot. Check it by hand.';
    case 'amount_mismatch': return `Amount does not match: the screenshot shows ${rs(check.read.amount)}, the worker typed ${rs(p.amount)}.`;
    case 'amount_unreadable': return 'The amount in the screenshot could not be read.';
    case 'amount_less_than_owed': return `Less than owed: ${rs(p.amount)} typed, ${rs(check.owed)} owed. It is a part payment.`;
    case 'amount_more_than_owed': return `More than owed: ${rs(p.amount)} typed, ${rs(check.owed)} owed.`;
    case 'txn_mismatch': return `Transaction ID does not match: the screenshot shows ${check.read.transactionId ?? 'nothing'}, the worker typed ${p.reference ?? 'nothing'}.`;
    case 'txn_unreadable': return 'The transaction ID in the screenshot could not be read.';
    case 'txn_reused': return 'This transaction ID, or this very picture, was already used on another payment.';
    case 'receiver_unknown': return "The money went to an account that is not one of DHA's saved accounts.";
    case 'receiver_unreadable': return 'The account the money went to could not be read.';
    case 'receiver_not_checked': return "No payment account is saved in Settings, so who received the money was not checked.";
    case 'status_not_success': return 'The screenshot does not show a successful payment.';
    case 'status_unreadable': return 'Whether the payment succeeded could not be read.';
    case 'date_old': return 'The payment is dated more than 7 days before the worker sent it.';
    case 'date_future': return 'The payment is dated after the day the worker sent it.';
    case 'date_before_due': return 'The payment is dated before the oldest due existed.';
    case 'date_unreadable': return 'The date in the screenshot could not be read.';
    case 'method_mismatch': return `The screenshot looks like ${appText(check.read.app)}, but the worker said ${METHOD_LABEL[p.method] ?? p.method}.`;
  }
}

export type RowState = 'same' | 'different' | 'unknown';
export type CompareRow = { label: string; typed: string; read: string; state: RowState };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-24" or "2026-11-24T14:30" as "24 Nov 2026" or "24 Nov 2026, 14:30"; anything else is shown as it came. */
export function paidAtText(v: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(v ?? '');
  if (!m) return v ?? 'Not read';
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return v ?? 'Not read';
  return `${Number(m[3])} ${month} ${m[1]}${m[4] ? `, ${m[4]}` : ''}`;
}

/** The worker's side and the screenshot's side, line by line, each marked same, different or not read. */
export function compareRows(check: ScreenCheck, p: PaymentFacts): CompareRow[] {
  const has = (...codes: Reason[]) => check.reasons.some((r) => codes.includes(r));
  const r = check.read;
  const receiver = [r.receiverName, r.receiverAccount].filter((x): x is string => !!x).join(' / ');
  const dateState: RowState = r.paidAt === null || has('date_unreadable') ? 'unknown' : has('date_old', 'date_future', 'date_before_due') ? 'different' : 'same';
  return [
    { label: 'Amount', typed: rs(p.amount), read: r.amount === null ? 'Not read' : rs(r.amount), state: r.amount === null ? 'unknown' : r.amount === p.amount ? 'same' : 'different' },
    { label: 'Transaction ID', typed: p.reference ?? '-', read: r.transactionId ?? 'Not read', state: r.transactionId === null ? 'unknown' : key(r.transactionId) === key(p.reference) && !has('txn_reused') ? 'same' : 'different' },
    { label: 'Sent to', typed: "One of DHA's accounts", read: receiver || 'Not read', state: has('receiver_unknown') ? 'different' : receiver === '' || has('receiver_unreadable', 'receiver_not_checked') ? 'unknown' : 'same' },
    { label: 'Status', typed: 'Successful', read: r.status === 'success' ? 'Successful' : r.status === 'failed' ? 'Failed' : r.status === 'pending' ? 'Pending' : 'Not read', state: r.status === null ? 'unknown' : r.status === 'success' ? 'same' : 'different' },
    { label: 'Date', typed: 'After the due was added, up to the day it was sent', read: paidAtText(r.paidAt), state: dateState },
    { label: 'Paid with', typed: METHOD_LABEL[p.method] ?? p.method, read: r.app ? appText(r.app) : 'Not read', state: r.app === null || r.app === 'other' ? 'unknown' : has('method_mismatch') ? 'different' : 'same' },
  ];
}

// ---- the filter on the queue of payments to check ------------------------------------------------------------------------------

export const CHECK_FILTERS = ['all', 'matches', 'attention'] as const;
export type CheckFilter = (typeof CHECK_FILTERS)[number];

/** Which payments the address asks to see; anything else shows them all. */
export function parseCheckFilter(v: unknown): CheckFilter {
  return typeof v === 'string' && (CHECK_FILTERS as readonly string[]).includes(v) ? (v as CheckFilter) : 'all';
}

/** "matches" shows only payments whose screenshot matched; "attention" shows everything else, including those not checked yet. */
export function filterByCheck<T extends { check: ScreenCheck | null }>(items: T[], filter: CheckFilter): T[] {
  if (filter === 'matches') return items.filter((i) => i.check?.verdict === 'matches');
  if (filter === 'attention') return items.filter((i) => i.check?.verdict !== 'matches');
  return items;
}
