'use server';

import { revalidatePath } from 'next/cache';
import { BAD_REQUEST, field, refusal, type ActionState } from '@/lib/action';
import { requireAdmin } from '@/lib/auth';
import { isUuid } from '@/lib/json';
import { checkCall } from './rules';

export async function logCallAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const v = {
    name: field(formData, 'name', 100), phone: field(formData, 'phone', 20), role: field(formData, 'role', 20), reason: field(formData, 'reason', 20),
    outcome: field(formData, 'outcome', 20), notes: field(formData, 'notes', 1000),
  };
  const code = field(formData, 'caseCode', 20);
  const ok = checkCall(v);
  if (!ok.ok) return { error: ok.hint };
  const { error } = await supabase.rpc('admin_log_call', {
    p_name: v.name, p_phone: v.phone, p_role: v.role, p_reason: v.reason, p_outcome: v.outcome, p_notes: v.notes, p_report_code: code,
  });
  if (error) return (await refusal(error))!;
  revalidatePath('/helpline');
  return { ok: 'Call saved.' };
}

export async function callbackDoneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('callId');
  if (!isUuid(id)) return BAD_REQUEST;
  const { error } = await supabase.rpc('admin_helpline_callback_done', { p_call: id });
  if (error) return (await refusal(error))!;
  revalidatePath('/helpline');
  return { ok: 'Done.' };
}
