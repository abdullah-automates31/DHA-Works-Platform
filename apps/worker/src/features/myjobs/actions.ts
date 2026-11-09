// Start job / Mark complete on W12. start_job and complete_job are the only places the state changes; this file
// only prepares the request and turns refusals into friendly messages. Injectable client for unit tests.
import { MAX_FILE_BYTES } from '../documents/files.ts';

export type ActionErrorKey =
  | 'myjobs.errors.cannotStart'
  | 'myjobs.errors.cannotComplete'
  | 'myjobs.errors.billRequired'
  | 'myjobs.errors.billType'
  | 'myjobs.errors.billSize'
  | 'myjobs.errors.billUpload'
  | 'myjobs.errors.billInvalid'
  | 'myjobs.errors.billNotAllowed'
  | 'myjobs.errors.network'
  | 'myjobs.errors.generic';

type Err = { name?: string; message?: string } | null | undefined;

export function actionErrorKey(error: Err): ActionErrorKey {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (text.includes('this job cannot be started')) return 'myjobs.errors.cannotStart';
  if (text.includes('this job cannot be completed')) return 'myjobs.errors.cannotComplete';
  if (text.includes('upload the material bill')) return 'myjobs.errors.billRequired';
  if (text.includes('invalid bill path')) return 'myjobs.errors.billInvalid';
  if (text.includes('cannot take a bill') || text.includes('has no materials')) return 'myjobs.errors.billNotAllowed';
  if (text.includes('network') || text.includes('fetch') || error?.name === 'TypeError') return 'myjobs.errors.network';
  return 'myjobs.errors.generic';
}

// ---------------------------------------------------------------- the material bill (a photo)
const BILL_MIMES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export type BillCheck = { ok: true; extension: string } | { ok: false; key: 'myjobs.errors.billType' | 'myjobs.errors.billSize' | 'myjobs.errors.billUpload' };

/** A bill is a photo up to 5 MB (the job-media bucket limit). */
export function checkBill(mime: string | null | undefined, bytes: number): BillCheck {
  const extension = BILL_MIMES[(mime ?? '').toLowerCase()];
  if (!extension) return { ok: false, key: 'myjobs.errors.billType' };
  if (bytes <= 0) return { ok: false, key: 'myjobs.errors.billUpload' };
  if (bytes > MAX_FILE_BYTES) return { ok: false, key: 'myjobs.errors.billSize' };
  return { ok: true, extension };
}

/** "<worker id>/bill-<time>-<random>.<ext>": complete_job requires the first folder to be the worker's own id. */
export function buildBillPath(userId: string, extension: string, now: number, random: string): string {
  return `${userId}/bill-${now}-${random}.${extension}`;
}

// ---------------------------------------------------------------- the calls
export type ActionClient = {
  startJob(jobId: string): PromiseLike<{ error: Err }>;
  completeJob(jobId: string, billPath: string | null): PromiseLike<{ error: Err }>;
  attachBill(jobId: string, billPath: string): PromiseLike<{ error: Err }>;
  uploadBill(bytes: ArrayBuffer, mime: string, extension: string): PromiseLike<{ path: string | null; error: Err }>;
  deleteBill(path: string): PromiseLike<unknown>;
};

export type ActionResult = { ok: true } | { ok: false; key: ActionErrorKey };

async function guarded(run: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await run();
  } catch (thrown) {
    return { ok: false, key: thrown instanceof Error && thrown.name === 'TypeError' ? 'myjobs.errors.network' : 'myjobs.errors.generic' };
  }
}

export function startJob(client: ActionClient, jobId: string): Promise<ActionResult> {
  return guarded(async () => {
    const { error } = await client.startJob(jobId);
    return error ? { ok: false, key: actionErrorKey(error) } : { ok: true };
  });
}

export type Bill = { bytes: ArrayBuffer; mime: string };

// Answers that prove the database did NOT complete the job, so the uploaded bill can safely be removed.
const DEFINITE_REFUSALS: ActionErrorKey[] = ['myjobs.errors.cannotComplete', 'myjobs.errors.billRequired', 'myjobs.errors.billInvalid'];

/**
 * Marks the job complete. When the accepted quote had materials, the bill photo is required: it is checked and
 * uploaded first, and removed again if the job could not be completed (so nothing is left behind).
 */
export function completeJob(
  client: ActionClient,
  input: { jobId: string; materials: number; bill: Bill | null; billAttached?: boolean },
): Promise<ActionResult> {
  return guarded(async () => {
    let path: string | null = null;
    // A bill attached earlier (attach_material_bill) counts: the photo is only needed here when none is on file.
    if (input.materials > 0 && !input.bill && !input.billAttached) return { ok: false, key: 'myjobs.errors.billRequired' };
    if (input.bill) {
      const check = checkBill(input.bill.mime, input.bill.bytes.byteLength);
      if (!check.ok) return { ok: false, key: check.key };
      const uploaded = await client.uploadBill(input.bill.bytes, input.bill.mime.toLowerCase(), check.extension);
      if (uploaded.error || !uploaded.path) return { ok: false, key: 'myjobs.errors.billUpload' };
      path = uploaded.path;
    }
    const { error } = await client.completeJob(input.jobId, path);
    if (error) {
      const key = actionErrorKey(error);
      // Remove the upload only when the database definitely refused the job. After a network or unknown error the
      // job may really have been completed, and then the bill is the resident's evidence: keep it (a retry reuses
      // a new upload, an orphan file costs nothing).
      if (path && DEFINITE_REFUSALS.includes(key)) await client.deleteBill(path).then(undefined, () => undefined);
      return { ok: false, key };
    }
    return { ok: true };
  });
}

/**
 * Attaches (or replaces) the material bill photo any time until the job is completed; the customer sees it in view
 * quote. The photo is checked and uploaded first and removed again if the database refused it.
 */
export function attachBill(client: ActionClient, input: { jobId: string; bill: Bill }): Promise<ActionResult> {
  return guarded(async () => {
    const check = checkBill(input.bill.mime, input.bill.bytes.byteLength);
    if (!check.ok) return { ok: false, key: check.key };
    const uploaded = await client.uploadBill(input.bill.bytes, input.bill.mime.toLowerCase(), check.extension);
    if (uploaded.error || !uploaded.path) return { ok: false, key: 'myjobs.errors.billUpload' };
    const { error } = await client.attachBill(input.jobId, uploaded.path);
    if (error) {
      const key = actionErrorKey(error);
      if (DEFINITE_REFUSALS.includes(key) || key === 'myjobs.errors.billNotAllowed') {
        await client.deleteBill(uploaded.path).then(undefined, () => undefined);
      }
      return { ok: false, key };
    }
    return { ok: true };
  });
}
