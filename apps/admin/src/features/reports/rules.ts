// Pure rules for the case screen: what the decision options are and how the activity list is built.
import { dateTime, firstName, REPORT_ACTION_TEXT } from '../../lib/format.ts';
import type { ActivityItem, ReportDetail } from './parse.ts';

export type Choice = 'keep_open' | 'warning' | 'suspend' | 'close';

export function choicesFor(against: { name: string; role: string }): { key: Choice; label: string; hint: string; needsReason: boolean; tone?: 'stop' }[] {
  const who = against.role === 'worker' ? 'the worker' : 'the resident';
  return [
    { key: 'keep_open', label: 'Keep open, no action yet', hint: 'Call back first and decide after.', needsReason: false },
    { key: 'warning', label: 'Send a warning', hint: `${who[0]!.toUpperCase() + who.slice(1)} gets a warning message in the app.`, needsReason: true },
    { key: 'suspend', label: 'Suspend the account', hint: against.role === 'worker' ? 'The worker cannot quote or work until staff reactivate.' : 'The resident cannot post or book until staff reactivate.', needsReason: true, tone: 'stop' },
    { key: 'close', label: 'Close the case', hint: 'Mark resolved with no action on the account.', needsReason: true },
  ];
}

export function isChoice(v: unknown): v is Choice {
  return v === 'keep_open' || v === 'warning' || v === 'suspend' || v === 'close';
}

export const REASON_MAX = 500;

/** The client-side check before sending. The database repeats it. */
export function canDecide(choice: Choice, reason: string): { ok: true } | { ok: false; hint: string } {
  if (choice === 'keep_open') return { ok: true };
  const t = reason.trim();
  if (t.length < 3) return { ok: false, hint: 'Write a reason. It is kept in the case record.' };
  if (t.length > REASON_MAX) return { ok: false, hint: `The reason is too long (${REASON_MAX} characters at most).` };
  return { ok: true };
}

/** The activity of a case, oldest first: the report, staff alert, calls, notes and the outcome. */
export function activityOf(d: ReportDetail): ActivityItem[] {
  const items: ActivityItem[] = [];
  const who = d.reporter.role === 'worker' ? 'Worker' : 'Resident';
  items.push({
    key: 'filed', tone: d.kind === 'unsafe' ? 'stop' : 'ok',
    title: d.systemGenerated ? 'Case opened by the system' : d.kind === 'unsafe' ? `${who} reported feeling unsafe` : `${who} filed a report`,
    sub: `${dateTime(d.createdAt)} · ${d.systemGenerated ? 'system' : d.reporter.name}`, at: d.createdAt,
  });
  if (d.kind === 'unsafe') {
    items.push({ key: 'alerted', tone: 'ok', title: 'DHA staff alerted automatically', sub: `${dateTime(d.createdAt)} · system`, at: d.createdAt });
  }
  for (const c of d.calls) {
    items.push({ key: `call-${c.id}`, tone: 'ok', title: `Called ${c.calledName}`, sub: `${dateTime(c.calledAt)} · ${c.calledByName}${c.outcome ? ` · ${c.outcome}` : ''}`, at: c.calledAt });
  }
  for (const n of d.notes) {
    items.push({ key: `note-${n.id}`, tone: 'ok', title: n.note, sub: `${dateTime(n.createdAt)} · ${n.authorName}`, at: n.createdAt });
  }
  if (d.status === 'resolved') {
    items.push({
      key: 'resolved', tone: 'ok', title: REPORT_ACTION_TEXT[d.action ?? ''] ?? 'Resolved',
      sub: `${dateTime(d.resolvedAt)}${d.actionReason ? ` · ${d.actionReason}` : ''}`, at: d.resolvedAt ?? d.createdAt,
    });
  } else if (d.kind === 'unsafe' && d.calls.length === 0) {
    items.push({ key: 'waiting', tone: 'now', title: 'Waiting for a staff call', sub: 'Target: call back immediately', at: new Date().toISOString() });
  }
  // Stable order: by time, the opening first.
  return items.sort((a, b) => (a.key === 'filed' ? -1 : b.key === 'filed' ? 1 : a.key === 'waiting' ? 1 : b.key === 'waiting' ? -1 : Date.parse(a.at) - Date.parse(b.at)));
}

/** Banner text of an unsafe case. */
export function unsafeBanner(d: ReportDetail): { title: string; text: string } {
  return {
    title: `${firstName(d.reporter.name)} says they feel unsafe${d.job.code ? ` at ${d.job.code}` : ''}.`,
    text: 'Call both people now. Do not wait for the report to be reviewed.',
  };
}

export type TrailStep = { label: string; reached: boolean };

/**
 * The three steps of a case: Submitted, Under review, then Action taken or Closed. The reporter sees the same three
 * steps in the app (My reports), so staff and reporter describe a case in the same words. A warning or a suspension
 * reads "Action taken"; a close reads "Closed".
 */
export function reportTrail(status: string, action: string | null): TrailStep[] {
  const resolved = status === 'resolved';
  return [
    { label: 'Submitted', reached: true },
    { label: 'Under review', reached: status === 'in_review' || resolved },
    { label: resolved ? (action === 'warning' || action === 'suspend' ? 'Action taken' : 'Closed') : 'Action taken or closed', reached: resolved },
  ];
}

/** What the reporter is told about this case, so staff know what they have (not) said. */
export function reporterNotice(systemGenerated: boolean): string {
  return systemGenerated
    ? 'A case opened by the system has no reporter, so nobody is notified.'
    : 'The reporter is told when the case is received, when staff open it and when it is resolved. They are only told whether action was taken, never what it was or anything about the other person.';
}
