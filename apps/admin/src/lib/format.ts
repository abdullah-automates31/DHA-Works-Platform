// Display helpers shared by the operations screens. Pure, no network: unit tested. All times are shown in Karachi time.
export type Tone = 'ok' | 'wait' | 'red' | 'blue' | 'pur' | 'gray';

const TZ = 'Asia/Karachi';
// Month names are our own so the text does not change with the Node/ICU version (some print "Sept").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (n: string) => MONTHS[Number(n) - 1] ?? '';

export function rupees(n: number | null | undefined): string {
  return n === null || n === undefined ? 'No quote' : `Rs ${Math.round(n).toLocaleString('en-US')}`;
}

/** "12 min ago", "3 h ago", "1 day ago", "2 days ago". */
export function ago(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '-';
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

/** "24 Oct, 9:40 AM" in Karachi time. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '-';
  const p = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')} ${monthName(g('month'))}, ${g('hour')}:${g('minute')} ${g('dayPeriod').toUpperCase()}`;
}

/** "12 Sep 2026" in Karachi time. */
export function dateOnly(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '-';
  const p = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: TZ }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')} ${monthName(g('month'))} ${g('year')}`;
}

/** "11:08 AM" in Karachi time. */
export function timeOnly(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '-';
  const p = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('hour')}:${g('minute')} ${g('dayPeriod').toUpperCase()}`;
}

/** snake_case or kebab text as a sentence: "cash_price" becomes "Cash price". */
export function sentence(s: string | null | undefined): string {
  const t = (s ?? '').replace(/[_-]+/g, ' ').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : '';
}

// ------------------------------------------------------------------------------------------------- jobs
export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'gray' },
  interested: { label: 'Interested', tone: 'ok' },
  quoted: { label: 'Quoted', tone: 'wait' },
  accepted: { label: 'Scheduled', tone: 'blue' },
  scheduled: { label: 'Scheduled', tone: 'blue' },
  in_progress: { label: 'In progress', tone: 'pur' },
  completed: { label: 'Completed', tone: 'ok' },
  cash_collected: { label: 'Cash collected', tone: 'ok' },
  reviewed: { label: 'Reviewed', tone: 'ok' },
  disputed: { label: 'Disputed', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
  expired: { label: 'Expired', tone: 'gray' },
};

export function jobStatus(status: string): { label: string; tone: Tone } {
  return JOB_STATUS[status] ?? { label: sentence(status) || 'Unknown', tone: 'gray' };
}

/** Filter pills on the jobs screen, in the order of the design. */
export const JOB_FILTERS = ['open', 'interested', 'quoted', 'scheduled', 'in_progress', 'completed', 'cash_collected', 'disputed', 'cancelled', 'expired'] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];

/** Grouped stages (migration 0063, p_stage): the same groups the dashboard counts. */
export const JOB_STAGES = {
  open: 'Open for quotes (open, interested, quoted)',
  scheduled: 'Scheduled',
  cash_collected: 'Cash collected (incl. reviewed)',
} as const;
export type JobStage = keyof typeof JOB_STAGES;

export function parseJobStage(v: unknown): JobStage | null {
  return typeof v === 'string' && Object.hasOwn(JOB_STAGES, v) ? (v as JobStage) : null;
}

export function parseJobFilter(v: unknown): JobFilter | null {
  return (JOB_FILTERS as readonly string[]).includes(v as string) ? (v as JobFilter) : null;
}

/** Where the job is on the progress line of the job screen. */
export const PROGRESS_STEPS = ['Interested', 'Quoted', 'Scheduled', 'In progress', 'Completed', 'Cash collected', 'Review'] as const;

/** How many progress steps are done for a status (the next one is "now"). Cancelled and expired jobs have their own line. */
export function progressDone(status: string): number {
  switch (status) {
    case 'open': return 0;
    case 'interested': return 1;
    case 'quoted': return 2;
    case 'accepted':
    case 'scheduled': return 3;
    case 'in_progress': return 4;
    case 'completed':
    case 'disputed': return 5;
    case 'cash_collected': return 6;
    case 'reviewed': return 7;
    default: return 0;
  }
}

export const UNDER_REVIEW_TEXT: Record<string, string> = {
  worker_suspended: 'The worker is suspended',
  report_unsafe: 'An unsafe report is open',
  report_cash_price: 'A cash or price report is open',
};
export function underReviewText(reason: string | null): string | null {
  return reason ? (UNDER_REVIEW_TEXT[reason] ?? sentence(reason)) : null;
}

// ----------------------------------------------------------------------------------------------- reports
export const REPORT_KIND: Record<string, { label: string; tone: Tone }> = {
  unsafe: { label: 'Unsafe', tone: 'red' },
  cash_price: { label: 'Cash and price', tone: 'blue' },
  no_show: { label: 'No show', tone: 'wait' },
  poor_work: { label: 'Poor work', tone: 'gray' },
  rude_damage: { label: 'Rude or damage', tone: 'pur' },
  other: { label: 'Other', tone: 'gray' },
};
export const REPORT_KIND_KEYS = ['unsafe', 'cash_price', 'no_show', 'poor_work', 'rude_damage'] as const;

export function reportKind(kind: string): { label: string; tone: Tone } {
  return REPORT_KIND[kind] ?? { label: sentence(kind) || 'Other', tone: 'gray' };
}

export const REPORT_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'red' },
  in_review: { label: 'In review', tone: 'pur' },
  resolved: { label: 'Resolved', tone: 'ok' },
};
export function reportStatus(status: string): { label: string; tone: Tone } {
  return REPORT_STATUS[status] ?? { label: sentence(status), tone: 'gray' };
}

export const REPORT_ACTION_TEXT: Record<string, string> = {
  no_action: 'Closed with no action',
  warning: 'Warning sent',
  suspend: 'Account suspended',
};

export const CANCEL_REASON_TEXT: Record<string, string> = {
  schedule_conflict: 'Schedule conflict',
  no_longer_needed: 'No longer needed',
  price_dispute: 'Price dispute',
  safety_concern: 'Safety concern',
  worker_unavailable: 'Worker unavailable',
  other: 'Other',
};

// ----------------------------------------------------------------------------------------------- phones
/** 0321 555 0114 for an 11-digit local number, otherwise as stored. A tel: link keeps digits and a leading plus only. */
export function phoneText(phone: string | null): string {
  if (!phone) return 'No phone';
  const digits = phone.replace(/[^0-9]/g, '');
  return /^0[0-9]{10}$/.test(digits) ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : phone;
}

export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const t = phone.trim();
  const clean = (t.startsWith('+') ? '+' : '') + t.replace(/[^0-9]/g, '');
  return /^\+?[0-9]{5,15}$/.test(clean) ? `tel:${clean}` : null;
}

export function firstName(name: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'them';
}

// ----------------------------------------------------------------------------------------------- paging
export const PAGE_SIZE = 25;

/** A whole number from the address bar, or the fallback. Never negative, never NaN. */
export function pageNumber(value: unknown): number {
  if (typeof value !== 'string' || !/^[0-9]{1,6}$/.test(value)) return 1;
  const n = Number(value);
  return n >= 1 && n <= 10000 ? n : 1;
}

export function lastPage(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** One search parameter from the address bar: trimmed, capped at 80 characters. */
export function searchText(value: unknown): string {
  return (typeof value === 'string' ? value : '').trim().slice(0, 80);
}

/** An address with only the parameters that carry a value. */
export function buildHref(base: string, params: Record<string, string | number | null | undefined | false>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== false && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}
