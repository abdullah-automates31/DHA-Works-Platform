'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { BAD_REQUEST, field, refusal, type ActionState } from '@/lib/action';
import { requireAdmin } from '@/lib/auth';
import { isUuid } from '@/lib/json';
import { createClient } from '@/lib/supabase/server';
import { checkInviteEmail, checkNewPassword, checkSettings, inviteLink } from './rules';

function refresh() {
  revalidatePath('/settings');
}

export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const v = {
    number: field(formData, 'helplineNumber', 20),
    enabled: formData.get('helplineEnabled') === 'on',
    reportDays: Number(field(formData, 'reportDays', 3)),
    reviewDays: Number(field(formData, 'reviewDays', 3)),
  };
  const ok = checkSettings(v);
  if (!ok.ok) return { error: ok.hint };
  const { error } = await supabase.rpc('admin_save_settings', { p_helpline_number: v.number, p_helpline_enabled: v.enabled, p_report_window_days: v.reportDays, p_review_window_days: v.reviewDays });
  if (error) return (await refusal(error))!;
  refresh();
  return { ok: 'Settings saved.' };
}

export async function setCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = Number(field(formData, 'categoryId', 6));
  const active = formData.get('active') === '1';
  const name = field(formData, 'name', 40);
  const subtitle = field(formData, 'subtitle', 80);
  if (!Number.isInteger(id) || id < 1) return BAD_REQUEST;
  const { error } = await supabase.rpc('admin_update_category', { p_id: id, p_name: name, p_subtitle: subtitle, p_active: active });
  if (error) return (await refusal(error))!;
  refresh();
  return { ok: 'Saved.' };
}

export async function addCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const name = field(formData, 'name', 40);
  const subtitle = field(formData, 'subtitle', 80);
  if (name.length < 2) return { error: 'The category name must be 2 to 40 characters.' };
  const { error } = await supabase.rpc('admin_add_category', { p_name: name, p_subtitle: subtitle });
  if (error) return (await refusal(error))!;
  refresh();
  return { ok: `${name} is added. Workers and residents see it in the apps.` };
}

export async function setPhaseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const phase = Number(field(formData, 'phase', 2));
  const active = formData.get('active') === '1';
  if (!Number.isInteger(phase) || phase < 1 || phase > 8) return BAD_REQUEST;
  const { error } = await supabase.rpc('admin_set_phase_active', { p_phase: phase, p_active: active });
  if (error) return (await refusal(error))!;
  refresh();
  return { ok: 'Saved.' };
}

export async function inviteStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const email = field(formData, 'email', 254).toLowerCase();
  const ok = checkInviteEmail(email);
  if (!ok.ok) return { error: ok.hint };
  const { data, error } = await supabase.rpc('invite_staff', { p_email: email });
  if (error) return (await refusal(error))!;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  refresh();
  // The token is shown once, to the inviter, and only its hash is stored. It expires with the invite.
  return { ok: `Invite created. Send this link to ${email} (it is shown only now and works once): ${inviteLink(`${proto}://${host}`, email, String(data))}` };
}

export async function revokeInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('inviteId');
  if (!isUuid(id)) return BAD_REQUEST;
  const { error } = await supabase.rpc('revoke_staff_invite', { p_invite: id });
  if (error) return (await refusal(error))!;
  refresh();
  return { ok: 'Invite cancelled.' };
}

export async function removeStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('profileId');
  const reason = field(formData, 'reason', 500);
  if (!isUuid(id)) return BAD_REQUEST;
  if (reason.length < 3) return { error: 'Write a reason (at least 3 characters).' };
  const { error } = await supabase.rpc('admin_remove_staff', { p_profile: id, p_reason: reason });
  if (error) return (await refusal(error))!;
  refresh();
  return { ok: 'Removed. They are signed out everywhere.' };
}

/**
 * The invited person creates their own account here (nobody else ever sees the password), then the database turns it
 * into an admin account if, and only if, the email and the one-time token match a pending invite. Every failure
 * shows the same sentence so this page cannot be used to learn which emails were invited.
 */
export async function acceptInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = field(formData, 'email', 254).toLowerCase();
  const token = field(formData, 'token', 200);
  const name = field(formData, 'name', 100);
  const password = typeof formData.get('password') === 'string' ? (formData.get('password') as string) : '';
  const confirm = typeof formData.get('confirm') === 'string' ? (formData.get('confirm') as string) : '';
  const generic: ActionState = { error: 'This invitation is not valid, or has expired. Ask the person who invited you for a new one.' };
  if (!checkInviteEmail(email).ok || token.length < 20 || name.length < 2) return generic;
  const pw = checkNewPassword(password, confirm);
  if (!pw.ok) return { error: pw.hint };

  const supabase = await createClient();
  // Check the invitation first, so a stranger cannot create accounts by calling this public page.
  const valid = await supabase.rpc('check_staff_invite', { p_email: email, p_token: token });
  if (valid.error || valid.data !== true) return generic;
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.session) {
    return { error: 'The account could not be created here. If you already have an account with this email, sign in is not enough: ask for help from the person who invited you.' };
  }
  const accepted = await supabase.rpc('accept_staff_invite', { p_email: email, p_token: token, p_full_name: name });
  if (accepted.error) {
    await supabase.auth.signOut();
    return generic;
  }
  await supabase.auth.signOut();
  redirect('/signin?e=invited');
}
