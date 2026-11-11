'use server';

import { revalidatePath } from 'next/cache';
import { BAD_REQUEST, field, refusal, type ActionState } from '@/lib/action';
import { requireAdmin } from '@/lib/auth';
import { isUuid } from '@/lib/json';

export async function setReviewHiddenAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('reviewId');
  const hide = formData.get('hide') === '1';
  const reason = field(formData, 'reason', 500);
  if (!isUuid(id)) return BAD_REQUEST;
  if (reason.length < 3) return { error: 'Write a reason (at least 3 characters).' };
  const { error } = await supabase.rpc('admin_set_review_hidden', { p_review: id, p_hidden: hide, p_reason: reason });
  if (error) return (await refusal(error))!;
  revalidatePath('/reviews');
  revalidatePath('/users');
  return { ok: hide ? 'Hidden. It no longer counts in the average.' : 'Shown again.' };
}
