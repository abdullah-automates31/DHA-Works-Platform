// Pure rules for the worker and resident verification screens (A03 to A06). No network, no React: unit tested.
// The database enforces the real rules (migration 0038); these only shape what the screens show and prevent
// obviously invalid submissions before they leave the browser.

export type Role = 'worker' | 'resident';
export type Decision = 'approve' | 'ask_for_changes' | 'visit_hq' | 'reject';
export type Tone = 'ok' | 'wait' | 'red';

export const WORKER_TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'visit_hq', label: 'Visit HQ' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
] as const;
export const RESIDENT_TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'needs_changes', label: 'Needs changes' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
] as const;
export type Tab = 'pending' | 'visit_hq' | 'needs_changes' | 'approved' | 'rejected';

export function tabsFor(role: Role) {
  return role === 'worker' ? WORKER_TABS : RESIDENT_TABS;
}

/** The tab named in the address, or "pending" for anything that is not one of this role's tabs. */
export function parseTab(role: Role, value: unknown): Tab {
  const found = tabsFor(role).find((t) => t.key === value);
  return found ? found.key : 'pending';
}

/** A whole number from the address bar, or the fallback. Never negative, never NaN. */
export function parsePositiveInt(value: unknown, fallback: number, max = 100000): number {
  if (typeof value !== 'string' || !/^[0-9]{1,6}$/.test(value)) return fallback;
  const n = Number(value);
  return n >= 1 && n <= max ? n : fallback;
}

export const PAGE_SIZE = 25;

/** "20 h", "3 d", "under 1 h". */
export function waitingText(sinceIso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(sinceIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'under 1 h';
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/**
 * The queue's "Waiting" column measures time since the application was last changed (the database's
 * verification_updated_at). That is a waiting time only while the application is open. On Approved the same
 * value is the approval date, so the column and the "Sorted by waiting time" note are hidden there.
 */
export function showsWaiting(tab: Tab): boolean {
  return tab !== 'approved';
}

export function initials(name: string | null): string {
  // Only words that start with a letter count, so a tag like "[FAKE]" or a bracketed title never becomes the initial.
  const letters = (name ?? '').trim().split(/\s+/).map((w) => w.match(/^\p{L}/u)?.[0]).filter((c): c is string => !!c);
  if (letters.length === 0) return '?';
  return (letters[0]! + (letters.length > 1 ? letters[letters.length - 1]! : '')).toUpperCase();
}

export function phasesText(phases: number[]): string {
  return phases.length === 0 ? 'None' : `Phase ${phases.join(', ')}`;
}

/** Phone as shown to staff: 0321 555 0114 for an 11-digit local number, otherwise as stored. */
export function phoneText(phone: string | null): string {
  if (!phone) return 'No phone';
  const digits = phone.replace(/[^0-9]/g, '');
  return /^0[0-9]{10}$/.test(digits) ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : phone;
}

// ---------------------------------------------------------------- documents
export type DocType = 'cnic_front' | 'cnic_back' | 'utility_bill' | 'police_cert' | 'profile_photo';

export const DOC_LABEL: Record<DocType, string> = {
  cnic_front: 'CNIC front',
  cnic_back: 'CNIC back',
  utility_bill: 'Utility bill',
  police_cert: 'Police character certificate',
  profile_photo: 'Profile photo',
};

/** ID documents live in the "identity" bucket; the profile photo and voice intro live in "worker-media". */
export function bucketFor(doc: DocType | 'voice'): 'identity' | 'worker-media' {
  return doc === 'profile_photo' || doc === 'voice' ? 'worker-media' : 'identity';
}

export function isDocType(value: unknown): value is DocType {
  return typeof value === 'string' && value in DOC_LABEL;
}

/** The "Documents" cell of the queue. */
export function documentsChip(role: Role, docs: string[], references: number): { label: string; tone: Tone } {
  const has = (d: DocType) => docs.includes(d);
  const missing: string[] = [];
  if (!has('cnic_front') || !has('cnic_back')) missing.push('CNIC');
  if (role === 'resident') {
    if (!has('utility_bill')) missing.push('utility bill');
  } else {
    if (!has('profile_photo')) missing.push('photo');
    if (!has('police_cert') && references < 2) return missing.length === 0 ? { label: 'No certificate, fewer than 2 references', tone: 'red' } : { label: `Missing: ${missing.join(', ')}`, tone: 'red' };
  }
  if (missing.length > 0) return { label: `Missing: ${missing.join(', ')}`, tone: 'red' };
  if (role === 'worker' && !has('police_cert')) return { label: 'References, no certificate', tone: 'wait' };
  return { label: 'All uploaded', tone: 'ok' };
}

// ---------------------------------------------------------------- checklist and decision
export const CHECKLIST: Record<Role, { key: string; label: string }[]> = {
  worker: [
    { key: 'cnic', label: 'CNIC is clear and matches the name' },
    { key: 'photo', label: 'Profile photo shows a clear face' },
    { key: 'police', label: 'Police certificate is valid and readable (or two references given)' },
    { key: 'voice', label: 'Voice introduction is clear' },
  ],
  resident: [
    { key: 'cnic', label: 'CNIC is clear and matches the name' },
    { key: 'bill', label: 'Utility bill is from the last 3 months' },
    { key: 'address', label: 'Address on the bill matches the address given' },
    { key: 'lives', label: 'Resident lives in DHA' },
  ],
};

export const DECISIONS: Record<Role, { key: Decision; label: string; hint: string; cta: string; tone: 'go' | 'stop' }[]> = {
  worker: [
    { key: 'approve', label: 'Approve', hint: 'The worker goes live and can see open jobs.', cta: 'Approve worker', tone: 'go' },
    { key: 'visit_hq', label: 'Visit HQ', hint: 'The worker is asked to come to the DHA office to sort it out in person.', cta: 'Ask worker to visit HQ', tone: 'go' },
    { key: 'reject', label: 'Reject', hint: 'The application is closed. Give a reason.', cta: 'Reject application', tone: 'stop' },
  ],
  resident: [
    { key: 'approve', label: 'Approve', hint: 'The resident can post jobs and book workers.', cta: 'Approve resident', tone: 'go' },
    { key: 'ask_for_changes', label: 'Ask for changes', hint: 'The resident is told what to fix and can send again.', cta: 'Send request to resident', tone: 'go' },
    { key: 'reject', label: 'Reject', hint: 'The application is closed. Give a reason.', cta: 'Reject application', tone: 'stop' },
  ],
};

export function isDecision(role: Role, value: unknown): value is Decision {
  return DECISIONS[role].some((d) => d.key === value);
}

export type Checks = Record<string, boolean>;

export function emptyChecks(role: Role): Checks {
  return Object.fromEntries(CHECKLIST[role].map((c) => [c.key, false]));
}

export const REASON_MAX = 500;
export const REASON_MIN = 3;

export type Submission = { ok: true } | { ok: false; hint: string };

/** Whether the form may be sent, and if not what to tell the reviewer. Mirrors the database rules. */
export function canSubmit(role: Role, decision: Decision, checks: Checks, reason: string): Submission {
  if (!isDecision(role, decision)) return { ok: false, hint: 'Choose a decision.' };
  if (decision === 'approve') {
    const all = CHECKLIST[role].every((c) => checks[c.key] === true);
    return all ? { ok: true } : { ok: false, hint: 'Tick every checklist item to approve. Or choose another decision.' };
  }
  const r = reason.trim();
  if (r.length < REASON_MIN) return { ok: false, hint: 'Write a reason the applicant will see.' };
  if (r.length > REASON_MAX) return { ok: false, hint: `The reason is too long (${REASON_MAX} characters at most).` };
  return { ok: true };
}

/** The checklist as the database wants it: exactly this role's keys, true or false. Unknown keys are dropped. */
export function normaliseChecks(role: Role, input: unknown): Checks {
  const out = emptyChecks(role);
  if (input && typeof input === 'object') {
    for (const c of CHECKLIST[role]) out[c.key] = (input as Record<string, unknown>)[c.key] === true;
  }
  return out;
}

export function statusChip(status: string): { label: string; tone: Tone | 'blue' } {
  switch (status) {
    case 'pending':
      return { label: 'Pending review', tone: 'wait' };
    case 'visit_hq':
      return { label: 'Asked to visit HQ', tone: 'blue' };
    case 'needs_changes':
      return { label: 'Needs changes', tone: 'wait' };
    case 'approved':
      return { label: 'Approved', tone: 'ok' };
    case 'rejected':
      return { label: 'Rejected', tone: 'red' };
    default:
      return { label: status, tone: 'wait' };
  }
}
