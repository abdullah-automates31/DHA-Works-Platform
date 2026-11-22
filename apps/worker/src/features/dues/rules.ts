// Pure rules for My Dues (unit tested with node --test): reads what my_dues() returns (migration 0071) and words it for the
// screen, checks the "I have paid" form, and maps the database's refusals to friendly messages. The database is the authority
// for every amount and every rule; nothing here decides who owes what.
import { t } from '../../i18n/index.ts';
import { MAX_FILE_BYTES } from '../documents/files.ts';
import { formatRupees } from '../home/format.ts';
import { dateText } from '../myreports/rules.ts';

export type DueStatus = 'due' | 'overdue' | 'paid' | 'waived';
export type PaymentMethod = 'jazzcash' | 'easypaisa' | 'bank' | 'sadapay' | 'nayapay' | 'other';
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

/** One place a worker can pay DHA (staff enter these in the portal; migration 0075). */
export type PayAccount = { method: string; label: string; title: string; number: string };

export type MyDues = {
  accountStatus: 'active' | 'suspended';
  suspensionReason: string;
  suspendedUntil: string | null;
  summary: DuesSummary;
  payTo: string;
  payAccounts: PayAccount[];
  helpline: string | null;
  dues: DueRow[];
  payments: DuesPayment[];
};

const DAY = 86_400_000;
const HOUR = 3_600_000;

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The due cards of an answer (my_dues or search_my_dues). A row that does not look right is skipped. */
export function parseDueList(json: unknown): DueRow[] {
  const dues: DueRow[] = [];
  for (const raw of Array.isArray(json) ? json : []) {
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
  return dues;
}

/** The payment cards of an answer. */
export function parsePaymentList(json: unknown): DuesPayment[] {
  const payments: DuesPayment[] = [];
  for (const raw of Array.isArray(json) ? json : []) {
    const r = obj(raw);
    const status = r?.status;
    if (!r || typeof r.id !== 'string' || (status !== 'pending' && status !== 'confirmed' && status !== 'rejected')) continue;
    payments.push({ id: r.id, amount: num(r.amount), method: str(r.method), reference: str(r.reference), status, createdAt: str(r.created_at), reason: str(r.reason), byStaff: r.by_staff === true });
  }
  return payments;
}

/** From this many cards (dues and payments together) My Dues shows a search box. */
export const SEARCH_FROM = 5;

/** What is sent to the search: spaces tidied, at most 40 characters. */
export function searchText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** Reads the answer of search_my_dues(): the matching dues and payments. */
export function parseSearch(json: unknown): { dues: DueRow[]; payments: DuesPayment[] } | null {
  const o = obj(json);
  if (!o) return null;
  return { dues: parseDueList(o.dues), payments: parsePaymentList(o.payments) };
}

/** Reads the answer of my_dues(). A row that does not look right is skipped, never guessed at. */
export function parseMyDues(json: unknown): MyDues | null {
  const o = obj(json);
  const s = obj(o?.summary);
  const a = obj(o?.account);
  if (!o || !s || !a) return null;
  const dues = parseDueList(o.dues);
  const payments = parsePaymentList(o.payments);
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
    payAccounts: parsePayAccounts(o.pay_accounts),
    helpline: typeof o.helpline === 'string' && o.helpline.trim() !== '' ? o.helpline.trim() : null,
    dues,
    payments,
  };
}

/** DHA's accounts; an entry without a number or a way to pay is left out. */
export function parsePayAccounts(json: unknown): PayAccount[] {
  if (!Array.isArray(json)) return [];
  const out: PayAccount[] = [];
  for (const item of json) {
    const o = obj(item);
    if (!o) continue;
    const method = str(o.method).trim();
    const number = str(o.number).trim();
    if (method === '' || number === '') continue;
    out.push({ method, label: str(o.label).trim(), title: str(o.title).trim(), number });
  }
  return out;
}

/** "Easypaisa", or "Bank - HBL" when staff named the bank. */
export function accountName(a: PayAccount): string {
  const m = methodLabel(a.method);
  return a.label !== '' ? `${m} - ${a.label}` : m;
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

/**
 * The payment DHA turned down, when it is the worker's latest one (newest first, as my_dues returns them). Once the worker
 * sends another payment, or DHA decides a newer one, the message goes away: it only says what still needs a new try.
 */
export function latestRejection(payments: DuesPayment[]): DuesPayment | null {
  const latest = payments[0];
  return latest && latest.status === 'rejected' ? latest : null;
}

export function methodLabel(method: string): string {
  switch (method) {
    case 'jazzcash':
      return t('dues.methodJazzcash');
    case 'easypaisa':
      return t('dues.methodEasypaisa');
    case 'bank':
      return t('dues.methodBank');
    case 'raast':
      return t('dues.methodRaast');
    case 'sadapay':
      return t('dues.methodSadapay');
    case 'nayapay':
      return t('dues.methodNayapay');
    case 'other':
      return t('dues.methodOther');
    case 'office_cash':
      return t('dues.methodOffice');
    default:
      return method;
  }
}

// ---- the "I have paid" form ----------------------------------------------------------------------------------------------------

export const METHODS: readonly PaymentMethod[] = ['jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'other'];
export const REFERENCE_MIN = 3;
export const REFERENCE_MAX = 60;

/** The screenshot of the payment: the picked photo, already re-encoded by the picker. */
export type ProofPhoto = { bytes: ArrayBuffer; mime: string };
export type PaymentInput = { amount: string; method: PaymentMethod | null; reference: string; proof: ProofPhoto | null };
export type PaymentArgs = { p_amount: number; p_method: PaymentMethod; p_reference: string; p_proof_path: string };
export type PaymentCheck =
  | { ok: true; args: Omit<PaymentArgs, 'p_proof_path'>; proof: ProofPhoto }
  | { ok: false; field: 'amount' | 'method' | 'reference' | 'proof'; key: DuesErrorKey };

export type DuesErrorKey =
  | 'dues.errors.amount'
  | 'dues.errors.method'
  | 'dues.errors.reference'
  | 'dues.errors.proof'
  | 'dues.errors.proofFile'
  | 'dues.errors.proofUpload'
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
  if (!input.proof) return { ok: false, field: 'proof', key: 'dues.errors.proof' };
  if (!PROOF_EXTENSIONS[input.proof.mime.toLowerCase()] || input.proof.bytes.byteLength <= 0 || input.proof.bytes.byteLength > MAX_FILE_BYTES) {
    return { ok: false, field: 'proof', key: 'dues.errors.proofFile' };
  }
  return { ok: true, args: { p_amount: amount, p_method: input.method, p_reference: reference }, proof: input.proof };
}

const PROOF_EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Where the screenshot goes: the worker's own folder of the dues-proof bucket (the database checks the same shape). */
export function buildProofPath(userId: string, mime: string, now: number = Date.now(), random: string = Math.random().toString(16).slice(2, 10)): string {
  return `${userId}/dues/${now}-${random}.${PROOF_EXTENSIONS[mime.toLowerCase()] ?? 'jpg'}`;
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
  if (m.includes('screenshot')) return 'dues.errors.proof';
  return 'dues.errors.generic';
}

export type PaymentClient = {
  upload: (path: string, bytes: ArrayBuffer, mime: string) => PromiseLike<{ error: { message: string } | null }>;
  submit: (args: PaymentArgs) => PromiseLike<{ error: { message: string } | null }>;
};

/** Uploads the screenshot, then sends the payment with its path. A screenshot that cannot be uploaded stops everything: nothing is sent. */
export async function sendPayment(
  client: PaymentClient,
  input: { userId: string; args: Omit<PaymentArgs, 'p_proof_path'>; proof: ProofPhoto; now?: number; random?: string },
): Promise<{ ok: true } | { ok: false; key: DuesErrorKey }> {
  try {
    const path = buildProofPath(input.userId, input.proof.mime, input.now, input.random);
    const up = await client.upload(path, input.proof.bytes, input.proof.mime.toLowerCase());
    if (up.error) return { ok: false, key: 'dues.errors.proofUpload' };
    const { error } = await client.submit({ ...input.args, p_proof_path: path });
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

// ---- one due in full (my_due_detail, migration 0074) -------------------------------------------------------------------------

export type DueDetail = {
  due: { id: string; fee: number; paid: number; remaining: number; accruedAt: string; dueAt: string; status: DueStatus; waiveReason: string };
  job: { id: string; code: string; title: string; description: string; category: string; phase: number; lane: string; completedAt: string | null; scheduledStart: string | null };
  money: { labour: number; materials: number; total: number; fee: number; earned: number; cashRecorded: number | null; cashRecordedAt: string | null };
  owedTotal: number;
};

/** Reads the answer of my_due_detail(). Anything that does not look right makes the whole answer null. */
export function parseDueDetail(json: unknown): DueDetail | null {
  const o = obj(json);
  const d = obj(o?.due);
  const j = obj(o?.job);
  const m = obj(o?.money);
  if (!o || !d || !j || !m || typeof d.id !== 'string' || typeof j.id !== 'string') return null;
  const status = d.status;
  if (status !== 'due' && status !== 'overdue' && status !== 'paid' && status !== 'waived') return null;
  return {
    due: { id: d.id, fee: num(d.fee), paid: num(d.paid), remaining: num(d.remaining), accruedAt: str(d.accrued_at), dueAt: str(d.due_at), status, waiveReason: str(d.waive_reason) },
    job: {
      id: j.id,
      code: str(j.code),
      title: str(j.title),
      description: str(j.description),
      category: str(j.category),
      phase: num(j.phase),
      lane: str(j.lane),
      completedAt: typeof j.completed_at === 'string' ? j.completed_at : null,
      scheduledStart: typeof j.scheduled_start === 'string' ? j.scheduled_start : null,
    },
    money: {
      labour: num(m.labour),
      materials: num(m.materials),
      total: num(m.total),
      fee: num(m.fee),
      earned: num(m.earned),
      cashRecorded: typeof m.cash_recorded === 'number' ? m.cash_recorded : null,
      cashRecordedAt: typeof m.cash_recorded_at === 'string' ? m.cash_recorded_at : null,
    },
    owedTotal: num(o.owed_total),
  };
}

/** "Phase 6, Lane 8" (the lane is left out when the job has none). */
export function whereText(phase: number, lane: string): string {
  const p = t('dues.detail.phase', { phase: String(phase) });
  return lane.trim() === '' ? p : `${p}, ${t('dues.detail.lane', { lane: lane.trim() })}`;
}
