// Pure rules for My Dues (unit tested with node --test): reads what my_dues() returns (migration 0071) and words it for the
// screen, checks the "I have paid" form, and maps the database's refusals to friendly messages. The database is the authority
// for every amount and every rule; nothing here decides who owes what.
import { t } from '../../i18n/index.ts';
import { formatRupees } from '../home/format.ts';
import { dateText } from '../myreports/rules.ts';

export type DueStatus = 'due' | 'overdue' | 'paid' | 'waived';
export type PaymentMethod = 'jazzcash' | 'easypaisa' | 'bank';
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected';
export type ChipTone = 'wait' | 'scheduled' | 'inProgress' | 'done' | 'declined';

export type DuesSummary = {
  owed: number;
  overdue: number;
  nextDueAt: string | null;
  paidTotal: number;
  pendingTotal: number;
  pendingCount: number;
  credit: number;
};

export type DueRow = {
  id: string;
  jobCode: string;
  jobTitle: string;
  amount: number;
  paid: number;
  remaining: number;
  accruedAt: string;
  dueAt: string;
  status: DueStatus;
};

export type DuesPayment = {
  id: string;
  amount: number;
  method: string;
  reference: string;
  status: PaymentStatus;
  createdAt: string;
  reason: string;
  byStaff: boolean;
};

export type MyDues = {
  accountStatus: 'active' | 'suspended';
  suspensionReason: string;
  suspendedUntil: string | null;
  summary: DuesSummary;
  payTo: string;
  helpline: string | null;
  dues: DueRow[];
  payments: DuesPayment[];
};

const DAY = 86_400_000;
const HOUR = 3_600_000;

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Reads the answer of my_dues(). A row that does not look right is skipped, never guessed at. */
export function parseMyDues(json: unknown): MyDues | null {
  const o = obj(json);
  const s = obj(o?.summary);
  const a = obj(o?.account);
  if (!o || !s || !a) return null;
  const dues: DueRow[] = [];
  for (const raw of Array.isArray(o.dues) ? o.dues : []) {
    const r = obj(raw);
    const status = r?.status;
    if (!r || typeof r.id !== 'string' || (status !== 'due' && status !== 'overdue' && status !== 'paid' && status !== 'waived')) continue;
    dues.push({
      id: r.id,
      jobCode: str(r.job_code),
      jobTitle: str(r.job_title),
      amount: num(r.amount),
      paid: num(r.paid),
      remaining: num(r.remaining),
      accruedAt: str(r.accrued_at),
      dueAt: str(r.due_at),
      status,
    });
  }
  const payments: DuesPayment[] = [];
  for (const raw of Array.isArray(o.payments) ? o.payments : []) {
    const r = obj(raw);
    const status = r?.status;
    if (!r || typeof r.id !== 'string' || (status !== 'pending' && status !== 'confirmed' && status !== 'rejected')) continue;
    payments.push({ id: r.id, amount: num(r.amount), method: str(r.method), reference: str(r.reference), status, createdAt: str(r.created_at), reason: str(r.reason), byStaff: r.by_staff === true });
  }
  return {
    accountStatus: a.status === 'suspended' ? 'suspended' : 'active',
    suspensionReason: str(a.reason),
    suspendedUntil: typeof a.until === 'string' ? a.until : null,
    summary: {
      owed: num(s.owed),
      overdue: num(s.overdue),
      nextDueAt: typeof s.next_due_at === 'string' ? s.next_due_at : null,
      paidTotal: num(s.paid_total),
      pendingTotal: num(s.pending_total),
      pendingCount: num(s.pending_count),
      credit: num(s.credit),
    },
    payTo: str(o.pay_to).trim(),
    helpline: typeof o.helpline === 'string' && o.helpline.trim() !== '' ? o.helpline.trim() : null,
    dues,
    payments,
  };
}

/** "3 days", "1 day", "5 hours", "1 hour": how long until (or since) a time. */
export function spanText(ms: number): string {
  const span = Math.max(0, ms);
  const days = Math.floor(span / DAY);
  if (days >= 1) return t(days === 1 ? 'dues.oneDay' : 'dues.nDays', { n: String(days) });
  const hours = Math.max(1, Math.ceil(span / HOUR));
  return t(hours === 1 ? 'dues.oneHour' : 'dues.nHours', { n: String(hours) });
}

export type DueView = { label: string; tone: ChipTone; hint: string };

/** How one due reads: Paid, Waived, "Due in 3 days" or "Overdue by 2 days", with its date. */
export function dueView(due: DueRow, now: Date): DueView {
  if (due.status === 'waived') return { label: t('dues.chipWaived'), tone: 'scheduled', hint: t('dues.waivedHint') };
  if (due.status === 'paid') return { label: t('dues.chipPaid'), tone: 'done', hint: t('dues.paidHint', { amount: formatRupees(due.amount) }) };
  const left = new Date(due.dueAt).getTime() - now.getTime();
  const when = dateText(due.dueAt);
  const part = due.paid > 0 ? ` ${t('dues.paidOf', { paid: formatRupees(due.paid), amount: formatRupees(due.amount) })}` : '';
  if (due.status === 'overdue' || left < 0) {
    return { label: t('dues.chipOverdue'), tone: 'declined', hint: `${t('dues.overdueBy', { when: spanText(-left), date: when })}${part}` };
  }
  return { label: t('dues.chipDue'), tone: 'wait', hint: `${t('dues.dueIn', { when: spanText(left), date: when })}${part}` };
}

export function paymentView(p: DuesPayment): { label: string; tone: ChipTone } {
  if (p.status === 'confirmed') return { label: t('dues.payConfirmed'), tone: 'done' };
  if (p.status === 'rejected') return { label: t('dues.payRejected'), tone: 'declined' };
  return { label: t('dues.payPending'), tone: 'wait' };
}

export function methodLabel(method: string): string {
  switch (method) {
    case 'jazzcash':
      return t('dues.methodJazzcash');
    case 'easypaisa':
      return t('dues.methodEasypaisa');
    case 'bank':
      return t('dues.methodBank');
    case 'office_cash':
      return t('dues.methodOffice');
    default:
      return method;
  }
}

// ---- the "I have paid" form ----------------------------------------------------------------------------------------------------

export const METHODS: readonly PaymentMethod[] = ['jazzcash', 'easypaisa', 'bank'];
export const REFERENCE_MIN = 3;
export const REFERENCE_MAX = 60;

export type PaymentInput = { amount: string; method: PaymentMethod | null; reference: string };
export type PaymentArgs = { p_amount: number; p_method: PaymentMethod; p_reference: string };
export type PaymentCheck = { ok: true; args: PaymentArgs } | { ok: false; field: 'amount' | 'method' | 'reference'; key: DuesErrorKey };

export type DuesErrorKey =
  | 'dues.errors.amount'
  | 'dues.errors.method'
  | 'dues.errors.reference'
  | 'dues.errors.tooMuch'
  | 'dues.errors.nothing'
  | 'dues.errors.pending'
  | 'dues.errors.used'
  | 'dues.errors.generic'
  | 'dues.errors.network';

export const amountDigits = (raw: string): string => raw.replace(/\D/g, '').slice(0, 8);

export function checkPayment(input: PaymentInput, owed: number): PaymentCheck {
  const amount = Number(amountDigits(input.amount) || '0');
  if (amount < 1) return { ok: false, field: 'amount', key: 'dues.errors.amount' };
  if (amount > owed) return { ok: false, field: 'amount', key: 'dues.errors.tooMuch' };
  if (!input.method) return { ok: false, field: 'method', key: 'dues.errors.method' };
  const reference = input.reference.trim();
  if (reference.length < REFERENCE_MIN || reference.length > REFERENCE_MAX) return { ok: false, field: 'reference', key: 'dues.errors.reference' };
  return { ok: true, args: { p_amount: amount, p_method: input.method, p_reference: reference } };
}

/** The database's plain-English refusals (submit_dues_payment) as the app's own messages. */
export function duesErrorKey(message: string | null | undefined): DuesErrorKey {
  const m = (message ?? '').toLowerCase();
  if (m.includes('more than you owe')) return 'dues.errors.tooMuch';
  if (m.includes('do not owe')) return 'dues.errors.nothing';
  if (m.includes('still checking')) return 'dues.errors.pending';
  if (m.includes('already sent')) return 'dues.errors.used';
  if (m.includes('choose how you paid')) return 'dues.errors.method';
  if (m.includes('transaction id')) return 'dues.errors.reference';
  if (m.includes('amount you paid')) return 'dues.errors.amount';
  return 'dues.errors.generic';
}

export type PaymentClient = { submit: (args: PaymentArgs) => PromiseLike<{ error: { message: string } | null }> };

export async function sendPayment(client: PaymentClient, args: PaymentArgs): Promise<{ ok: true } | { ok: false; key: DuesErrorKey }> {
  try {
    const { error } = await client.submit(args);
    return error ? { ok: false, key: duesErrorKey(error.message) } : { ok: true };
  } catch {
    return { ok: false, key: 'dues.errors.network' };
  }
}

// ---- support contact for a suspended worker --------------------------------------------------------------------------------------

/** A WhatsApp link when the number is a mobile (03xx..., 92xx... or +92xx...); a short code such as 1092 has none. */
export function whatsappLink(number: string | null | undefined): string | null {
  const digits = (number ?? '').replace(/\D/g, '');
  if (/^03\d{9}$/.test(digits)) return `https://wa.me/92${digits.slice(1)}`;
  if (/^923\d{9}$/.test(digits)) return `https://wa.me/${digits}`;
  return null;
}

/** The text on the profile row and the suspended screen. */
export function owedText(summary: DuesSummary): string {
  return summary.owed > 0 ? formatRupees(summary.owed) : '';
}
