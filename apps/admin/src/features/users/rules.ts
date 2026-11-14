// How long a suspension lasts (migration 0053). Pure, so it is unit tested; the database checks the same limits again.

export const MAX_SUSPENSION_DAYS = 365;

export type DaysCheck = { ok: true; days: number | null } | { ok: false; hint: string };

/** The "days" box of the suspend form: empty means "until staff lift it"; otherwise a whole number from 1 to 365. */
export function checkSuspendDays(raw: string): DaysCheck {
  const v = raw.trim();
  if (v === '') return { ok: true, days: null };
  if (!/^[0-9]{1,3}$/.test(v)) return { ok: false, hint: `Enter a whole number of days from 1 to ${MAX_SUSPENSION_DAYS}, or leave it empty.` };
  const n = Number(v);
  if (n < 1 || n > MAX_SUSPENSION_DAYS) return { ok: false, hint: `A suspension lasts 1 to ${MAX_SUSPENSION_DAYS} days. Leave it empty to suspend until you lift it.` };
  return { ok: true, days: n };
}
