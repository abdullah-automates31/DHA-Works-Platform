'use server';

import { revalidatePath } from 'next/cache';
import { BAD_REQUEST, field, refusal, type ActionState } from '@/lib/action';
import { requireAdmin } from '@/lib/auth';
import { isUuid } from '@/lib/json';

function refresh(jobId: string | null) {
  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath('/jobs');
  revalidatePath('/jobs/cancellations');
  revalidatePath('/dashboard');
}

function needReason(reason: string): ActionState | null {
  return reason.length < 3 ? { error: 'Write a reason (at least 3 characters).' } : null;
}

export async function cancelJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const jobId = formData.get('jobId');
  const reason = field(formData, 'reason', 500);
  if (!isUuid(jobId)) return BAD_REQUEST;
  const bad = needReason(reason);
  if (bad) return bad;
  const { error } = await supabase.rpc('admin_cancel_job', { p_job: jobId, p_reason: reason });
  if (error) return (await refusal(error))!;
  refresh(jobId);
  return { ok: 'The job is cancelled and both people have been told.' };
}

export async function resumeJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const jobId = formData.get('jobId');
  const note = field(formData, 'note', 500);
  if (!isUuid(jobId)) return BAD_REQUEST;
  const bad = needReason(note);
  if (bad) return bad;
  const { error } = await supabase.rpc('admin_job_resume', { p_job: jobId, p_note: note });
  if (error) return (await refusal(error))!;
  refresh(jobId);
  return { ok: 'The job is no longer under review.' };
}

export async function replaceWorkerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const jobId = formData.get('jobId');
  const reason = field(formData, 'reason', 500);
  if (!isUuid(jobId)) return BAD_REQUEST;
  const bad = needReason(reason);
  if (bad) return bad;
  const { error } = await supabase.rpc('admin_job_replace_worker', { p_job: jobId, p_reason: reason });
  if (error) return (await refusal(error))!;
  refresh(jobId);
  return { ok: 'The worker is replaced. The job is open again for other workers.' };
}

export async function decideCancellationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const requestId = formData.get('requestId');
  const jobId = formData.get('jobId');
  const decision = formData.get('decision');
  const note = field(formData, 'note', 500);
  if (!isUuid(requestId) || (decision !== 'approve' && decision !== 'decline')) return BAD_REQUEST;
  if (decision === 'decline') {
    const bad = needReason(note);
    if (bad) return { error: 'Write a note the requester will see (at least 3 characters).' };
  }
  const { error } = await supabase.rpc('admin_decide_cancellation', { p_request: requestId, p_approve: decision === 'approve', p_note: note });
  if (error) return (await refusal(error))!;
  refresh(isUuid(jobId) ? jobId : null);
  return { ok: decision === 'approve' ? 'Approved. The job is cancelled and both people have been told.' : 'Declined. The requester has been told why.' };
}
