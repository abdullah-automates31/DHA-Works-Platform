'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { refusal } from '@/lib/action';
import { requireAdmin } from '@/lib/auth';
import { isUuid } from './parse';
import { canSubmit, isDecision, normaliseChecks, REASON_MAX, REASON_MIN, type Role } from './rules';

export type DecideState = { error?: string };

/**
 * Sends one verification decision. The form is checked again here (never trust the browser), then the database
 * function applies its own rules: verified admin session, status, checklist, reason, audit and notification.
 */
export async function decideAction(_prev: DecideState, formData: FormData): Promise<DecideState> {
  const { supabase } = await requireAdmin();

  const profileId = formData.get('profileId');
  const role = formData.get('role');
  const decision = formData.get('decision');
  const reason = typeof formData.get('reason') === 'string' ? (formData.get('reason') as string) : '';
  if (!isUuid(profileId) || (role !== 'worker' && role !== 'resident') || !isDecision(role as Role, decision)) {
    return { error: 'That request was not understood. Reload the page and try again.' };
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(typeof formData.get('checks') === 'string' ? (formData.get('checks') as string) : '{}');
  } catch {
    parsed = null;
  }
  const checks = normaliseChecks(role, parsed);
  const ok = canSubmit(role, decision, checks, reason);
  if (!ok.ok) return { error: ok.hint };

  const { error } = await supabase.rpc('admin_decide_verification', {
    p_profile: profileId,
    p_decision: decision,
    p_reason: reason.trim(),
    p_checklist: checks,
  });
  // A decision needs a code typed in the last 15 minutes (migration 0049): that sends the person to /confirm and back.
  // Every other refusal comes back as a plain sentence.
  if (error) return (await refusal(error))!;
  // The sidebar counts live in the layout, so refresh it too (otherwise the badge keeps the old number).
  revalidatePath('/', 'layout');
  redirect(`/${role}s?done=${decision}`);
}

/**
 * Lets a rejected applicant apply again (migration 0054): the application goes back to "needs changes" with the reason
 * staff wrote. The database checks the verified session, the fresh code, the status and the reason.
 */
export async function reopenAction(_prev: DecideState, formData: FormData): Promise<DecideState> {
  const { supabase } = await requireAdmin();

  const profileId = formData.get('profileId');
  const role = formData.get('role');
  const reason = typeof formData.get('reason') === 'string' ? (formData.get('reason') as string).trim() : '';
  if (!isUuid(profileId) || (role !== 'worker' && role !== 'resident')) {
    return { error: 'That request was not understood. Reload the page and try again.' };
  }
  if (reason.length < REASON_MIN) return { error: 'Write a reason the applicant will see.' };
  if (reason.length > REASON_MAX) return { error: `The reason is too long (${REASON_MAX} characters at most).` };

  const { error } = await supabase.rpc('admin_reopen_rejected', { p_profile: profileId, p_reason: reason });
  // Needs a code typed in the last 15 minutes: that sends the person to /confirm and back.
  if (error) return (await refusal(error))!;
  revalidatePath('/', 'layout');
  redirect(`/${role}s?tab=rejected&done=reopened`);
}
