-- Migration 0073: payment screenshot and more ways to pay (owner, 22 Nov 2026).
--
--   * A worker must attach a screenshot of the payment when they send it (submit_dues_payment gets a fourth argument); staff see it
--     next to Confirm and Reject. The transaction ID stays required too.
--   * More ways to pay: SadaPay, NayaPay and Other, besides JazzCash, Easypaisa and Bank (office cash is staff-recorded only).
--   * The screenshots live in a new private bucket "dues-proof", one folder per worker. The worker uploads to their own folder
--     (a SUSPENDED worker too: they pay to get the account back, so this does not use can_upload_media, which needs an active
--     account); staff read everything; nobody else reads anything. The payment stores only the path.

-- 1. The bucket and who may use it
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dues-proof', 'dues-proof', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

create function public.can_upload_dues_proof()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'worker')
     and (select count(*) from storage.objects o
           where o.bucket_id = 'dues-proof' and o.name like (select auth.uid())::text || '/%') < 60;
$$;
revoke execute on function public.can_upload_dues_proof() from public, anon;
grant execute on function public.can_upload_dues_proof() to authenticated;

create policy dues_proof_owner_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dues-proof'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.can_upload_dues_proof()
  );
create policy dues_proof_read on storage.objects for select to authenticated
  using (
    bucket_id = 'dues-proof'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin())
  );

-- 2. The payment keeps the path, and there are more methods
alter table public.dues_payments add column proof_path text check (char_length(proof_path) <= 200);
alter table public.dues_payments drop constraint dues_payments_method_check;
alter table public.dues_payments add constraint dues_payments_method_check
  check (method in ('jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'other', 'office_cash'));

-- 3. Sending a payment needs the screenshot. The old three-argument function goes: an old app build gets a clear refusal.
drop function public.submit_dues_payment(integer, text, text);
create function public.submit_dues_payment(p_amount integer, p_method text, p_reference text, p_proof_path text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  v_proof text := nullif(btrim(coalesce(p_proof_path, '')), '');
  v_sum jsonb;
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'worker') then
    raise exception 'not available' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dues:' || v_uid::text, 0));
  if p_method is null or p_method not in ('jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'other') then
    raise exception 'choose how you paid';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000000 then
    raise exception 'enter the amount you paid';
  end if;
  if v_ref is null or char_length(v_ref) < 3 or char_length(v_ref) > 60 then
    raise exception 'enter the transaction ID from your payment (3 to 60 characters)';
  end if;
  -- the screenshot: a file in the worker's own folder of the dues-proof bucket that really was uploaded
  if v_proof is null
     or v_proof !~ ('^' || v_uid::text || '/dues/[A-Za-z0-9._-]{1,120}$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'dues-proof' and o.name = v_proof) then
    raise exception 'attach a screenshot of your payment';
  end if;
  v_sum := private.dues_summary(v_uid);
  if (v_sum ->> 'owed')::integer <= 0 then
    raise exception 'you do not owe DHA anything right now';
  end if;
  if p_amount > (v_sum ->> 'owed')::integer then
    raise exception 'the amount is more than you owe';
  end if;
  if (v_sum ->> 'pending_count')::integer >= 3 then
    raise exception 'DHA is still checking your earlier payments; please wait for them to be confirmed';
  end if;
  begin
    insert into public.dues_payments (worker_id, amount, method, reference, proof_path, created_by)
    values (v_uid, p_amount, p_method, v_ref, v_proof, v_uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'this transaction ID was already sent';
  end;
  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (v_uid, 'dues_payment_submitted', 'dues_payments', v_id::text,
          jsonb_build_object('amount', p_amount, 'method', p_method, 'reference', v_ref, 'proof', v_proof));
  return v_id;
end;
$$;
revoke all on function public.submit_dues_payment(integer, text, text, text) from public, anon;
grant execute on function public.submit_dues_payment(integer, text, text, text) to authenticated;

-- 4. Staff see the screenshot path; the worker sees only whether one was attached. Staff can record the new methods too.
create or replace function public.admin_dues_list(p_tab text default 'all', p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tab text := coalesce(p_tab, 'all');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_total integer;
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if v_tab not in ('pending', 'overdue', 'owing', 'suspended', 'all') then
    raise exception 'unknown list';
  end if;
  v_like := case when v_q is null then null
                 else '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  with l as (
    select w.worker_id, w.owed, w.overdue, w.next_due_at, w.overdue_since, w.paid_total, w.pending_total, w.pending_count,
           p.full_name, p.phone, p.account_status
      from private.dues_workers(null) w
      join public.profiles p on p.id = w.worker_id and p.role = 'worker'
     where (v_like is null or p.full_name ilike v_like escape '\' or p.phone ilike v_like escape '\')
       and (v_tab = 'all'
            or (v_tab = 'pending' and w.pending_count > 0)
            or (v_tab = 'overdue' and w.overdue > 0)
            or (v_tab = 'owing' and w.owed > 0)
            or (v_tab = 'suspended' and p.account_status = 'suspended'))
  ), pg as (
    select * from l order by l.overdue desc, l.owed desc, l.full_name, l.worker_id limit v_limit offset v_offset
  )
  select (select count(*)::integer from l),
         coalesce((select jsonb_agg(jsonb_build_object('id', x.worker_id, 'name', x.full_name, 'phone', x.phone,
                          'account_status', x.account_status, 'owed', x.owed, 'overdue', x.overdue, 'next_due_at', x.next_due_at,
                          'overdue_since', x.overdue_since, 'pending_count', x.pending_count, 'pending_total', x.pending_total,
                          'paid_total', x.paid_total)
                        order by x.overdue desc, x.owed desc, x.full_name, x.worker_id) from pg x), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object(
    'total', v_total,
    'rows', v_rows,
    'totals', jsonb_build_object(
      'owed', (select coalesce(sum(w.owed), 0) from private.dues_workers(null) w),
      'overdue', (select coalesce(sum(w.overdue), 0) from private.dues_workers(null) w),
      'pending', (select count(*) from public.dues_payments dp where dp.status = 'pending'),
      'collected_this_month', (select coalesce(sum(dp.amount), 0) from public.dues_payments dp
                                where dp.status = 'confirmed'
                                  and dp.decided_at >= date_trunc('month', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi')),
    'pending_payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', dp.id, 'worker_id', dp.worker_id, 'worker_name', p.full_name, 'amount', dp.amount,
                         'method', dp.method, 'reference', dp.reference, 'proof_path', dp.proof_path, 'created_at', dp.created_at) order by dp.created_at, dp.id)
        from (select * from public.dues_payments d2 where d2.status = 'pending' order by d2.created_at, d2.id limit 50) dp
        join public.profiles p on p.id = dp.worker_id), '[]'::jsonb),
    'pay_to', coalesce((select s.value #>> '{}' from public.app_settings s where s.key = 'dues_pay_to'), ''));
end;
$$;

create or replace function public.admin_dues_worker(p_worker uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_p public.profiles;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  select * into v_p from public.profiles p where p.id = p_worker and p.role = 'worker';
  if not found then
    raise exception 'worker not found';
  end if;
  return jsonb_build_object(
    'worker', jsonb_build_object('id', v_p.id, 'name', v_p.full_name, 'phone', v_p.phone, 'account_status', v_p.account_status,
                                 'suspended_at', v_p.suspended_at, 'suspended_until', v_p.suspended_until, 'suspension_reason', v_p.suspension_reason),
    'summary', private.dues_summary(p_worker),
    'dues', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.due_id, 'job_id', r.job_id, 'job_code', j.code, 'job_title', j.title,
                         'amount', r.amount, 'paid', r.paid, 'remaining', r.remaining, 'accrued_at', r.accrued_at, 'due_at', r.due_at,
                         'waived', r.waived, 'waive_reason', wd.waive_reason, 'waived_at', wd.waived_at,
                         'status', case when r.waived then 'waived' when r.remaining = 0 then 'paid'
                                        when r.due_at < now() then 'overdue' else 'due' end)
                       order by r.accrued_at desc, r.due_id)
        from private.dues_rows(p_worker) r
        join public.worker_dues wd on wd.id = r.due_id
        join public.jobs j on j.id = r.job_id), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', dp.id, 'amount', dp.amount, 'method', dp.method, 'reference', dp.reference, 'note', dp.note,
                         'status', dp.status, 'proof_path', dp.proof_path, 'created_at', dp.created_at, 'decided_at', dp.decided_at, 'reason', dp.decision_reason,
                         'by_staff', dp.created_by <> p_worker, 'created_by_name', cb.full_name, 'decided_by_name', db.full_name)
                       order by dp.created_at desc, dp.id)
        from (select * from public.dues_payments d2 where d2.worker_id = p_worker order by d2.created_at desc, d2.id limit 100) dp
        left join public.profiles cb on cb.id = dp.created_by
        left join public.profiles db on db.id = dp.decided_by), '[]'::jsonb));
end;
$$;

create or replace function public.my_dues(p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_p public.profiles;
begin
  select * into v_p from public.profiles p where p.id = v_uid and p.role = 'worker';
  if not found then
    raise exception 'not available' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'account', jsonb_build_object('status', v_p.account_status, 'reason', v_p.suspension_reason, 'until', v_p.suspended_until),
    'summary', private.dues_summary(v_uid),
    'pay_to', coalesce((select s.value #>> '{}' from public.app_settings s where s.key = 'dues_pay_to'), ''),
    'helpline', case when coalesce((select (s.value #>> '{}')::boolean from public.app_settings s where s.key = 'helpline_enabled'), false)
                     then nullif(coalesce((select s.value #>> '{}' from public.app_settings s where s.key = 'helpline_number'), ''), '') end,
    'dues', coalesce((
      select jsonb_agg(x.item order by x.accrued_at desc, x.due_id)
        from (select r.accrued_at, r.due_id,
                     jsonb_build_object('id', r.due_id, 'job_id', r.job_id, 'job_code', j.code, 'job_title', j.title,
                       'amount', r.amount, 'paid', r.paid, 'remaining', r.remaining, 'accrued_at', r.accrued_at, 'due_at', r.due_at,
                       'status', case when r.waived then 'waived' when r.remaining = 0 then 'paid'
                                      when r.due_at < now() then 'overdue' else 'due' end) as item
                from private.dues_rows(v_uid) r
                join public.jobs j on j.id = r.job_id
               order by r.accrued_at desc, r.due_id
               limit v_limit) x), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', dp.id, 'amount', dp.amount, 'method', dp.method, 'reference', dp.reference,
                         'status', dp.status, 'has_proof', dp.proof_path is not null, 'created_at', dp.created_at, 'decided_at', dp.decided_at,
                         'reason', dp.decision_reason, 'by_staff', dp.created_by <> v_uid)
                       order by dp.created_at desc, dp.id)
        from (select * from public.dues_payments d2 where d2.worker_id = v_uid order by d2.created_at desc, d2.id limit 30) dp),
      '[]'::jsonb));
end;
$$;

create or replace function public.admin_dues_record_payment(p_worker uuid, p_amount integer, p_method text, p_reference text default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_worker and p.role = 'worker') then
    raise exception 'worker not found';
  end if;
  if p_method is null or p_method not in ('jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'other', 'office_cash') then
    raise exception 'choose how the payment was made';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000000 then
    raise exception 'enter the amount received';
  end if;
  if p_method <> 'office_cash' and (v_ref is null or char_length(v_ref) < 3 or char_length(v_ref) > 60) then
    raise exception 'enter the transaction ID (3 to 60 characters)';
  end if;
  if v_ref is not null and char_length(v_ref) > 60 then
    raise exception 'the reference is too long';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'the note is too long';
  end if;
  begin
    insert into public.dues_payments (worker_id, amount, method, reference, note, status, created_by, decided_by, decided_at)
    values (p_worker, p_amount, p_method, v_ref, v_note, 'confirmed', v_uid, v_uid, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'this transaction ID was already used';
  end;
  insert into public.audit_log (actor_id, action, table_name, record_id, new_data, reason)
  values (v_uid, 'dues_payment_recorded', 'dues_payments', v_id::text,
          jsonb_build_object('worker_id', p_worker, 'amount', p_amount, 'method', p_method, 'reference', v_ref), v_note);
  perform private.notify(p_worker, 'dues_payment_decided', null,
    jsonb_build_object('status', 'confirmed', 'amount', p_amount, 'reason', null));
  return v_id;
end;
$$;

