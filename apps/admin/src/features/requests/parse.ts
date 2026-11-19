// Worker requests (migration 0067): what admin_requests_list and admin_requests_counts return.
import { int, isUuid, obj, page, str } from '../../lib/json.ts';

export type Kind = 'support' | 'document' | 'name_change' | 'phone_change';
export type Status = 'open' | 'done' | 'approved' | 'rejected';

export type RequestRow = {
  id: string; workerId: string; workerName: string; workerPhone: string; kind: Kind; status: Status;
  subject: string; body: string; docType: string | null; path: string | null; oldValue: string | null; newValue: string | null;
  reply: string | null; createdAt: string; decidedAt: string | null;
};

const KINDS: readonly string[] = ['support', 'document', 'name_change', 'phone_change'];
const STATUSES: readonly string[] = ['open', 'done', 'approved', 'rejected'];

export function parseRequests(json: unknown) {
  return page<RequestRow>(json, (r) => {
    if (!isUuid(r.id) || !isUuid(r.worker_id) || !str(r.created_at) || !KINDS.includes(String(r.kind)) || !STATUSES.includes(String(r.status))) return null;
    return {
      id: r.id, workerId: r.worker_id, workerName: str(r.worker_name) ?? 'Worker', workerPhone: str(r.worker_phone) ?? '', kind: r.kind as Kind, status: r.status as Status,
      subject: str(r.subject) ?? '', body: str(r.body) ?? '', docType: str(r.doc_type), path: str(r.storage_path), oldValue: str(r.old_value), newValue: str(r.new_value),
      reply: str(r.staff_reply), createdAt: r.created_at as string, decidedAt: str(r.decided_at),
    };
  });
}

export type RequestCounts = { open: number; support: number; document: number; changes: number };

export function parseCounts(json: unknown): RequestCounts {
  const o = obj(json) ?? {};
  return { open: int(o.open), support: int(o.support), document: int(o.document), changes: int(o.changes) };
}

export const KIND_LABEL: Record<Kind, string> = { support: 'Message', document: 'New document', name_change: 'Name changed', phone_change: 'Number changed' };

const DOC_LABEL: Record<string, string> = { cnic_front: 'CNIC (front)', cnic_back: 'CNIC (back)', police_cert: 'Police certificate', profile_photo: 'Profile photo' };
export const docLabel = (t: string | null): string => (t ? DOC_LABEL[t] ?? t : 'Document');

/** The identity bucket holds CNIC and the certificate; the profile photo lives in worker-media. */
export const bucketForDoc = (t: string | null): 'identity' | 'worker-media' => (t === 'profile_photo' ? 'worker-media' : 'identity');
