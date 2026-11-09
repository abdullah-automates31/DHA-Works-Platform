// Pure rules for W11 My jobs and W12 Job status (unit tested with node --test). Everything here is derived from
// what the database already returns for the worker (worker_jobs plus the worker's own interest, quote and cash row).
// Times are the phone's local time. All sentences come from src/i18n/en.ts.
import { t } from '../../i18n/index.ts';

export type MyJob = {
  id: string;
  code: string;
  status: string;
  title: string;
  phase: number;
  lane: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  completedAt: string | null;
  isMine: boolean | null; // true only when this worker's quote was accepted
  myQuoteStatus: string | null;
  myQuoteTotal: number | null;
  residentName: string | null; // filled by the database only for the worker who won the job
  residentPhone: string | null;
  plotNo: string | null;
  floor: string | null;
  cancellationPending: boolean;
  cashRecorded?: boolean; // the worker has already entered the cash amount (since worker-only cash the job is then cash_collected; kept as a guard)
};

export type JobKind =
  | 'interested'
  | 'quoted'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cash_collected'
  | 'reviewed'
  | 'disputed'
  | 'cancelled'
  | 'expired'
  | 'not_chosen';

/** Where the worker stands on a job, from the job status, their quote and whether they won it. */
export function jobKind(job: Pick<MyJob, 'status' | 'isMine' | 'myQuoteStatus'>): JobKind {
  switch (job.status) {
    case 'cancelled':
      return 'cancelled';
    case 'expired':
      return 'expired';
    case 'open':
    case 'interested':
    case 'quoted':
      if (job.myQuoteStatus === 'sent') return 'quoted';
      if (job.myQuoteStatus === 'rejected') return 'not_chosen'; // a rejected worker cannot quote the same job again
      return 'interested';
    default: {
      if (job.isMine !== true) return 'not_chosen'; // somebody else's job now
      if (job.status === 'accepted' || job.status === 'scheduled') return 'scheduled';
      if (job.status === 'in_progress') return 'in_progress';
      if (job.status === 'completed') return 'completed';
      if (job.status === 'cash_collected') return 'cash_collected';
      if (job.status === 'reviewed') return 'reviewed';
      if (job.status === 'disputed') return 'disputed';
      return 'not_chosen';
    }
  }
}

// ---------------------------------------------------------------- tabs
export type MyJobsTab = 'active' | 'completed' | 'all';

const ACTIVE: JobKind[] = ['interested', 'quoted', 'scheduled', 'in_progress', 'completed', 'disputed'];
const FINISHED: JobKind[] = ['cash_collected', 'reviewed'];

/**
 * Active = anything that still needs the worker or is waiting (a completed job stays here until its cash is
 * recorded, as in the design). Completed = cash recorded or reviewed. All = everything, including jobs that were
 * cancelled, expired or given to another worker.
 */
export function inTab(kind: JobKind, tab: MyJobsTab): boolean {
  if (tab === 'all') return true;
  return (tab === 'active' ? ACTIVE : FINISHED).includes(kind);
}

const ORDER: JobKind[] = ['in_progress', 'scheduled', 'completed', 'disputed', 'quoted', 'interested', 'cash_collected', 'reviewed', 'not_chosen', 'cancelled', 'expired'];

/** Most urgent first; scheduled jobs by visit time; finished jobs newest first. */
export function sortJobs<T extends Pick<MyJob, 'status' | 'isMine' | 'myQuoteStatus' | 'scheduledStart' | 'completedAt'>>(jobs: readonly T[]): T[] {
  return [...jobs].sort((a, b) => {
    const ka = ORDER.indexOf(jobKind(a));
    const kb = ORDER.indexOf(jobKind(b));
    if (ka !== kb) return ka - kb;
    const kind = jobKind(a);
    if (kind === 'scheduled' || kind === 'in_progress') return time(a.scheduledStart) - time(b.scheduledStart);
    return time(b.completedAt ?? b.scheduledStart) - time(a.completedAt ?? a.scheduledStart);
  });
}

function time(iso: string | null | undefined): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

// ---------------------------------------------------------------- progress bar (9 segments, from the design)
export const SEGMENTS = 9;

/** Interested 3, Scheduled 5, In progress 6, Completed 7 (as drawn in W06 and W11); the rest continue the pattern. */
export function progressSegments(kind: JobKind): number {
  switch (kind) {
    case 'interested':
      return 3;
    case 'quoted':
      return 4;
    case 'scheduled':
      return 5;
    case 'in_progress':
      return 6;
    case 'completed':
      return 7;
    case 'cash_collected':
      return 8;
    case 'reviewed':
      return 9;
    default:
      return 0; // disputed, cancelled, expired, not chosen: no bar
  }
}

// ---------------------------------------------------------------- chips
export type ChipStyle = { label: string; bg: string; fg: string };

// Colours from the approved chip palette (SPEC.md: wait/quoted, scheduled, in progress, done, declined) and .c-open.
const MINT = { bg: '#DCEBE2', fg: '#0A3D28' };
export function chipFor(kind: JobKind): ChipStyle {
  switch (kind) {
    case 'interested':
      return { label: t('myjobs.chip.interested'), ...MINT };
    case 'quoted':
      return { label: t('myjobs.chip.quoted'), bg: '#F6E7B4', fg: '#5C4300' };
    case 'scheduled':
      return { label: t('myjobs.chip.scheduled'), bg: '#D6E6F7', fg: '#17406B' };
    case 'in_progress':
      return { label: t('myjobs.chip.inProgress'), bg: '#E5DDF5', fg: '#44297A' };
    case 'completed':
      return { label: t('myjobs.chip.completed'), bg: '#C9E8D5', fg: '#0A5530' };
    case 'cash_collected':
      return { label: t('myjobs.chip.cashCollected'), bg: '#C9E8D5', fg: '#0A5530' };
    case 'reviewed':
      return { label: t('myjobs.chip.reviewed'), bg: '#C9E8D5', fg: '#0A5530' };
    case 'disputed':
      return { label: t('myjobs.chip.underReview'), bg: '#FADCDA', fg: '#99191A' };
    case 'cancelled':
      return { label: t('myjobs.chip.cancelled'), bg: '#FADCDA', fg: '#99191A' };
    case 'expired':
      return { label: t('myjobs.chip.expired'), bg: '#FADCDA', fg: '#99191A' };
    case 'not_chosen':
      return { label: t('myjobs.chip.rejected'), bg: '#E6EBE8', fg: '#4F6A5C' };
  }
}

// ---------------------------------------------------------------- what the main button does
export type ActionKind = 'create_quote' | 'waiting' | 'change_quote' | 'start' | 'complete' | 'record_cash' | 'back' | 'find_jobs' | 'help';

/** The main action of a job in each state (the bottom button on W12; the call-to-action on a W11 card). */
export function primaryAction(kind: JobKind, cashRecorded = false, canChangeQuote = false): ActionKind {
  switch (kind) {
    case 'interested':
      return 'create_quote';
    case 'quoted':
      // 0044: until the customer decides, the worker may change their quote once (after the customer's call).
      return canChangeQuote ? 'change_quote' : 'waiting';
    case 'scheduled':
      return 'start';
    case 'in_progress':
      return 'complete';
    case 'completed':
      return cashRecorded ? 'waiting' : 'record_cash';
    case 'cash_collected':
    case 'reviewed':
      return 'back';
    case 'disputed':
      return 'help';
    default:
      return 'find_jobs';
  }
}

/** A job can be reported from the moment it starts until 7 days after completion (docs/DECISIONS.md). */
export function canReport(kind: JobKind): boolean {
  return kind === 'in_progress' || kind === 'completed' || kind === 'cash_collected' || kind === 'reviewed' || kind === 'disputed';
}

const REPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The worker's jobs that can still be reported: reportable status and, once completed, within 7 days of completion. */
export function reportableJobs(jobs: readonly MyJob[], now: Date): MyJob[] {
  return jobs.filter((job) => {
    if (!canReport(jobKind(job))) return false;
    if (!job.completedAt) return true;
    return now.getTime() - new Date(job.completedAt).getTime() <= REPORT_WINDOW_MS;
  });
}

/** A cancellation request can be filed on an accepted job that has not finished (docs/FEATURES.md, W18). */
export function canRequestCancellation(kind: JobKind, pending: boolean): boolean {
  return !pending && (kind === 'scheduled' || kind === 'in_progress');
}

// ---------------------------------------------------------------- dates and times
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function dayDiff(a: Date, b: Date): number {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(a) - start(b)) / 86_400_000);
}

/** "Sat 24 Oct, 9:40 AM" for the timeline. */
export function stamp(iso: string | null | undefined): string {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return '';
  return `${WEEKDAYS[t.getDay()]} ${t.getDate()} ${MONTHS[t.getMonth()]}, ${clock(t)}`;
}

/** "10:30 AM". */
export function clockText(iso: string | null | undefined): string {
  const t = iso ? new Date(iso) : null;
  return !t || Number.isNaN(t.getTime()) ? '' : clock(t);
}

/** "today", "tomorrow" or "Sat 24 Oct". */
export function dayWord(iso: string | null | undefined, now: Date = new Date()): string {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return '';
  const diff = dayDiff(t, now);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return `${WEEKDAYS[t.getDay()]} ${t.getDate()} ${MONTHS[t.getMonth()]}`;
}

function hourRange(a: Date, b: Date | null): string {
  const hour = (d: Date) => ({ n: d.getHours() % 12 === 0 ? 12 : d.getHours() % 12, p: d.getHours() < 12 ? 'AM' : 'PM', m: d.getMinutes() });
  const text = (d: Date) => {
    const h = hour(d);
    return h.m === 0 ? `${h.n}` : `${h.n}:${String(h.m).padStart(2, '0')}`;
  };
  if (!b) return `${text(a)} ${hour(a).p}`;
  return hour(a).p === hour(b).p ? `${text(a)} to ${text(b)} ${hour(b).p}` : `${text(a)} ${hour(a).p} to ${text(b)} ${hour(b).p}`;
}

/** "11 AM to 1 PM". */
export function windowText(start: string | null | undefined, end: string | null | undefined): string {
  const a = start ? new Date(start) : null;
  if (!a || Number.isNaN(a.getTime())) return '';
  const b = end ? new Date(end) : null;
  return hourRange(a, b && !Number.isNaN(b.getTime()) ? b : null);
}

/** "Today, 11 AM to 1 PM" / "Tomorrow, ..." / "Sat 24 Oct, ..." for a card. */
export function visitLine(start: string | null | undefined, end: string | null | undefined, now: Date = new Date()): string {
  const day = dayWord(start, now);
  const win = windowText(start, end);
  if (!day || !win) return '';
  const label = day === 'today' || day === 'tomorrow' || day === 'yesterday' ? day.charAt(0).toUpperCase() + day.slice(1) : day;
  return `${label}, ${win}`;
}

// ---------------------------------------------------------------- the W12 timeline
export type TimelineStep = { label: string; sub: string; state: 'done' | 'current' | 'todo' | 'stop' };

export type TimelineInput = {
  kind: JobKind;
  interestAt: string | null;
  quoteAt: string | null;
  quoteTotal: number | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cashAmount: number | null;
};

const baseLabels = (): string[] => [
  t('myjobs.chip.interested'),
  t('myjobs.chip.quoted'),
  t('myjobs.chip.scheduled'),
  t('myjobs.chip.inProgress'),
  t('myjobs.chip.completed'),
  t('myjobs.chip.cashCollected'),
  t('myjobs.step.review'),
];
// The step a job is on. A step that has been reached and finished is done (green tick): once the worker completes the job,
// "Completed" is done and "Cash collected" is the one waiting; once the cash is in, "Cash collected" is done too.
const AT: Partial<Record<JobKind, number>> = { interested: 0, quoted: 1, scheduled: 2, in_progress: 3, completed: 5, cash_collected: 6, reviewed: 7 };

function rupees(n: number): string {
  return `Rs ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** The furthest stage the job actually reached, for jobs that stopped (cancelled, expired, not chosen, disputed). */
function reached(i: TimelineInput): number {
  if (i.completedAt) return 4;
  if (i.startedAt) return 3;
  if (i.scheduledStart) return 2;
  if (i.quoteAt) return 1;
  return 0;
}

export function timeline(i: TimelineInput): TimelineStep[] {
  const subs: Record<number, string> = {
    0: stamp(i.interestAt),
    1: i.quoteTotal !== null && i.quoteAt ? t('myjobs.sub.quoteSent', { amount: rupees(i.quoteTotal), time: clockText(i.quoteAt) }) : '',
    2: i.scheduledStart ? `${stamp(i.scheduledStart).split(',')[0]}, ${windowText(i.scheduledStart, i.scheduledEnd)}` : '',
    3: i.startedAt ? t('myjobs.sub.started', { time: clockText(i.startedAt) }) : '',
    4: i.completedAt ? t('myjobs.sub.finished', { time: clockText(i.completedAt) }) : '',
    5: i.cashAmount !== null ? t('myjobs.sub.cashIn', { amount: rupees(i.cashAmount) }) : '',
    6: t('myjobs.sub.rated'),
  };

  const stops: Partial<Record<JobKind, { label: string; sub: string }>> = {
    disputed: { label: t('myjobs.stop.problemLabel'), sub: t('myjobs.stop.problemSub') },
    cancelled: { label: t('myjobs.chip.cancelled'), sub: t('myjobs.stop.cancelledSub') },
    expired: { label: t('myjobs.chip.expired'), sub: t('myjobs.stop.expiredSub') },
    not_chosen: { label: t('myjobs.chip.rejected'), sub: t('myjobs.stop.rejectedSub') },
  };
  const stop = stops[i.kind];
  if (stop) {
    const upTo = i.kind === 'disputed' ? 4 : reached(i);
    const steps: TimelineStep[] = baseLabels().slice(0, upTo + 1).map((label, n) => ({ label, sub: subs[n] ?? '', state: 'done' as const }));
    steps.push({ label: stop.label, sub: stop.sub, state: 'stop' });
    return steps;
  }

  const at = AT[i.kind] ?? 0;
  return baseLabels().map((label, n) => {
    // The customer's rating is not something the worker acts on: until it arrives the Review step is simply still to come.
    const state = n < at ? 'done' : n === at && i.kind !== 'cash_collected' ? 'current' : 'todo';
    // The Review step only says anything once the job is closed; future steps show no detail.
    const sub = state === 'todo' ? '' : n === 6 && i.kind !== 'reviewed' ? '' : (subs[n] ?? '');
    return { label, sub, state } as TimelineStep;
  });
}

// ---------------------------------------------------------------- the W12 note card (headline and body)
export type Note = { headline: string; body: string };

/** Wording follows the design, with the decided corrections: no contact before acceptance, no re-quote after a rejection. */
export function noteFor(job: MyJob, kind: JobKind, now: Date = new Date()): Note {
  const who = job.residentName ? shortName(job.residentName) : t('myjobs.note.theCustomer');
  switch (kind) {
    case 'interested':
      return { headline: t('myjobs.note.interestedHead'), body: t('myjobs.note.interestedBody') };
    case 'quoted':
      return { headline: t('myjobs.note.quotedHead'), body: t('myjobs.note.quotedBody') };
    case 'scheduled': {
      const day = dayWord(job.scheduledStart, now);
      const when = day ? t('myjobs.note.visit', { day, window: windowText(job.scheduledStart, job.scheduledEnd) }) : t('myjobs.note.visitTbc');
      const place = [t('myjobs.note.placePhase', { phase: job.phase }), job.lane, job.plotNo ? t('myjobs.note.placeHouse', { plot: job.plotNo }) : '', job.floor ? t('myjobs.note.placeFloor', { floor: job.floor }) : ''].filter(Boolean).join(', ');
      // The customer chose the time; the worker cannot change it. A delay is handled by phone, not in the app.
      const guide = day ? t('myjobs.note.guideFixed') : t('myjobs.note.guideOpen');
      return { headline: when, body: t('myjobs.note.scheduledBody', { place, guide }) };
    }
    case 'in_progress':
      return { headline: t('myjobs.note.inProgressHead'), body: t('myjobs.note.inProgressBody') };
    case 'completed':
      if (job.cashRecorded) return { headline: t('myjobs.note.cashRecordedHead'), body: t('myjobs.note.cashRecordedBody', { who }) };
      return { headline: t('myjobs.note.cashDueHead'), body: t('myjobs.note.cashDueBody', { who }) };
    case 'cash_collected':
      return { headline: t('myjobs.note.ratingHead'), body: t('myjobs.note.ratingBody', { who: capitalize(who) }) };
    case 'reviewed':
      return { headline: t('myjobs.note.reviewedHead'), body: t('myjobs.note.reviewedBody') };
    case 'disputed':
      return { headline: t('myjobs.note.disputedHead'), body: t('myjobs.note.disputedBody') };
    case 'cancelled':
      return { headline: t('myjobs.note.cancelledHead'), body: t('myjobs.note.cancelledBody') };
    case 'expired':
      return { headline: t('myjobs.note.expiredHead'), body: t('myjobs.note.expiredBody') };
    case 'not_chosen':
      return { headline: t('myjobs.note.rejectedHead'), body: t('myjobs.note.rejectedBody') };
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Hira Farooq" -> "Hira F."; only used after the quote was accepted (the database sends no name before). */
export function shortName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  return `${parts[0]} ${Array.from(parts[parts.length - 1] ?? '')[0]?.toUpperCase() ?? ''}.`;
}

export function initials(fullName: string | null | undefined): string {
  return (fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => Array.from(p)[0] ?? '')
    .join('')
    .toUpperCase();
}

/** A phone number the worker may call: only after acceptance, digits and a leading +. */
export function dialable(phone: string | null | undefined): string | null {
  const clean = (phone ?? '').replace(/[^\d+]/g, '');
  return /^\+?\d{7,15}$/.test(clean) ? clean : null;
}
