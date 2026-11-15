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
