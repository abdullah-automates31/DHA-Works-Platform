-- 0075 (22 Nov 2026): DHA's payment accounts, one row per place a worker can pay (JazzCash, Easypaisa, bank, ...).
--
-- Until now "where to pay" was one block of free text (setting dues_pay_to). Workers had to read it and retype the number, and a
-- typing slip sends money to a stranger. Staff now enter each account as method + account title + number, and My Dues shows
-- each one as its own card with a large number that can be pressed and held to copy. The free text stays as an optional note.
--
--   dues_pay_accounts           closed table (RLS on, no policy, no grant): reached only through the functions below
--   admin_dues_pay_accounts()   staff read the list (the Settings form)
--   admin_dues_pay_accounts_save(jsonb)   staff replace the list (up to 6 accounts); freshness check, audit row
--   my_dues()                   gains "pay_accounts" (a customer cannot reach it: closed table, worker-only function)

create table public.dues_pay_accounts (
  id             uuid primary key default gen_random_uuid(),
  position       smallint not null check (position between 1 and 6),
  method         text not null check (method in ('jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'raast', 'other')),
  label          text check (label is null or char_length(label) between 1 and 40),
  account_title  text not null check (char_length(account_title) between 1 and 60),
  account_number text not null check (char_length(account_number) between 3 and 40),
  updated_at     timestamptz not null default now(),
  unique (position)
);
alter table public.dues_pay_accounts enable row level security;
revoke all on public.dues_pay_accounts from public, anon, authenticated;

create function public.admin_dues_pay_accounts()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('method', x.method, 'label', x.label, 'title', x.account_title, 'number', x.account_number) order by x.position)
                     from public.dues_pay_accounts x), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_dues_pay_accounts() from public, anon;
grant execute on function public.admin_dues_pay_accounts() to authenticated;

create function public.admin_dues_pay_accounts_save(p_accounts jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_item jsonb;
  v_i integer := 0;
  v_method text;
  v_label text;
  v_title text;
  v_number text;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  -- changing where workers send money is a sensitive change
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'array' then
    raise exception 'send the accounts as a list';
  end if;
  if jsonb_array_length(p_accounts) > 6 then
    raise exception 'at most 6 accounts';
  end if;

  v_old := public.admin_dues_pay_accounts();
  delete from public.dues_pay_accounts;
  for v_item in select * from jsonb_array_elements(p_accounts) loop
    v_i := v_i + 1;
    v_method := lower(btrim(coalesce(v_item ->> 'method', '')));
    v_label := nullif(btrim(coalesce(v_item ->> 'label', '')), '');
    v_title := btrim(coalesce(v_item ->> 'title', ''));
    v_number := btrim(coalesce(v_item ->> 'number', ''));
    if v_method not in ('jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'raast', 'other') then
      raise exception 'account %: choose how workers pay', v_i;
    end if;
    if char_length(v_title) < 1 or char_length(v_title) > 60 then
      raise exception 'account %: enter the account title (up to 60 characters)', v_i;
    end if;
    if char_length(v_number) < 3 or char_length(v_number) > 40 then
      raise exception 'account %: enter the number (3 to 40 characters)', v_i;
    end if;
    if v_label is not null and char_length(v_label) > 40 then
      raise exception 'account %: the name is too long (40 characters)', v_i;
    end if;
    insert into public.dues_pay_accounts (position, method, label, account_title, account_number)
    values (v_i, v_method, v_label, v_title, v_number);
  end loop;
  v_new := public.admin_dues_pay_accounts();
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  values (v_uid, 'dues_pay_accounts_saved', 'dues_pay_accounts', 'all', jsonb_build_object('accounts', v_old), jsonb_build_object('accounts', v_new));
end;
$$;
revoke all on function public.admin_dues_pay_accounts_save(jsonb) from public, anon;
grant execute on function public.admin_dues_pay_accounts_save(jsonb) to authenticated;

-- My Dues now carries the accounts (the rest of the function is unchanged from 0073)
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
