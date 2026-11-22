'use server';

import { revalidatePath } from 'next/cache';
import { BAD_REQUEST, field, refusal, type ActionState } from '@/lib/action';
import { requireAdmin } from '@/lib/auth';
import { isUuid } from '@/lib/json';
import { METHODS, parseRupees } from './parse';

// Every action calls requireAdmin() and the database function checks again (is_admin, the code freshness, an audit row).
// A decision also moves the sidebar badge, so the layout is revalidated.
function refresh(workerId?: string | null) {
  revalidatePath('/dues');
  if (workerId) {
    revalidatePath(`/users/${workerId}`);
    revalidatePath(`/workers/${workerId}`);
  }
  revalidatePath('/', 'layout');
}

/** Confirm (with the amount that really arrived, if it differs) or reject (with a reason the worker sees) a payment. */
export async function decidePaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const id = formData.get('paymentId');
  const workerId = formData.get('workerId');
  const confirm = formData.get('decision') === 'confirm';
  if (!isUuid(id)) return BAD_REQUEST;
  const reason = field(formData, 'reason', 300);
  let amount: number | undefined;
  if (confirm) {
    const typed = field(formData, 'amount', 12);
    if (typed !== '') {
      const n = parseRupees(typed);
      if (n === null) return { error: 'Enter the amount that arrived in whole rupees, or leave it as it is.' };
      amount = n;
    }
  } else if (reason.length < 3) {
    return { error: 'Write the reason for the worker (at least 3 characters).' };
  }
  const { error } = await supabase.rpc('admin_dues_payment_decide', {
    p_payment: id,
    p_confirm: confirm,
    ...(amount === undefined ? {} : { p_amount: amount }),
    ...(reason === '' ? {} : { p_reason: reason }),
  });
  if (error) return (await refusal(error))!;
  refresh(isUuid(workerId) ? workerId : null);
  return { ok: confirm ? 'Payment confirmed. The worker was told.' : 'Payment rejected. The worker was told why.' };
}

/** A payment that reached DHA outside the app (cash at the office, or a transfer the worker did not enter). */
export async function recordPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const workerId = formData.get('workerId');
  const method = formData.get('method');
  if (!isUuid(workerId) || typeof method !== 'string' || !(METHODS as readonly string[]).includes(method)) return BAD_REQUEST;
  const amount = parseRupees(field(formData, 'amount', 12));
  if (amount === null) return { error: 'Enter the amount received in whole rupees.' };
  const reference = field(formData, 'reference', 60);
  if (method !== 'office_cash' && reference.length < 3) return { error: 'Enter the transaction ID (at least 3 characters).' };
  const note = field(formData, 'note', 300);
  const { error } = await supabase.rpc('admin_dues_record_payment', {
    p_worker: workerId,
    p_amount: amount,
    p_method: method,
    ...(reference === '' ? {} : { p_reference: reference }),
    ...(note === '' ? {} : { p_note: note }),
  });
  if (error) return (await refusal(error))!;
  refresh(workerId);
  return { ok: 'Payment recorded. The worker was told.' };
}

export async function waiveDueAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const dueId = formData.get('dueId');
  const workerId = formData.get('workerId');
  if (!isUuid(dueId)) return BAD_REQUEST;
  const reason = field(formData, 'reason', 300);
  if (reason.length < 3) return { error: 'Write a reason (at least 3 characters).' };
  const { error } = await supabase.rpc('admin_dues_waive', { p_due: dueId, p_reason: reason });
  if (error) return (await refusal(error))!;
  refresh(isUuid(workerId) ? workerId : null);
  return { ok: 'The due was waived.' };
}

export async function warnWorkerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const workerId = formData.get('workerId');
  if (!isUuid(workerId)) return BAD_REQUEST;
  const text = field(formData, 'text', 300);
  if (text.length < 3) return { error: 'Write the warning (at least 3 characters).' };
  const { error } = await supabase.rpc('admin_dues_warn', { p_worker: workerId, p_text: text });
  if (error) return (await refusal(error))!;
  refresh(workerId);
  return { ok: 'Warning sent. The worker sees it in the app.' };
}

/** Where workers pay DHA: shown in My Dues in the worker app. */
export async function savePayToAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const text = field(formData, 'text', 500);
  const { error } = await supabase.rpc('admin_dues_pay_to_save', { p_text: text });
  if (error) return (await refusal(error))!;
  revalidatePath('/dues');
  revalidatePath('/settings');
  return { ok: text === '' ? 'Payment details removed.' : 'Saved. Workers see this in My Dues.' };
}
