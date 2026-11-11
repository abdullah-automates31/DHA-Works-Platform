'use server';

import { revalidatePath } from 'next/cache';
import { BAD_REQUEST, field, refusal, type ActionState } from '@/lib/action';
import { requireAdmin } from '@/lib/auth';
import { isUuid } from '@/lib/json';
import { canDecide, isChoice } from './rules';

function refresh(id: string) {
  revalidatePath(`/reports/${id}`);
  revalidatePath('/reports');
  revalidatePath('/dashboard');
  revalidatePath('/', 'layout'); // the sidebar "open reports" badge
}

/** One decision on a case. The form is checked again here; the database then applies its own rules and audits it. */
export async function decideReportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('reportId');
  const choice = formData.get('choice');
  const reason = field(formData, 'reason', 500);
  if (!isUuid(id) || !isChoice(choice)) return BAD_REQUEST;
  const ok = canDecide(choice, reason);
  if (!ok.ok) return { error: ok.hint };
  const { error } = await supabase.rpc('admin_report_decide', { p_report: id, p_choice: choice, p_reason: reason });
  if (error) return (await refusal(error))!;
  refresh(id);
  return { ok: choice === 'keep_open' ? 'The case is in review and assigned to you.' : 'The case is resolved.' };
}

export async function addReportNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('reportId');
  const note = field(formData, 'note', 1000);
  if (!isUuid(id)) return BAD_REQUEST;
  if (!note) return { error: 'Write a note first.' };
  const { error } = await supabase.rpc('admin_report_add_note', { p_report: id, p_note: note });
  if (error) return (await refusal(error))!;
  refresh(id);
  return { ok: 'Note saved.' };
}

export async function logCallAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('reportId');
  const calledId = formData.get('calledId');
  const outcome = field(formData, 'outcome', 300);
  if (!isUuid(id) || !isUuid(calledId)) return { error: 'Choose who you called.' };
  const { error } = await supabase.rpc('admin_report_log_call', { p_report: id, p_called: calledId, p_outcome: outcome });
  if (error) return (await refusal(error))!;
  refresh(id);
  return { ok: 'Call recorded.' };
}
