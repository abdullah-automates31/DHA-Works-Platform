// Pure rules for the worker's visiting time (0044, simplified 16 Nov): when the worker claims a job, or changes their
// quote once, they say WHEN they will come: a day and ONE visiting time in 30-minute steps (no "from" and "to"; the
// worker and the customer cannot know when the work ends). Times are the phone's local time; they are sent as ISO
// timestamps so the database stores the exact moment. The database still keeps a start and an end, so the app sends
// the end as one hour after the start and shows only the start. Unit tested with node --test.
import { t } from '../../i18n/index.ts';
import { shortDate } from '../feed/format.ts';

/** A day as "YYYY-MM-DD" and the visiting time as "HH:MM" (phone local time). */
export type VisitChoice = { day: string; time: string };

export type VisitError = 'past';

export const DAYS_AHEAD = 7;
const FIRST_SLOT = 7 * 60; // 07:00
const LAST_SLOT = 21 * 60; // 21:00 (the stored end is one hour later, so never after 22:00)
const STEP = 30;
const NOTICE = 30; // minutes of notice on today
export const VISIT_LENGTH_MINUTES = 60; // the end the database keeps next to the start

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

/** "09:00" -> "9 AM", "13:30" -> "1:30 PM": a button label. */
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

/** Visiting times on [day]: every half hour 07:00-21:00, and on today only those still ahead (30 minutes' notice). */
export function timeSlots(day: string, now: Date = new Date()): string[] {
  const slots: string[] = [];
  for (let m = FIRST_SLOT; m <= LAST_SLOT; m += STEP) slots.push(hhmm(m));
  if (day !== isoDay(now)) return slots;
  const earliest = now.getHours() * 60 + now.getMinutes() + NOTICE;
  return slots.filter((s) => minutesOf(s) >= earliest);
}

const snapUp = (minutes: number) => Math.ceil(minutes / STEP) * STEP;

/**
 * The time the form starts with: the customer's own day and start time when they asked for one that is still ahead,
 * otherwise the next free half hour today (or 09:00 tomorrow when today is over).
 */
export function defaultVisit(
  preferred: { date: string | null; from: string | null; to?: string | null },
  now: Date = new Date(),
): VisitChoice {
  if (preferred.date && preferred.date >= isoDay(now)) {
    const slots = timeSlots(preferred.date, now);
    const wanted = preferred.from ? hhmm(Math.min(snapUp(minutesOf(preferred.from)), LAST_SLOT)) : '09:00';
    const time = slots.includes(wanted) ? wanted : slots[0];
    if (time) return { day: preferred.date, time };
  }
  const today = isoDay(now);
  const first = timeSlots(today, now)[0];
  if (first) return { day: today, time: first };
  return { day: isoDay(addDays(now, 1)), time: '09:00' };
}

/** Why the time cannot be sent, or null. Mirrors private.check_visit_window. */
export function visitError(choice: VisitChoice, now: Date = new Date()): VisitError | null {
  const start = atLocal(choice.day, choice.time);
  if (Number.isNaN(start.getTime()) || start.getTime() <= now.getTime()) return 'past';
  return null;
}

/** The two arguments accept_job and revise_quote take: the start, and the stored end one hour later. */
export function visitArgs(choice: VisitChoice): { p_visit_start: string; p_visit_end: string } {
  const start = atLocal(choice.day, choice.time);
  return { p_visit_start: start.toISOString(), p_visit_end: new Date(start.getTime() + VISIT_LENGTH_MINUTES * 60_000).toISOString() };
}

/** A stored visit back into the picker's terms (to change a quote), or null when there is none. */
export function choiceFromRange(start: string | null, _end?: string | null): VisitChoice | null {
  if (!start) return null;
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return null;
  return { day: isoDay(s), time: hhmm(s.getHours() * 60 + s.getMinutes()) };
}

/** "Today, 10 AM" / "Wed 12 Nov, 4:30 PM" for a stored visit. */
export function visitText(start: string | null, _end?: string | null, now: Date = new Date()): string {
  const choice = choiceFromRange(start);
  if (!choice) return '';
  const day = choice.day === isoDay(now) ? t('visit.today') : choice.day === isoDay(addDays(now, 1)) ? t('visit.tomorrow') : shortDate(choice.day);
  return `${day}, ${clockLabel(choice.time)}`;
}
