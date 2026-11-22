// DHA dues (migration 0071): what admin_dues_list, admin_dues_worker and admin_dues_counts return, and the small rules the
// screens share. A reply that does not look right becomes zeros or an empty list, never a half-drawn row.
import { arr, bool, int, isUuid, obj, page, str } from '../../lib/json.ts';

export const TABS = ['pending', 'overdue', 'owing', 'suspended', 'all'] as const;
export type Tab = (typeof TABS)[number];

/** Which list the address asks for; anything else is "owing" (the useful default: who still has to pay). */
export function parseTab(v: unknown): Tab {
  return typeof v === 'string' && (TABS as readonly string[]).includes(v) ? (v as Tab) : 'owing';
}

export type DuesCounts = { pending: number; overdueWorkers: number };

export function parseCounts(json: unknown): DuesCounts {
  const o = obj(json) ?? {};
  return { pending: int(o.pending), overdueWorkers: int(o.overdue_workers) };
}

export type DuesRow = {
  id: string;
  name: string;
  phone: string;
  suspended: boolean;
  owed: number;
  overdue: number;
  nextDueAt: string | null;
  overdueSince: string | null;
  pendingCount: number;
  pendingTotal: number;
  paidTotal: number;
};

export type PendingPayment = { id: string; workerId: string; workerName: string; amount: number; method: string; reference: string; proofPath: string | null; createdAt: string };

export type DuesTotals = { owed: number; overdue: number; pending: number; collectedThisMonth: number };

export type DuesList = { total: number; rows: DuesRow[]; totals: DuesTotals; pending: PendingPayment[]; payTo: string };

export function parseDuesList(json: unknown): DuesList {
  const { total, rows } = page<DuesRow>(json, (r) => {
    if (!isUuid(r.id)) return null;
    return {
      id: r.id,
      name: str(r.name) ?? 'Worker',
      phone: str(r.phone) ?? '',
      suspended: r.account_status === 'suspended',
      owed: int(r.owed),
      overdue: int(r.overdue),
      nextDueAt: str(r.next_due_at),
      overdueSince: str(r.overdue_since),
      pendingCount: int(r.pending_count),
      pendingTotal: int(r.pending_total),
      paidTotal: int(r.paid_total),
    };
  });
  const o = obj(json) ?? {};
  const t = obj(o.totals) ?? {};
  const pending: PendingPayment[] = [];
  for (const raw of arr(o.pending_payments)) {
    const r = obj(raw);
    if (!r || !isUuid(r.id) || !isUuid(r.worker_id)) continue;
    pending.push({
      id: r.id,
      workerId: r.worker_id,
      workerName: str(r.worker_name) ?? 'Worker',
      amount: int(r.amount),
      method: str(r.method) ?? '',
      reference: str(r.reference) ?? '',
      proofPath: safeProofPath(r.proof_path),
      createdAt: str(r.created_at) ?? '',
    });
  }
  return {
    total,
    rows,
    totals: { owed: int(t.owed), overdue: int(t.overdue), pending: int(t.pending), collectedThisMonth: int(t.collected_this_month) },
    pending,
    payTo: (str(o.pay_to) ?? '').trim(),
  };
}

export type DueStatus = 'due' | 'overdue' | 'paid' | 'waived';

export type LedgerDue = {
  id: string;
  jobId: string;
  jobCode: string;
  jobTitle: string;
  amount: number;
  paid: number;
  remaining: number;
  accruedAt: string;
  dueAt: string;
  status: DueStatus;
  waiveReason: string | null;
  waivedAt: string | null;
};

export type LedgerPayment = {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  note: string | null;
  proofPath: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
  decidedAt: string | null;
  reason: string | null;
  byStaff: boolean;
  createdBy: string | null;
  decidedBy: string | null;
};

export type WorkerSummary = { owed: number; overdue: number; nextDueAt: string | null; overdueSince: string | null; paidTotal: number; pendingTotal: number; pendingCount: number; credit: number };

export type WorkerDues = { summary: WorkerSummary; dues: LedgerDue[]; payments: LedgerPayment[]; suspended: boolean };

const STATUSES: readonly string[] = ['due', 'overdue', 'paid', 'waived'];
const PAY_STATUSES: readonly string[] = ['pending', 'confirmed', 'rejected'];

export function parseWorkerDues(json: unknown): WorkerDues | null {
  const o = obj(json);
  const s = obj(o?.summary);
  if (!o || !s) return null;
  const dues: LedgerDue[] = [];
  for (const raw of arr(o.dues)) {
    const r = obj(raw);
    if (!r || !isUuid(r.id) || !STATUSES.includes(String(r.status))) continue;
    dues.push({
      id: r.id,
      jobId: str(r.job_id) ?? '',
      jobCode: str(r.job_code) ?? '',
      jobTitle: str(r.job_title) ?? '',
      amount: int(r.amount),
      paid: int(r.paid),
      remaining: int(r.remaining),
      accruedAt: str(r.accrued_at) ?? '',
      dueAt: str(r.due_at) ?? '',
      status: r.status as DueStatus,
      waiveReason: str(r.waive_reason),
      waivedAt: str(r.waived_at),
    });
  }
  const payments: LedgerPayment[] = [];
  for (const raw of arr(o.payments)) {
    const r = obj(raw);
    if (!r || !isUuid(r.id) || !PAY_STATUSES.includes(String(r.status))) continue;
    payments.push({
      id: r.id,
      amount: int(r.amount),
      method: str(r.method) ?? '',
      reference: str(r.reference),
      note: str(r.note),
      proofPath: safeProofPath(r.proof_path),
      status: r.status as LedgerPayment['status'],
      createdAt: str(r.created_at) ?? '',
      decidedAt: str(r.decided_at),
      reason: str(r.reason),
      byStaff: bool(r.by_staff),
      createdBy: str(r.created_by_name),
      decidedBy: str(r.decided_by_name),
    });
  }
  const w = obj(o.worker);
  return {
    summary: {
      owed: int(s.owed),
      overdue: int(s.overdue),
      nextDueAt: str(s.next_due_at),
      overdueSince: str(s.overdue_since),
      paidTotal: int(s.paid_total),
      pendingTotal: int(s.pending_total),
      pendingCount: int(s.pending_count),
      credit: int(s.credit),
    },
    dues,
    payments,
    suspended: w?.account_status === 'suspended',
  };
}

export const METHODS = ['jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'other', 'office_cash'] as const;
const METHOD_LABEL: Record<string, string> = { jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank: 'Bank transfer', sadapay: 'SadaPay', nayapay: 'NayaPay', other: 'Other', office_cash: 'Cash at the office' };

// ---- DHA's payment accounts (migration 0075): where workers send the money -----------------------------------------------------------

export const PAY_METHODS = ['jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'raast', 'other'] as const;
const PAY_METHOD_LABEL: Record<string, string> = { jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank: 'Bank account', sadapay: 'SadaPay', nayapay: 'NayaPay', raast: 'Raast ID', other: 'Other' };
export const payMethodLabel = (m: string): string => PAY_METHOD_LABEL[m] ?? m;
export const MAX_PAY_ACCOUNTS = 6;

export type PayAccount = { method: string; label: string; title: string; number: string };

/** The saved accounts as staff read them in Settings. Anything that does not look right is left out. */
export function parsePayAccounts(json: unknown): PayAccount[] {
  return arr(json).flatMap((item) => {
    const o = obj(item);
    const method = str(o?.method) ?? '';
    const number = (str(o?.number) ?? '').trim();
    if (!o || !(PAY_METHODS as readonly string[]).includes(method) || number === '') return [];
    return [{ method, label: (str(o.label) ?? '').trim(), title: (str(o.title) ?? '').trim(), number }];
  });
}

/**
 * The accounts typed into the Settings form: slots method1/label1/title1/number1 and so on. A slot with nothing in it is
 * skipped; a half-filled one is refused by name so staff know which to fix.
 */
export function payAccountsFromForm(get: (name: string) => string): { accounts: PayAccount[] } | { error: string } {
  const accounts: PayAccount[] = [];
  for (let i = 1; i <= MAX_PAY_ACCOUNTS; i++) {
    const method = get(`method${i}`).trim();
    const label = get(`label${i}`).trim();
    const title = get(`title${i}`).trim();
    const number = get(`number${i}`).trim();
    if (method === '' && label === '' && title === '' && number === '') continue;
    if (!(PAY_METHODS as readonly string[]).includes(method)) return { error: `Account ${i}: choose how workers pay.` };
    if (title === '') return { error: `Account ${i}: enter the account title (the name on the account).` };
    if (number.length < 3 || number.length > 40) return { error: `Account ${i}: enter the number (3 to 40 characters).` };
    if (title.length > 60) return { error: `Account ${i}: the account title is too long (60 characters).` };
    if (label.length > 40) return { error: `Account ${i}: the name is too long (40 characters).` };
    accounts.push({ method, label, title, number });
  }
  return { accounts };
}

/** A screenshot path is only used if it is exactly "<worker id>/dues/<file>": no traversal, nothing else in the bucket. */
export function safeProofPath(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/dues\/[A-Za-z0-9._-]{1,120}$/i.test(v) && !v.includes('..') ? v : null;
}
export const methodLabel = (m: string): string => METHOD_LABEL[m] ?? m;

/** Whole rupees from what staff typed ("1,250" or "Rs 1250"): 1 to 10,000,000, otherwise null. */
export function parseRupees(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/[,\s]|Rs\.?/gi, '');
  if (!/^[0-9]{1,8}$/.test(digits)) return null;
  const n = Number(digits);
  return n >= 1 && n <= 10_000_000 ? n : null;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** "in 3 days", "in 5 hours", "2 days ago", "just now": how far a due date is from now. */
export function whenText(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '-';
  const ms = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(ms)) return '-';
  const span = Math.abs(ms);
  const days = Math.floor(span / DAY);
  const text = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : span < HOUR ? '' : `${Math.floor(span / HOUR)} hour${Math.floor(span / HOUR) === 1 ? '' : 's'}`;
  if (text === '') return ms < 0 ? 'just now' : 'in under an hour';
  return ms < 0 ? `${text} ago` : `in ${text}`;
}
