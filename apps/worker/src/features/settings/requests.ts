// Worker requests (migration 0067): a message to DHA support, a replacement document after approval, and "my phones".
// Injectable clients so the checks, the order of steps and the error wording can be unit tested.
import { bucketFor, checkFile, type DocType } from '../documents/files.ts';

type Err = { name?: string; code?: string; message?: string; statusCode?: string | number } | null;

export type RequestErrorKey =
  | 'settings.errors.network'
  | 'settings.errors.generic'
  | 'settings.errors.photoType'
  | 'settings.errors.photoSize'
  | 'settings.supportScreen.errTitle'
  | 'settings.supportScreen.errBody'
  | 'settings.supportScreen.errOpen'
  | 'settings.supportScreen.errToday'
  | 'settings.errors.docsLimit';

function keyFor(error: Err): RequestErrorKey {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (text.includes('3 open messages')) return 'settings.supportScreen.errOpen';
  if (text.includes('5 messages today')) return 'settings.supportScreen.errToday';
  if (text.includes('too many document updates')) return 'settings.errors.docsLimit';
  if (text.includes('exceeded') || text.includes('too large') || String(error?.statusCode) === '413') return 'settings.errors.photoSize';
  if (text.includes('network') || text.includes('fetch') || error?.name === 'TypeError') return 'settings.errors.network';
  return 'settings.errors.generic';
}

// ---------------------------------------------------------------- support message
export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 80;
export const BODY_MIN = 5;
export const BODY_MAX = 1000;

export type SupportDraft = { subject: string; body: string };

export function supportState(draft: SupportDraft): { subjectOk: boolean; bodyOk: boolean; canSend: boolean } {
  const subjectOk = draft.subject.trim().length >= SUBJECT_MIN && draft.subject.trim().length <= SUBJECT_MAX;
  const bodyOk = draft.body.trim().length >= BODY_MIN && draft.body.trim().length <= BODY_MAX;
  return { subjectOk, bodyOk, canSend: subjectOk && bodyOk };
}

export type SupportClient = { send(subject: string, body: string): PromiseLike<{ error: Err }> };

export async function sendSupport(client: SupportClient, draft: SupportDraft): Promise<{ ok: true } | { ok: false; key: RequestErrorKey }> {
  const s = supportState(draft);
  if (!s.subjectOk) return { ok: false, key: 'settings.supportScreen.errTitle' };
  if (!s.bodyOk) return { ok: false, key: 'settings.supportScreen.errBody' };
  try {
    const { error } = await client.send(draft.subject.trim(), draft.body.trim());
    return error ? { ok: false, key: keyFor(error) } : { ok: true };
  } catch {
    return { ok: false, key: 'settings.errors.network' };
  }
}

// ---------------------------------------------------------------- document update
export type DocumentUpdateClient = {
  upload(bucket: string, path: string, bytes: ArrayBuffer, contentType: string): PromiseLike<{ error: Err }>;
  submit(type: DocType, path: string): PromiseLike<{ error: Err }>;
};

/**
 * File first, then the request that points at it. The file name starts with "update-" (the identity bucket accepts
 * only such names from an approved worker) and sits in the worker's own folder.
 */
export async function sendDocumentUpdate(
  client: DocumentUpdateClient,
  input: { userId: string; type: DocType; mime: string | null | undefined; bytes: ArrayBuffer; now?: number; random?: string },
): Promise<{ ok: true; path: string } | { ok: false; key: RequestErrorKey }> {
  const check = checkFile(input.type, input.mime, input.bytes.byteLength);
  if (!check.ok) return { ok: false, key: check.reason === 'size' ? 'settings.errors.photoSize' : 'settings.errors.photoType' };
  const path = `${input.userId}/update-${input.type}-${input.now ?? Date.now()}-${input.random ?? Math.random().toString(16).slice(2, 10)}.${check.extension}`;
  try {
    const uploaded = await client.upload(bucketFor(input.type), path, input.bytes, input.mime ?? 'image/jpeg');
    if (uploaded.error) return { ok: false, key: keyFor(uploaded.error) };
    const submitted = await client.submit(input.type, path);
    return submitted.error ? { ok: false, key: keyFor(submitted.error) } : { ok: true, path };
  } catch {
    return { ok: false, key: 'settings.errors.network' };
  }
}

// ---------------------------------------------------------------- my requests (list)
export type MyRequest = {
  id: string;
  kind: 'support' | 'document';
  status: 'open' | 'done' | 'approved' | 'rejected';
  subject: string;
  body: string;
  docType: string | null;
  reply: string | null;
  createdAt: string;
  decidedAt: string | null;
};

type RawRequest = Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** my_requests rows -> screen rows; anything malformed is dropped rather than crashing the list. */
export function parseRequests(rows: readonly RawRequest[] | null | undefined): MyRequest[] {
  const out: MyRequest[] = [];
  for (const r of rows ?? []) {
    const kind = r.kind === 'support' || r.kind === 'document' ? r.kind : null;
    const status = r.status === 'open' || r.status === 'done' || r.status === 'approved' || r.status === 'rejected' ? r.status : null;
    if (!kind || !status || typeof r.id !== 'string' || typeof r.created_at !== 'string') continue;
    out.push({
      id: r.id,
      kind,
      status,
      subject: text(r.subject),
      body: text(r.body),
      docType: typeof r.doc_type === 'string' ? r.doc_type : null,
      reply: typeof r.staff_reply === 'string' && r.staff_reply.trim() !== '' ? r.staff_reply.trim() : null,
      createdAt: r.created_at,
      decidedAt: typeof r.decided_at === 'string' ? r.decided_at : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- my phones
export type MySession = { id: string; current: boolean; label: 'android' | 'iphone' | 'other'; lastActive: string | null };

/** "okhttp/4", "Dalvik/2.1 (Linux; Android 14)", "iPhone" ... -> a plain word. Never shows the raw string. */
export function deviceKind(userAgent: string | null | undefined): MySession['label'] {
  const ua = (userAgent ?? '').toLowerCase();
  if (ua.includes('android') || ua.includes('okhttp') || ua.includes('dalvik')) return 'android';
  if (ua.includes('iphone') || ua.includes('ios') || ua.includes('cfnetwork') || ua.includes('ipad')) return 'iphone';
  return 'other';
}

export function parseSessions(rows: readonly RawRequest[] | null | undefined): MySession[] {
  const out: MySession[] = [];
  for (const r of rows ?? []) {
    if (typeof r.id !== 'string') continue;
    out.push({ id: r.id, current: r.is_current === true, label: deviceKind(typeof r.user_agent === 'string' ? r.user_agent : null), lastActive: typeof r.last_active === 'string' ? r.last_active : null });
  }
  return out;
}

export type SignOutClient = { signOutOthers(keepToken: string | null): PromiseLike<{ data: number | null; error: Err }> };

/** Signs out every other phone; the number of phones signed out, or a failure. */
export async function signOutOtherPhones(client: SignOutClient, keepToken: string | null): Promise<{ ok: true; count: number } | { ok: false; key: RequestErrorKey }> {
  try {
    const { data, error } = await client.signOutOthers(keepToken);
    return error ? { ok: false, key: keyFor(error) } : { ok: true, count: typeof data === 'number' ? data : 0 };
  } catch {
    return { ok: false, key: 'settings.errors.network' };
  }
}
