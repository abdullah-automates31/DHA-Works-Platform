'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { refusal } from '@/lib/action';
import { requireAdmin } from '@/lib/auth';
import { isUuid } from './parse';
import { canSubmit, isDecision, normaliseChecks, type Role } from './rules';

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
