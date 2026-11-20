// A worker who is in the middle of a job (in progress) may still take another job. The quote then waits until the worker
// says how long the current job will take; only then does the customer see the quote, with that time (migration 0057).

/** What the database accepts: 5 minutes to 3 days. */
export const BUSY_ETA_MIN = 5;
export const BUSY_ETA_MAX = 4320;

/** Quick choices shown under the box, in minutes. The worker can type any number instead. */
export const BUSY_ETA_QUICK = [15, 20, 30, 45, 60, 90] as const;

/** The number typed in the box, or null when it is empty, not a whole number, or outside what the database accepts. */
export function parseBusyMinutes(text: string): number | null {
  const digits = text.trim();
  if (!/^[0-9]{1,5}$/.test(digits)) return null;
  const n = Number(digits);
  return n >= BUSY_ETA_MIN && n <= BUSY_ETA_MAX ? n : null;
}

/** "20 minutes", "1 hour", "1 hour 30 minutes", "2 days". */
export function busyEtaLabel(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '1 day' : `${days} days`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = hours === 0 ? '' : hours === 1 ? '1 hour' : `${hours} hours`;
  const m = rest === 0 ? '' : rest === 1 ? '1 minute' : `${rest} minutes`;
  return [h, m].filter(Boolean).join(' ');
}

/** The choices of the "Current job time" screen (W12d), in minutes: 30 min, 1 hour, 1.5 hours, 2, 3 and 4 hours. */
export const BUSY_CHIPS = [30, 60, 90, 120, 180, 240] as const;

/** "12:10 PM": when the current job will be done if it takes `minutes` from `now` (the phone's local time). */
export function finishTimeLabel(minutes: number, now: Date): string {
  const done = new Date(now.getTime() + minutes * 60_000);
  const h = done.getHours();
  const m = String(done.getMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "1.5 hours" style chip text: 30 min, 1 hour, 1.5 hours, 2 hours. */
export function chipLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

// ---- When is the "current job time" question needed? (migration 0070, owner request 20 Nov)
// Only when the customer's visit is soon enough that the current job could still be running at the visit. The database
// decides (app_settings busy_estimate_window_hours, default 6) and refuses a quote that lacks the answer; this mirrors the
// default so the screen shows up first time instead of after a refusal.

export const BUSY_WINDOW_HOURS = 6;
const KARACHI_UTC_OFFSET_MINUTES = 5 * 60; // Pakistan has no daylight saving

/** The visit start (epoch ms) from the job's date "2026-11-21" and start time "15:00:00" in Karachi time; null when the job has no date. */
export function visitStartMs(preferred: { date: string | null; from: string | null }): number | null {
  if (!preferred.date) return null;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(preferred.date);
  if (!d) return null;
  const tm = /^(\d{2}):(\d{2})/.exec(preferred.from ?? '08:00'); // the database reads a missing start as 08:00
  if (!tm) return null;
  return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(tm[1]), Number(tm[2])) - KARACHI_UTC_OFFSET_MINUTES * 60_000;
}

/** True when the visit starts within the window from now (a visit already past is not "soon": the database refuses it anyway). */
export function needsBusyEstimate(preferred: { date: string | null; from: string | null }, now: Date, windowHours: number = BUSY_WINDOW_HOURS): boolean {
  const start = visitStartMs(preferred);
  if (start === null) return false;
  const ahead = start - now.getTime();
  return ahead > 0 && ahead <= windowHours * 3_600_000;
}

/** "Yes, I will be free by the visit": the minutes from now to the visit start, kept inside what the database accepts. */
export function minutesUntilVisit(preferred: { date: string | null; from: string | null }, now: Date): number | null {
  const start = visitStartMs(preferred);
  if (start === null) return null;
  const minutes = Math.ceil((start - now.getTime()) / 60_000);
  return Math.min(BUSY_ETA_MAX, Math.max(BUSY_ETA_MIN, minutes));
}
