import type { Rule } from './parse.ts';

// Checks for the settings form. The database repeats them (migration 0042).
export const HELPLINE_PATTERN = /^[0-9+ -]{3,20}$/;
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type Check = { ok: true } | { ok: false; hint: string };

export function checkSettings(v: { number: string; enabled: boolean; reportDays: number; reviewDays: number }): Check {
  const n = v.number.trim();
  if (n !== '' && !HELPLINE_PATTERN.test(n)) return { ok: false, hint: 'The helpline number can only have digits, spaces, + and - (3 to 20 characters).' };
  if (v.enabled && n === '') return { ok: false, hint: 'Enter the helpline number before showing it in the apps.' };
  if (!Number.isInteger(v.reportDays) || v.reportDays < 1 || v.reportDays > 30) return { ok: false, hint: 'The report window must be 1 to 30 days.' };
  if (!Number.isInteger(v.reviewDays) || v.reviewDays < 1 || v.reviewDays > 30) return { ok: false, hint: 'The review window must be 1 to 30 days.' };
  return { ok: true };
}

export function checkInviteEmail(email: string): Check {
  const e = email.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_PATTERN.test(e)) return { ok: false, hint: 'Enter a valid email address.' };
  return { ok: true };
}

/**
 * The page a new staff member opens to create their password. The token is shown once to the inviter. It sits after
 * the "#" on purpose: a browser never sends that part to the server, so it cannot end up in hosting or proxy logs.
 */
export function inviteLink(origin: string, email: string, token: string): string {
  return `${origin}/accept-invite?${new URLSearchParams({ email }).toString()}#${new URLSearchParams({ token }).toString()}`;
}

const TOKEN_PATTERN = /^[0-9a-f]{20,100}$/i;

/** The invitation token from a URL fragment ("#token=..."), or null when it is missing or not a plain hex token. */
export function tokenFromHash(hash: string | null | undefined): string | null {
  if (typeof hash !== 'string' || hash.length > 300) return null;
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return value !== null && TOKEN_PATTERN.test(value) ? value : null;
}

export const PASSWORD_MIN = 12;

export function checkNewPassword(password: string, confirm: string): Check {
  if (password.length < PASSWORD_MIN) return { ok: false, hint: `Use at least ${PASSWORD_MIN} characters.` };
  if (password.length > 72) return { ok: false, hint: 'Use 72 characters at most.' };
  if (password !== confirm) return { ok: false, hint: 'The two passwords are not the same.' };
  return { ok: true };
}

// ---- Rules (migration 0064). The database repeats every check; these give the answer before the page is sent. ----

/** Short unit and a plain-words hint under each editable rule. */
export const RULE_HELP: Record<string, { unit: string; hint: string }> = {
  job_expiry_hours: { unit: 'hours', hint: 'An open job nobody has been booked on expires after this long. Also applies to jobs that are open now.' },
  job_expiry_reminder_hours: { unit: 'hours', hint: 'The resident gets a reminder this long after posting. It must come before the job expires.' },
  max_job_photos: { unit: 'photos', hint: 'The most photos a resident can attach to one job.' },
  stuck_scheduled_hours: { unit: 'hours', hint: 'A booked job that has not started this long after its visiting time is flagged for staff.' },
  stuck_in_progress_hours: { unit: 'hours', hint: 'A job in progress that is not finished this long after it started is flagged for staff.' },
  stuck_cash_hours: { unit: 'hours', hint: 'A finished job without both cash entries after this long is flagged for staff.' },
  top_rated_min_jobs: { unit: 'jobs', hint: 'A worker needs at least this many completed jobs to be shown as Top rated.' },
  top_rated_min_rating: { unit: 'stars', hint: 'And an average rating of at least this (one decimal, for example 4.5).' },
};

export type RuleValues = Record<string, string>;

/** The first problem with the typed values, or null when all of them are fine. Mirrors admin_rules_save. */
export function checkRules(group: 'jobs' | 'workers', rules: Rule[], values: RuleValues): string | null {
  for (const r of rules) {
    const raw = (values[r.key] ?? '').trim();
    if (raw === '' || !/^[0-9]+(\.[0-9]+)?$/.test(raw)) return `${r.label}: enter a number.`;
    const n = Number(raw);
    if (n < r.min || n > r.max) return `${r.label} must be between ${r.min} and ${r.max}.`;
    if (r.integer && !Number.isInteger(n)) return `${r.label} must be a whole number.`;
    if (!r.integer && Math.round(n * 10) / 10 !== n) return `${r.label} can have one decimal at most.`;
  }
  if (group === 'jobs' && values.job_expiry_reminder_hours !== undefined && values.job_expiry_hours !== undefined) {
    if (Number(values.job_expiry_reminder_hours) >= Number(values.job_expiry_hours)) return 'The reminder must come before the job expires.';
  }
  return null;
}

/** True when any typed value differs from what is saved (an empty box counts as a change, so it is not lost silently). */
export function rulesDirty(rules: Rule[], values: RuleValues): boolean {
  return rules.some((r) => {
    const raw = (values[r.key] ?? '').trim();
    return raw === '' || Number(raw) !== r.value;
  });
}

// ---- The settings sections: one place for the navigation, the search and the page titles ----
export type SectionKey = 'helpline' | 'categories' | 'areas' | 'jobs' | 'workers' | 'admins' | 'security' | 'audit' | 'system' | 'danger';
export const SECTION_GROUPS: { title: string; items: { key: SectionKey; label: string; keywords: string }[] }[] = [
  {
    title: 'Platform',
    items: [
      { key: 'helpline', label: 'Helpline and windows', keywords: 'helpline number phone report window review window days' },
      { key: 'categories', label: 'Service categories', keywords: 'category plumbing electrician services workers' },
      { key: 'areas', label: 'Areas', keywords: 'phase dha area location' },
    ],
  },
  {
    title: 'Rules',
    items: [
      { key: 'jobs', label: 'Jobs and booking', keywords: 'job expiry expire reminder photos stuck cash material bill cancellation quote' },
      { key: 'workers', label: 'Workers', keywords: 'top rated rating completed jobs documents cnic police certificate photo verification suspension' },
    ],
  },
  {
    title: 'People and security',
    items: [
      { key: 'admins', label: 'Admin accounts', keywords: 'admin staff invite remove last sign in sessions login' },
      { key: 'security', label: 'Security', keywords: 'security two factor code password turnstile bot session timeout login attempts step up' },
    ],
  },
  {
    title: 'Records and system',
    items: [
      { key: 'audit', label: 'Audit log', keywords: 'audit log history activity changes who when filter' },
      { key: 'system', label: 'System status', keywords: 'system status database storage push edge functions backup health scheduled jobs' },
    ],
  },
];
export const DANGER_ITEM = { key: 'danger' as const, label: 'Danger zone', keywords: 'danger sign out logout force sessions emergency' };
export const SECTION_KEYS: SectionKey[] = [...SECTION_GROUPS.flatMap((g) => g.items.map((i) => i.key)), 'danger'];

export function parseSection(v: unknown): SectionKey {
  return SECTION_KEYS.find((k) => k === v) ?? 'categories';
}

/** Sections that match what was typed in the search box (every word must appear in the label or the keywords). */
export function matchSections(query: string): Set<SectionKey> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = [...SECTION_GROUPS.flatMap((g) => g.items), DANGER_ITEM];
  return new Set(all.filter((i) => words.every((w) => `${i.label} ${i.keywords}`.toLowerCase().includes(w))).map((i) => i.key));
}

// ---- Audit log wording ----
const ACTION_LABEL: Record<string, string> = {
  rules_saved: 'Rules saved',
  settings_saved: 'Helpline and windows saved',
  admins_signed_out: 'Other admin sessions ended',
  staff_invited: 'Admin invited',
  staff_invite_revoked: 'Invite cancelled',
  staff_invite_accepted: 'Invite accepted',
  staff_removed: 'Admin removed',
  staff_note_added: 'Staff note added',
  account_suspended: 'Account suspended',
  account_reactivated: 'Account reactivated',
  report_resolved: 'Report resolved',
  report_in_review: 'Report put in review',
  report_call_logged: 'Report call logged',
  verification_decided: 'Verification decided',
  verification_viewed: 'Documents viewed',
  user_viewed: 'Person viewed',
  report_viewed: 'Report viewed',
  verification_reopened: 'Applicant reopened',
  cancelled_by_staff: 'Job cancelled by staff',
  admin_reset_requested: 'Password reset code requested',
  admin_password_reset: 'Password reset',
  admin_reset_code_wrong: 'Wrong password reset code',
  admin_reset_locked: 'Password reset locked',
};

export function actionLabel(action: string): string {
  if (ACTION_LABEL[action]) return ACTION_LABEL[action];
  const text = action.replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown';
}

const keyLabel = (k: string) => k.replace(/_/g, ' ');
const show = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '-');

/** "job expiry hours: 24 to 48" for a saved change; the reason otherwise. Never prints a whole record. */
export function changeText(a: { action: string; old: Record<string, unknown> | null; new: Record<string, unknown> | null; reason: string | null }): string {
  if ((a.action === 'rules_saved' || a.action === 'settings_saved') && a.new) {
    const parts = Object.keys(a.new).slice(0, 8).map((k) => `${keyLabel(k)}: ${a.old && k in a.old ? show(a.old[k]) : '-'} to ${show(a.new?.[k])}`);
    if (parts.length > 0) return parts.join(', ');
  }
  if (a.action === 'admins_signed_out' && a.new && typeof a.new.sessions_ended === 'number') {
    return `${a.new.sessions_ended} session${a.new.sessions_ended === 1 ? '' : 's'} ended`;
  }
  return a.reason ?? '';
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n < 1024 * 1024) return `${Math.max(0.1, Math.round((n / 1024) * 10) / 10)} KB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
  return `${Math.round((n / 1024 / 1024 / 1024) * 100) / 100} GB`;
}

export const SIGN_OUT_WORDS = 'SIGN OUT';
