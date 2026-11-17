// Pure helpers for showing a visiting time. The CUSTOMER picks the day and time when posting the job (owner decision
// 17 Nov, migration 0059); the worker never picks or sends one. A stored visit is shown as one time: "Today, 10 AM".
import { t } from '../../i18n/index.ts';
import { shortDate } from '../feed/format.ts';

const two = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** "09:00" -> "9 AM", "13:30" -> "1:30 PM". */
export function clockLabel(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return '';
  const h = Number(match[1]);
  const m = Number(match[2]);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${m === 0 ? hour12 : `${hour12}:${two(m)}`} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Today, 10 AM" / "Wed 12 Nov, 4:30 PM" for a stored visit (the phone's local time). */
export function visitText(start: string | null, _end?: string | null, now: Date = new Date()): string {
  if (!start) return '';
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return '';
  const day = isoDay(s);
  const label = day === isoDay(now) ? t('visit.today') : day === isoDay(addDays(now, 1)) ? t('visit.tomorrow') : shortDate(day);
  return `${label}, ${clockLabel(`${two(s.getHours())}:${two(s.getMinutes())}`)}`;
}
