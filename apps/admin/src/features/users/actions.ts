'use server';

import { revalidatePath } from 'next/cache';
import { BAD_REQUEST, field, refusal, type ActionState } from '@/lib/action';
import { requireAdmin } from '@/lib/auth';
import { isUuid } from '@/lib/json';

function refresh(id: string) {
  revalidatePath(`/users/${id}`);
  revalidatePath('/users');
  revalidatePath('/dashboard');
}

export async function setAccountStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('profileId');
  const suspend = formData.get('suspend') === '1';
  const reason = field(formData, 'reason', 500);
  if (!isUuid(id)) return BAD_REQUEST;
  if (reason.length < 3) return { error: 'Write a reason (at least 3 characters).' };
  const { error } = await supabase.rpc('admin_set_account_status', { p_profile: id, p_suspend: suspend, p_reason: reason });
  if (error) return (await refusal(error))!;
  refresh(id);
  return { ok: suspend ? 'The account is suspended. They are signed out everywhere.' : 'The account is active again.' };
}

export async function addStaffNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('profileId');
  const note = field(formData, 'note', 1000);
  if (!isUuid(id)) return BAD_REQUEST;
  if (!note) return { error: 'Write a note first.' };
  const { error } = await supabase.rpc('admin_add_staff_note', { p_profile: id, p_note: note });
  if (error) return (await refusal(error))!;
  refresh(id);
  return { ok: 'Note saved.' };
}

export async function sendMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('profileId');
  const text = field(formData, 'text', 300);
  if (!isUuid(id)) return BAD_REQUEST;
  if (text.length < 3) return { error: 'Write a message (at least 3 characters).' };
  const { error } = await supabase.rpc('admin_send_message', { p_profile: id, p_text: text });
  if (error) return (await refusal(error))!;
  return { ok: 'Message sent. They see it in the app.' };
}
