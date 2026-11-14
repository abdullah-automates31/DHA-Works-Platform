// Pure rules for My reports (unit tested): turns what my_reports() returns into what the screen shows. The database
// sends only a plain status and, once a case is resolved, whether DHA took action. It never sends who the report was
// about, the staff notes or what was decided, so nothing of that can appear here.
import { t } from '../../i18n/index.ts';
import { timeAgo } from '../feed/format.ts';

export type ReportStatus = 'submitted' | 'under_review' | 'resolved';
export type ReportOutcome = 'action_taken' | 'no_action';

export type MyReport = {
  id: string;
  code: string;
  kind: string;
  status: ReportStatus;
  outcome: ReportOutcome | null;
  jobTitle: string;
  jobCode: string;
  details: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type MyReportsPage = { total: number; reports: MyReport[] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Reads the answer of my_reports(). A row that does not look right is skipped, never guessed at. */
export function parseMyReports(json: unknown): MyReportsPage | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as { total?: unknown; rows?: unknown };
  if (!Array.isArray(o.rows)) return null;
  const reports: MyReport[] = [];
  for (const raw of o.rows) {
    if (raw === null || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const status = r.status === 'submitted' || r.status === 'under_review' || r.status === 'resolved' ? r.status : null;
    if (!status || !str(r.id) || !str(r.created_at)) continue;
    const outcome = status === 'resolved' ? (r.outcome === 'action_taken' ? 'action_taken' : 'no_action') : null;
    reports.push({
      id: str(r.id),
      code: str(r.code),
      kind: str(r.kind),
      status,
      outcome,
      jobTitle: str(r.job_title),
      jobCode: str(r.job_code),
      details: str(r.details).trim(),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at) || str(r.created_at),
      resolvedAt: str(r.resolved_at) || null,
    });
  }
  return { total: typeof o.total === 'number' && Number.isFinite(o.total) ? o.total : reports.length, reports };
}

/** Where the report stands, as a position on the three steps Submitted, Under review, Resolved. */
export function stepOf(status: ReportStatus): 1 | 2 | 3 {
  return status === 'submitted' ? 1 : status === 'under_review' ? 2 : 3;
}

export type ChipTone = 'wait' | 'inProgress' | 'done';
export type ReportView = { label: string; hint: string; tone: ChipTone };

/** The status words and the one-line explanation of a report. */
export function describeReport(r: Pick<MyReport, 'status' | 'outcome'>): ReportView {
  if (r.status === 'submitted') return { label: t('myReports.submitted'), hint: t('myReports.hintSubmitted'), tone: 'wait' };
  if (r.status === 'under_review') return { label: t('myReports.underReview'), hint: t('myReports.hintReview'), tone: 'inProgress' };
  return r.outcome === 'action_taken'
    ? { label: t('myReports.actionTaken'), hint: t('myReports.hintActionTaken'), tone: 'done' }
    : { label: t('myReports.closed'), hint: t('myReports.hintClosed'), tone: 'done' };
}

/** "Customer rude", "I felt unsafe" ...; an unknown kind reads as "Other". */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'rude_damage':
      return t('myReports.kinds.rude_damage');
    case 'unsafe':
      return t('myReports.kinds.unsafe');
    case 'no_show':
      return t('myReports.kinds.no_show');
    case 'cash_price':
      return t('myReports.kinds.cash_price');
    case 'poor_work':
      return t('myReports.kinds.poor_work');
    default:
      return t('myReports.kinds.other');
  }
}

/** "14 Nov 2026" in the phone's local time; empty when the value is not a date. */
export function dateText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Sent 14 Nov 2026 · Updated 2 hrs ago". The last update is left out when nothing has changed since it was sent. */
export function datesLine(r: Pick<MyReport, 'createdAt' | 'updatedAt' | 'resolvedAt' | 'status'>, now: Date = new Date()): string {
  const sent = t('myReports.sent', { date: dateText(r.createdAt) });
  const last = r.status === 'resolved' ? r.resolvedAt ?? r.updatedAt : r.updatedAt;
  const changed = Math.abs(new Date(last).getTime() - new Date(r.createdAt).getTime()) > 60_000;
  if (!changed) return sent;
  const when = timeAgo(last, now);
  return `${sent} · ${t(r.status === 'resolved' ? 'myReports.resolvedAgo' : 'myReports.updatedAgo', { when })}`;
}
