// Pure rules for the Settings screens (unit tested). Nothing here talks to the server: the database stays the
// authority (update_my_profile locks name, gender, birth date and CNIC after approval; add_verification_document
// is closed outside "incomplete" and "needs changes"). These helpers only decide what the screens show and enable.
import { isValidName, normalizeName } from '../profile/validation.ts';
import { aboutChanged, parseYears } from '../work/rules.ts';

export type VerificationStatus = 'incomplete' | 'pending' | 'approved' | 'needs_changes' | 'visit_hq' | 'rejected';

// ---------------------------------------------------------------- personal information
/** The name is editable only while the application is still open; after approval staff own it. */
export function canEditName(status: VerificationStatus | null | undefined): boolean {
  return status === 'incomplete' || status === 'needs_changes';
}

export type PersonalDraft = { name: string; photoChosen: boolean };

/** Save is enabled only when something really changed and what changed is valid. */
export function personalState(
  saved: { name: string },
  draft: PersonalDraft,
  status: VerificationStatus | null | undefined,
): { dirty: boolean; nameError: boolean; canSave: boolean } {
  const nameChanged = canEditName(status) && normalizeName(draft.name) !== normalizeName(saved.name);
  const nameError = nameChanged && !isValidName(draft.name);
  const dirty = nameChanged || draft.photoChosen;
  return { dirty, nameError, canSave: dirty && !nameError };
}

// ---------------------------------------------------------------- professional details
export type ProfessionalDraft = { trades: readonly number[]; years: string; about: string };
export type ProfessionalSaved = { trades: readonly number[]; years: number | null; about: string };

/** Which parts differ from what is saved (blank years or about leave the saved value as it is, like the database). */
export function professionalChanges(saved: ProfessionalSaved, draft: ProfessionalDraft) {
  const sameTrades = draft.trades.length === saved.trades.length && draft.trades.every((id) => saved.trades.includes(id));
  const years = parseYears(draft.years);
  return {
    trades: !sameTrades,
    years: years.ok && years.value !== null && years.value !== saved.years,
    about: aboutChanged(draft.about, saved.about),
    yearsInvalid: !years.ok,
    noTrade: draft.trades.length === 0,
  };
}

export function professionalCanSave(saved: ProfessionalSaved, draft: ProfessionalDraft): boolean {
  const c = professionalChanges(saved, draft);
  if (c.yearsInvalid || c.noTrade) return false;
  return c.trades || c.years || c.about;
}

// ---------------------------------------------------------------- verification and documents
export type DocumentKind = 'cnic' | 'police' | 'photo';
export type DocumentStatus = 'not_submitted' | 'uploaded' | 'pending' | 'approved' | 'changes_needed' | 'rejected';
export type DocumentItem = { kind: DocumentKind; status: DocumentStatus; submittedAt: string | null };
export type DocumentRow = { doc_type: string; uploaded_at: string | null };

function latest(rows: readonly DocumentRow[]): string | null {
  const times = rows.map((r) => r.uploaded_at).filter((v): v is string => !!v);
  return times.length === 0 ? null : times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
}

/**
 * One row per document the worker must give. The database records a decision for the whole application, not per file,
 * so a submitted file takes the application's state: under review (pending or visit HQ), approved, changes asked for
 * (the reason is the application's), or rejected. Nothing here invents a per-file verdict.
 */
export function documentItems(rows: readonly DocumentRow[], referenceCount: number, status: VerificationStatus | null | undefined): DocumentItem[] {
  const of = (...types: string[]) => rows.filter((r) => types.includes(r.doc_type));
  const submittedState = (): DocumentStatus => {
    switch (status) {
      case 'pending':
      case 'visit_hq':
        return 'pending';
      case 'approved':
        return 'approved';
      case 'needs_changes':
        return 'changes_needed';
      case 'rejected':
        return 'rejected';
      default:
        return 'uploaded'; // incomplete: saved, application not sent yet
    }
  };
  const cnic = of('cnic_front', 'cnic_back');
  const police = of('police_cert');
  const photo = of('profile_photo');
  return [
    { kind: 'cnic', status: cnic.length >= 2 ? submittedState() : 'not_submitted', submittedAt: cnic.length >= 2 ? latest(cnic) : null },
    // The police certificate can be replaced by references (W03b): references count as submitted, without a date.
    { kind: 'police', status: police.length > 0 || referenceCount > 0 ? submittedState() : 'not_submitted', submittedAt: latest(police) },
    { kind: 'photo', status: photo.length > 0 ? submittedState() : 'not_submitted', submittedAt: latest(photo) },
  ];
}

/** The staff reason is the application's, shown once, and only when staff asked for changes or rejected. */
export function staffReason(status: VerificationStatus | null | undefined, reason: string | null | undefined): string | null {
  if (status !== 'needs_changes' && status !== 'rejected' && status !== 'visit_hq') return null;
  const text = (reason ?? '').trim();
  return text === '' ? null : text;
}

/** Documents may be sent again only while the application is open (the database enforces the same). */
export function canResubmitDocuments(status: VerificationStatus | null | undefined): boolean {
  return status === 'incomplete' || status === 'needs_changes';
}

// ---------------------------------------------------------------- notification preferences
export type PrefKey = 'new_jobs' | 'job_updates' | 'job_reminders' | 'report_updates' | 'announcements';
export const PREF_KEYS: readonly PrefKey[] = ['new_jobs', 'job_updates', 'job_reminders', 'report_updates', 'announcements'];
export type Prefs = Record<PrefKey, boolean>;

/** worker_details row -> switches. A missing column or row counts as on, which is the database default. */
export function parsePrefs(row: Record<string, unknown> | null | undefined): Prefs {
  const on = (v: unknown) => v !== false;
  return {
    new_jobs: on(row?.notify_new_jobs),
    job_updates: on(row?.notify_job_updates),
    job_reminders: on(row?.job_reminders),
    report_updates: on(row?.notify_report_updates),
    announcements: on(row?.notify_announcements),
  };
}

type RpcResult = PromiseLike<{ error: unknown }>;
export type PrefClient = { rpc(fn: 'set_job_reminders' | 'set_notification_preference', args: Record<string, unknown>): RpcResult };

/** Job reminders have had their own function since 0058; the other four share set_notification_preference (0065). */
export async function savePref(client: PrefClient, key: PrefKey, value: boolean): Promise<boolean> {
  try {
    const { error } =
      key === 'job_reminders'
        ? await client.rpc('set_job_reminders', { p_value: value })
        : await client.rpc('set_notification_preference', { p_key: key, p_value: value });
    return !error;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- app version
/** "1.0.0 (build 12)" or just "1.0.0" when the build is unknown (Expo Go, web). */
export function versionText(version: string | null | undefined, build: string | number | null | undefined): { version: string; build: string | null } {
  const v = (version ?? '').toString().trim() || '0.0.0';
  const b = build === null || build === undefined || String(build).trim() === '' ? null : String(build).trim();
  return { version: v, build: b };
}

/** "+923214567890" -> "+92 321 4567890"; anything unexpected is shown as stored. */
export function displayPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const m = /^\+92(\d{3})(\d{7})$/.exec(phone.trim());
  return m ? `+92 ${m[1]} ${m[2]}` : phone.trim();
}
