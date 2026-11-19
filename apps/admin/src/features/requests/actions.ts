'use server';

import { revalidatePath } from 'next/cache';
import { BAD_REQUEST, field, refusal, type ActionState } from '@/lib/action';
import { requireAdmin } from '@/lib/auth';
import { isUuid } from '@/lib/json';

export async function replyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('requestId');
  if (!isUuid(id)) return BAD_REQUEST;
  const reply = field(formData, 'reply', 1000);
  if (reply.length < 2) return { error: 'Write an answer first.' };
  const { error } = await supabase.rpc('admin_request_reply', { p_id: id, p_reply: reply });
  if (error) return (await refusal(error))!;
  revalidatePath('/requests');
  return { ok: 'Answer sent to the worker.' };
}

export async function approveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('requestId');
  if (!isUuid(id)) return BAD_REQUEST;
  const { error } = await supabase.rpc('admin_request_decide', { p_id: id, p_decision: 'approve' });
  if (error) return (await refusal(error))!;
  revalidatePath('/requests');
  return { ok: 'Approved. The worker was told.' };
}

export async function rejectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('requestId');
  if (!isUuid(id)) return BAD_REQUEST;
  const reason = field(formData, 'reason', 1000);
  if (reason.length < 3) return { error: 'Write the reason for the worker.' };
  const { error } = await supabase.rpc('admin_request_decide', { p_id: id, p_decision: 'reject', p_reason: reason });
  if (error) return (await refusal(error))!;
  revalidatePath('/requests');
  return { ok: 'Rejected. The worker was told why.' };
}

export async function reviewedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('requestId');
  if (!isUuid(id)) return BAD_REQUEST;
  const { error } = await supabase.rpc('admin_request_ack', { p_id: id });
  if (error) return (await refusal(error))!;
  revalidatePath('/requests');
  return { ok: 'Marked as reviewed.' };
}
