-- 0077 (22 Nov 2026): a worker can clear the settled cards from My Dues.
-- Only the worker's own view changes: a due that is paid or waived, and a payment that staff confirmed or rejected, gets a
-- "hidden from the worker" stamp. Nothing is deleted, the money totals (owed, paid so far) are unchanged, and staff in the portal
-- still see everything. Dues that are still owed and payments that are waiting for staff can never be cleared.

alter table public.worker_dues add column worker_hidden_at timestamptz;
alter table public.dues_payments add column worker_hidden_at timestamptz;

-- p_which: 'dues' or 'payments'. Returns how many cards were cleared. Also works for a suspended worker (like my_dues).
create function public.clear_my_dues_history(p_which text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'worker') then
    raise exception 'not available' using errcode = '42501';
  end if;
  if p_which = 'dues' then
    -- the API role refuses an UPDATE without a WHERE clause (safeupdate), so every statement has an explicit one
    update public.worker_dues wd
       set worker_hidden_at = now()
     where wd.worker_id = v_uid
       and wd.worker_hidden_at is null
       and wd.id in (select r.due_id from private.dues_rows(v_uid) r where r.remaining = 0);
  elsif p_which = 'payments' then
    update public.dues_payments dp
       set worker_hidden_at = now()
     where dp.worker_id = v_uid
       and dp.worker_hidden_at is null
       and dp.status in ('confirmed', 'rejected');
  else
    raise exception 'choose dues or payments' using errcode = 'P0001';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.clear_my_dues_history(text) from public, anon;
grant execute on function public.clear_my_dues_history(text) to authenticated;

-- My Dues leaves out the cleared cards (the rest of the function is unchanged from 0075). The allocation still runs over every due.
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
    'pay_accounts', coalesce((select jsonb_agg(jsonb_build_object('method', x.method, 'label', x.label, 'title', x.account_title, 'number', x.account_number) order by x.position)
                                from public.dues_pay_accounts x), '[]'::jsonb),
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
                join public.worker_dues wd on wd.id = r.due_id
                join public.jobs j on j.id = r.job_id
               where wd.worker_hidden_at is null
               order by r.accrued_at desc, r.due_id
               limit v_limit) x), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('id', dp.id, 'amount', dp.amount, 'method', dp.method, 'reference', dp.reference,
                         'status', dp.status, 'has_proof', dp.proof_path is not null, 'created_at', dp.created_at, 'decided_at', dp.decided_at,
                         'reason', dp.decision_reason, 'by_staff', dp.created_by <> v_uid)
                       order by dp.created_at desc, dp.id)
        from (select * from public.dues_payments d2 where d2.worker_id = v_uid and d2.worker_hidden_at is null order by d2.created_at desc, d2.id limit 30) dp),
      '[]'::jsonb));
end;
$$;
