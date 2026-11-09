// Pure rules for the worker's arrival window (0044): when the worker claims a job, or changes their quote once, they
// say when they will come: a day plus "from" and "to" in 30-minute steps. Times are the phone's local time, like the
// rest of the app; they are sent as ISO timestamps so the database stores the exact moment. Unit tested with node --test.
import { t } from '../../i18n/index.ts';
import { shortDate, timeRange } from '../feed/format.ts';

/** A day as "YYYY-MM-DD" and two times as "HH:MM" (phone local time). */
export type VisitChoice = { day: string; from: string; to: string };

export type VisitError = 'past' | 'order' | 'long';

export const DAYS_AHEAD = 7;
const FIRST_SLOT = 7 * 60; // 07:00
const LAST_SLOT = 22 * 60; // 22:00
const STEP = 30;
const DEFAULT_LENGTH = 120; // a two-hour window unless the customer asked for another
const MAX_LENGTH = 12 * 60; // the database refuses longer windows

const two = (n: number) => String(n).padStart(2, '0');
const minutesOf = (hhmm: string) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
};
const hhmm = (minutes: number) => `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
export const isoDay = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const atLocal = (day: string, time: string) => {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const mins = minutesOf(time);
  return new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60);
};

/** "09:00" -> "9 AM", "13:30" -> "1:30 PM": a chip label. */
export function clockLabel(time: string): string {
  const m = minutesOf(time);
  const h = Math.floor(m / 60);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${m % 60 === 0 ? hour12 : `${hour12}:${two(m % 60)}`} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Today and the next days the worker can pick, labelled "Today", "Tomorrow", then "Wed 12 Nov". */
export function dayOptions(now: Date = new Date()): { value: string; label: string }[] {
  return Array.from({ length: DAYS_AHEAD }, (_, n) => {
    const value = isoDay(addDays(now, n));
    const label = n === 0 ? t('visit.today') : n === 1 ? t('visit.tomorrow') : shortDate(value);
    return { value, label };
  });
}

/** Start times on [day]: every half hour 07:00-21:30, and on today only those still ahead (30 minutes' notice). */
export function fromSlots(day: string, now: Date = new Date()): string[] {
  const slots: string[] = [];
  for (let m = FIRST_SLOT; m < LAST_SLOT; m += STEP) slots.push(hhmm(m));
  if (day !== isoDay(now)) return slots;
  const earliest = now.getHours() * 60 + now.getMinutes() + 30;
  return slots.filter((s) => minutesOf(s) >= earliest);
}

/** End times after [from]: every half hour up to 22:00 and at most 12 hours later. */
export function toSlots(from: string): string[] {
  const start = minutesOf(from);
  const slots: string[] = [];
  for (let m = start + STEP; m <= Math.min(LAST_SLOT, start + MAX_LENGTH); m += STEP) slots.push(hhmm(m));
  return slots;
}

const snapUp = (minutes: number) => Math.ceil(minutes / STEP) * STEP;

/**
 * The window the form starts with: the customer's own day and window when they asked for one that is still ahead,
 * otherwise the next free half hour today (or 09:00 tomorrow when today is over), two hours long.
 */
export function defaultVisit(
  preferred: { date: string | null; from: string | null; to: string | null },
  now: Date = new Date(),
): VisitChoice {
  if (preferred.date && preferred.date >= isoDay(now)) {
    const slots = fromSlots(preferred.date, now);
    const wanted = preferred.from ? hhmm(Math.min(snapUp(minutesOf(preferred.from)), LAST_SLOT - STEP)) : '09:00';
    const from = slots.includes(wanted) ? wanted : slots[0];
    if (from) {
      const ends = toSlots(from);
      const wantedTo = preferred.to ? hhmm(snapUp(minutesOf(preferred.to))) : hhmm(minutesOf(from) + DEFAULT_LENGTH);
      return { day: preferred.date, from, to: ends.includes(wantedTo) ? wantedTo : twoHoursOn(from) };
    }
  }
  const today = isoDay(now);
  const first = fromSlots(today, now)[0];
  if (first) return { day: today, from: first, to: twoHoursOn(first) };
  return { day: isoDay(addDays(now, 1)), from: '09:00', to: '11:00' };
}

/** The default end: two hours after [from], or the latest end allowed that day. */
export function twoHoursOn(from: string): string {
  const ends = toSlots(from);
  return ends[Math.min(3, ends.length - 1)] ?? from;
}

/** Why the window cannot be sent, or null. Mirrors private.check_visit_window. */
export function visitError(choice: VisitChoice, now: Date = new Date()): VisitError | null {
  const start = atLocal(choice.day, choice.from);
  const end = atLocal(choice.day, choice.to);
  if (start.getTime() <= now.getTime()) return 'past';
  if (end.getTime() <= start.getTime()) return 'order';
  if (end.getTime() - start.getTime() > MAX_LENGTH * 60_000) return 'long';
  return null;
}

/** The two arguments accept_job and revise_quote take. */
export function visitArgs(choice: VisitChoice): { p_visit_start: string; p_visit_end: string } {
  return { p_visit_start: atLocal(choice.day, choice.from).toISOString(), p_visit_end: atLocal(choice.day, choice.to).toISOString() };
}

/** A stored window back into the picker's terms (to change a quote), or null when there is none. */
export function choiceFromRange(start: string | null, end: string | null): VisitChoice | null {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  return { day: isoDay(s), from: hhmm(s.getHours() * 60 + s.getMinutes()), to: hhmm(e.getHours() * 60 + e.getMinutes()) };
}

/** "Today, 10 to 12 PM" / "Wed 12 Nov, 4 to 6 PM" for a stored window. */
export function visitText(start: string | null, end: string | null, now: Date = new Date()): string {
  const choice = choiceFromRange(start, end);
  if (!choice) return '';
  const day = choice.day === isoDay(now) ? t('visit.today') : choice.day === isoDay(addDays(now, 1)) ? t('visit.tomorrow') : shortDate(choice.day);
  return `${day}, ${timeRange(choice.from, choice.to)}`;
}
