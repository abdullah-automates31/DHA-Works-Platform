-- Migration 0071: DHA fee on every job and "My Dues" (owner and Shariq Bhai, 22 Nov 2026; reverses "commission 0%" of 27 Oct).
--
-- The fee comes OUT of the worker's quote: the customer sees and pays the quote only (nothing changes for the customer app),
-- the worker collects it in cash and then owes DHA the fee. Each completed job adds a due; the worker pays by transfer and
-- enters the transaction ID; staff confirm (or record office cash, waive, warn). Suspension stays manual
-- (admin_set_account_status, 0053); nothing here suspends anyone.
--
--   fee = 0 when the labour price is 0, else least(labour, greatest(minimum, round(labour * percent / 100)))
--   The base is LABOUR ONLY (owner, 22 Nov): materials are the worker's cost and are never charged. The worker keeps
--   quote - fee. It ships SWITCHED OFF (percent 0, minimum 0): nothing is owed until staff set the rule in Settings > Dues.
--   Open quotes keep fee 0; a revised quote is priced at the current rule.
--
--   quotes.dha_fee                 snapshot per quote (trigger), fixed once the quote is accepted; the worker app shows it
--   settle_cash                    the due is created when the job becomes cash_collected
--   get_my_earnings                the worker's earnings leave the fee out
--   worker_dues, dues_payments     closed tables (RLS on, no policy, no grant): reached only through the functions below
--   private.dues_rows / dues_workers  who has paid what is WORKED OUT on read: confirmed payments clear the oldest dues first
--   my_dues, submit_dues_payment   worker side; they also work for a SUSPENDED worker (to pay their way back)
--   admin_dues_*                   staff side; every change is audited
--   dw-dues-reminders              once a day, 10:00 Karachi: a reminder to workers whose due is near or overdue

-- 1. Fee on the quote -------------------------------------------------------------------------------------------------------
alter table public.quotes add column dha_fee integer not null default 0 check (dha_fee >= 0);

insert into public.app_settings (key, value, description) values
  ('dha_fee_percent', '0'::jsonb, 'DHA fee as a percentage of the worker''s labour price (0 = no fee). Set in Settings > Dues.'),
  ('dha_fee_min',     '0'::jsonb, 'Smallest DHA fee per job in rupees, for jobs with a labour price (0 = none).'),
  ('dues_due_days',   '5'::jsonb, 'Days a worker has to pay a DHA due after the cash is recorded.'),
  ('dues_pay_to',     '""'::jsonb, 'Where workers pay DHA (account title and numbers), shown in My Dues.')
on conflict (key) do nothing;

-- The percent may have one decimal, so it is read as numeric (private.setting_int would fail on 12.5).
create function private.dha_fee(p_labour integer)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case when coalesce(p_labour, 0) <= 0 then 0
         else least(p_labour,   -- the fee can never be more than the labour price
                greatest(
                  coalesce((select (s.value #>> '{}')::numeric from public.app_settings s where s.key = 'dha_fee_min'), 0),
                  round(p_labour * coalesce((select (s.value #>> '{}')::numeric from public.app_settings s where s.key = 'dha_fee_percent'), 0) / 100.0)
                ))::integer
         end;
$$;
revoke all on function private.dha_fee(integer) from public, anon, authenticated;

-- Covers accept_job, revise_quote and the old submit_quote without redefining them. Only a quote that is still "sent" is
-- priced again, so an accepted quote's fee never changes.
create function private.set_quote_dha_fee()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (old.status <> 'sent' or new.labour is not distinct from old.labour) then
    return new;
  end if;
  new.dha_fee := private.dha_fee(new.labour);
  return new;
end;
$$;
revoke all on function private.set_quote_dha_fee() from public, anon, authenticated;
create trigger quotes_dha_fee before insert or update of labour on public.quotes
  for each row execute function private.set_quote_dha_fee();

-- 2. Tables ---------------------------------------------------------------------------------------------------------------
-- No policy and no grant on either table: the apps reach them only through the functions below.
create table public.worker_dues (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid not null unique references public.jobs (id) on delete cascade,
  quote_id uuid references public.quotes (id),
  amount integer not null check (amount > 0),
  accrued_at timestamptz not null default now(),
  due_at timestamptz not null,
  waived_at timestamptz,
  waived_by uuid references public.profiles (id),
  waive_reason text check (char_length(waive_reason) <= 300),
  check ((waived_at is null) = (waived_by is null))
);
alter table public.worker_dues enable row level security;
revoke all on public.worker_dues from public, anon, authenticated;
create index worker_dues_worker_idx on public.worker_dues (worker_id, accrued_at, id);

create table public.dues_payments (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount between 1 and 10000000),
  method text not null check (method in ('jazzcash', 'easypaisa', 'bank', 'office_cash')),
  reference text check (char_length(reference) between 3 and 60),
  note text check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_reason text check (char_length(decision_reason) <= 300),
  check (method = 'office_cash' or reference is not null)
);
alter table public.dues_payments enable row level security;
revoke all on public.dues_payments from public, anon, authenticated;
create index dues_payments_worker_idx on public.dues_payments (worker_id, created_at desc);
create index dues_payments_pending_idx on public.dues_payments (created_at) where status = 'pending';
-- The same transaction ID cannot be used twice (a rejected payment frees it again).
create unique index dues_payments_reference_idx on public.dues_payments (method, upper(btrim(reference)))
  where reference is not null and status <> 'rejected';

-- 3. The due is created when the cash is recorded ----------------------------------------------------------------------
create or replace function private.settle_cash(p_job uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_cash public.cash_records;
  v_job public.jobs;
  v_fee integer;
  v_due timestamptz;
begin
  select * into v_cash from public.cash_records where job_id = p_job;
  if v_cash.worker_amount is null then
    return;
  end if;
  select * into v_job from public.jobs where id = p_job for update;
  if v_job.status <> 'completed' then
    return;
  end if;

  -- The worker's amount is final. The gap against the quote stays on cash_records for staff; the resident
  -- can still file a report or rate the worker low.
  update public.cash_records
     set matched = (resident_amount is null or resident_amount = worker_amount),
         quote_difference = worker_amount - agreed_amount
   where job_id = p_job;
  update public.jobs set status = 'cash_collected', stuck_since = null, stuck_reason = null where id = p_job;
  update public.worker_details set jobs_done = jobs_done + 1 where profile_id = v_job.accepted_worker_id;

  -- DHA's fee is inside that cash, in the worker's hands: it becomes a due (none when the fee is 0).
  select q.dha_fee into v_fee from public.quotes q where q.id = v_job.accepted_quote_id;
  v_fee := coalesce(v_fee, 0);
  if v_fee > 0 then
    v_due := now() + make_interval(days => private.setting_int('dues_due_days', 5));
    insert into public.worker_dues (worker_id, job_id, quote_id, amount, due_at)
    values (v_job.accepted_worker_id, p_job, v_job.accepted_quote_id, v_fee, v_due)
    on conflict (job_id) do nothing;
  end if;

  perform private.record(p_job, 'cash_collected', null,
    jsonb_build_object('worker_amount', v_cash.worker_amount, 'difference', v_cash.worker_amount - v_cash.agreed_amount));
  perform private.notify(v_job.resident_id, 'rate_worker', p_job, jsonb_build_object('title', v_job.title));
  perform private.notify(v_job.accepted_worker_id, 'cash_collected', p_job,
    jsonb_build_object('title', v_job.title, 'dha_fee', v_fee, 'due_at', case when v_fee > 0 then v_due end));
end;
$$;

-- Earnings are the worker's own money: the DHA fee inside the cash they collected is not theirs.
create or replace function public.get_my_earnings(
  p_from timestamptz default date_trunc('week', now()), p_to timestamptz default now()
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker', false);
begin
  return (
    select jsonb_build_object(
      'cash_total', coalesce((select sum(greatest(cr.worker_amount - coalesce(q.dha_fee, 0), 0)) from public.cash_records cr
                              join public.jobs j on j.id = cr.job_id
                              left join public.quotes q on q.id = j.accepted_quote_id
                              where j.accepted_worker_id = v_uid and cr.matched
                                and j.completed_at >= p_from and j.completed_at <= p_to), 0),
      'jobs_count', (select count(*) from public.cash_records cr
                     join public.jobs j on j.id = cr.job_id
                     where j.accepted_worker_id = v_uid and cr.matched
                       and j.completed_at >= p_from and j.completed_at <= p_to),
      'rating_avg', wd.rating_avg,
      'rating_count', wd.rating_count,
      'jobs_done', wd.jobs_done)
    from public.worker_details wd where wd.profile_id = v_uid);
end;
$$;

-- 4. Who has paid what: worked out on read ------------------------------------------------------------------------------------
-- Confirmed payments clear the oldest dues first; a waived due is not counted; a payment above what is owed stays as credit.
-- Nothing is stored per due, so waiving, confirming out of order or correcting an amount never needs a re-allocation.
create function private.dues_rows(p_worker uuid default null)
returns table (worker_id uuid, due_id uuid, job_id uuid, amount integer, accrued_at timestamptz, due_at timestamptz,
               waived boolean, paid integer, remaining integer)
language sql stable security definer set search_path = ''
as $$
  with conf as (
    select dp.worker_id, sum(dp.amount)::bigint as total
      from public.dues_payments dp
     where dp.status = 'confirmed' and (p_worker is null or dp.worker_id = p_worker)
     group by dp.worker_id
  ), d as (
    select wd.id, wd.worker_id, wd.job_id, wd.amount, wd.accrued_at, wd.due_at, (wd.waived_at is not null) as waived,
           coalesce(sum(case when wd.waived_at is null then wd.amount else 0 end)
                    over (partition by wd.worker_id order by wd.accrued_at, wd.id
                          rows between unbounded preceding and 1 preceding), 0) as before_sum
      from public.worker_dues wd
     where p_worker is null or wd.worker_id = p_worker
  )
  select d.worker_id, d.id, d.job_id, d.amount, d.accrued_at, d.due_at, d.waived,
         (case when d.waived then 0
               else least(d.amount, greatest(0, coalesce(c.total, 0) - d.before_sum)) end)::integer,
         (case when d.waived then 0
               else d.amount - least(d.amount, greatest(0, coalesce(c.total, 0) - d.before_sum)) end)::integer
    from d left join conf c on c.worker_id = d.worker_id;
$$;
revoke all on function private.dues_rows(uuid) from public, anon, authenticated;

-- One row per worker who has any due or payment (or just the one asked for): what is owed, overdue, paid, waiting, in credit.
create function private.dues_workers(p_worker uuid default null)
returns table (worker_id uuid, owed integer, overdue integer, next_due_at timestamptz, overdue_since timestamptz,
               paid_total integer, pending_total integer, pending_count integer, credit integer)
language sql stable security definer set search_path = ''
as $$
  with agg as (
    select r.worker_id,
           coalesce(sum(r.remaining), 0)::integer as owed,
           coalesce(sum(r.remaining) filter (where r.due_at < now()), 0)::integer as overdue,
           min(r.due_at) filter (where r.remaining > 0) as next_due_at,
           min(r.due_at) filter (where r.remaining > 0 and r.due_at < now()) as overdue_since,
           coalesce(sum(r.amount) filter (where not r.waived), 0)::bigint as accrued_total
      from private.dues_rows(p_worker) r
     group by r.worker_id
  ), pay as (
    select dp.worker_id,
           coalesce(sum(dp.amount) filter (where dp.status = 'confirmed'), 0)::bigint as confirmed,
           coalesce(sum(dp.amount) filter (where dp.status = 'pending'), 0)::integer as pending_total,
           (count(*) filter (where dp.status = 'pending'))::integer as pending_count
      from public.dues_payments dp
     where p_worker is null or dp.worker_id = p_worker
     group by dp.worker_id
  ), ids as (
    select a.worker_id from agg a union select p.worker_id from pay p
  )
  select i.worker_id, coalesce(a.owed, 0), coalesce(a.overdue, 0), a.next_due_at, a.overdue_since,
         coalesce(p.confirmed, 0)::integer, coalesce(p.pending_total, 0), coalesce(p.pending_count, 0),
         greatest(0, coalesce(p.confirmed, 0) - coalesce(a.accrued_total, 0))::integer
    from ids i
    left join agg a on a.worker_id = i.worker_id
    left join pay p on p.worker_id = i.worker_id;
$$;
revoke all on function private.dues_workers(uuid) from public, anon, authenticated;

create function private.dues_summary(p_worker uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('owed', w.owed, 'overdue', w.overdue, 'next_due_at', w.next_due_at,
                               'overdue_since', w.overdue_since, 'paid_total', w.paid_total,
                               'pending_total', w.pending_total, 'pending_count', w.pending_count, 'credit', w.credit)
       from private.dues_workers(p_worker) w where w.worker_id = p_worker),
    jsonb_build_object('owed', 0, 'overdue', 0, 'next_due_at', null, 'overdue_since', null, 'paid_total', 0,
                       'pending_total', 0, 'pending_count', 0, 'credit', 0));
$$;
revoke all on function private.dues_summary(uuid) from public, anon, authenticated;

-- 5. Worker side (also for a suspended worker: they pay here to be reactivated) -----------------------------------------------
create function public.my_dues(p_limit integer default 50)
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
                         'status', dp.status, 'created_at', dp.created_at, 'decided_at', dp.decided_at,
                         'reason', dp.decision_reason, 'by_staff', dp.created_by <> v_uid)
                       order by dp.created_at desc, dp.id)
        from (select * from public.dues_payments d2 where d2.worker_id = v_uid order by d2.created_at desc, d2.id limit 30) dp),
      '[]'::jsonb));
end;
$$;
revoke all on function public.my_dues(integer) from public, anon;
grant execute on function public.my_dues(integer) to authenticated;

create function public.submit_dues_payment(p_amount integer, p_method text, p_reference text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  v_sum jsonb;
  v_id uuid;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'worker') then
    raise exception 'not available' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dues:' || v_uid::text, 0));
  if p_method is null or p_method not in ('jazzcash', 'easypaisa', 'bank') then
    raise exception 'choose how you paid: JazzCash, Easypaisa or bank';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000000 then
    raise exception 'enter the amount you paid';
  end if;
  if v_ref is null or char_length(v_ref) < 3 or char_length(v_ref) > 60 then
    raise exception 'enter the transaction ID from your payment (3 to 60 characters)';
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
    insert into public.dues_payments (worker_id, amount, method, reference, created_by)
    values (v_uid, p_amount, p_method, v_ref, v_uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'this transaction ID was already sent';
  end;
  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (v_uid, 'dues_payment_submitted', 'dues_payments', v_id::text,
          jsonb_build_object('amount', p_amount, 'method', p_method, 'reference', v_ref));
  return v_id;
end;
$$;
revoke all on function public.submit_dues_payment(integer, text, text) from public, anon;
grant execute on function public.submit_dues_payment(integer, text, text) to authenticated;

-- 6. Staff side ---------------------------------------------------------------------------------------------------------------
create function public.admin_dues_counts()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pending', (select count(*) from public.dues_payments dp where dp.status = 'pending'),
    'overdue_workers', (select count(*) from private.dues_workers(null) w where w.overdue > 0));
end;
$$;
revoke all on function public.admin_dues_counts() from public, anon;
grant execute on function public.admin_dues_counts() to authenticated;

-- p_tab: pending (payments waiting), overdue, owing, suspended (suspended workers with a record) or all.
create function public.admin_dues_list(p_tab text default 'all', p_search text default null, p_limit integer default 25, p_offset integer default 0)
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
                         'method', dp.method, 'reference', dp.reference, 'created_at', dp.created_at) order by dp.created_at, dp.id)
        from (select * from public.dues_payments d2 where d2.status = 'pending' order by d2.created_at, d2.id limit 50) dp
        join public.profiles p on p.id = dp.worker_id), '[]'::jsonb),
    'pay_to', coalesce((select s.value #>> '{}' from public.app_settings s where s.key = 'dues_pay_to'), ''));
end;
$$;
revoke all on function public.admin_dues_list(text, text, integer, integer) from public, anon;
grant execute on function public.admin_dues_list(text, text, integer, integer) to authenticated;

create function public.admin_dues_worker(p_worker uuid)
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
                         'status', dp.status, 'created_at', dp.created_at, 'decided_at', dp.decided_at, 'reason', dp.decision_reason,
                         'by_staff', dp.created_by <> p_worker, 'created_by_name', cb.full_name, 'decided_by_name', db.full_name)
                       order by dp.created_at desc, dp.id)
        from (select * from public.dues_payments d2 where d2.worker_id = p_worker order by d2.created_at desc, d2.id limit 100) dp
        left join public.profiles cb on cb.id = dp.created_by
        left join public.profiles db on db.id = dp.decided_by), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_dues_worker(uuid) from public, anon;
grant execute on function public.admin_dues_worker(uuid) to authenticated;

create function public.admin_dues_payment_decide(p_payment uuid, p_confirm boolean, p_amount integer default null, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_old public.dues_payments;
  v_row public.dues_payments;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if p_confirm is null then
    raise exception 'choose confirm or reject';
  end if;
  if not p_confirm and (v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300) then
    raise exception 'give the worker a reason (3 to 300 characters)';
  end if;
  if p_confirm and v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'the note is too long';
  end if;
  if p_confirm and p_amount is not null and (p_amount < 1 or p_amount > 10000000) then
    raise exception 'enter the amount that arrived';
  end if;
  select * into v_old from public.dues_payments where id = p_payment;
  update public.dues_payments
     set status = case when p_confirm then 'confirmed' else 'rejected' end,
         amount = case when p_confirm then coalesce(p_amount, amount) else amount end,
         decided_by = v_uid, decided_at = now(), decision_reason = v_reason
   where id = p_payment and status = 'pending'
  returning * into v_row;
  if not found then
    raise exception 'this payment was already decided, or does not exist';
  end if;
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (v_uid, case when p_confirm then 'dues_payment_confirmed' else 'dues_payment_rejected' end, 'dues_payments', p_payment::text,
          jsonb_build_object('amount', v_old.amount, 'status', 'pending'),
          jsonb_build_object('amount', v_row.amount, 'status', v_row.status), v_reason);
  perform private.notify(v_row.worker_id, 'dues_payment_decided', null,
    jsonb_build_object('status', v_row.status, 'amount', v_row.amount, 'reason', v_reason));
end;
$$;
revoke all on function public.admin_dues_payment_decide(uuid, boolean, integer, text) from public, anon;
grant execute on function public.admin_dues_payment_decide(uuid, boolean, integer, text) to authenticated;

-- A payment that reached DHA outside the app (cash at the office, or a transfer the worker did not enter): confirmed at once.
create function public.admin_dues_record_payment(p_worker uuid, p_amount integer, p_method text, p_reference text default null, p_note text default null)
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
  if p_method is null or p_method not in ('jazzcash', 'easypaisa', 'bank', 'office_cash') then
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
revoke all on function public.admin_dues_record_payment(uuid, integer, text, text, text) from public, anon;
grant execute on function public.admin_dues_record_payment(uuid, integer, text, text, text) to authenticated;

create function public.admin_dues_waive(p_due uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_d public.worker_dues;
  v_remaining integer;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'give a reason (3 to 300 characters)';
  end if;
  select * into v_d from public.worker_dues where id = p_due;
  if not found then
    raise exception 'this due does not exist';
  end if;
  if v_d.waived_at is not null then
    raise exception 'this due was already waived';
  end if;
  select r.remaining into v_remaining from private.dues_rows(v_d.worker_id) r where r.due_id = p_due;
  if coalesce(v_remaining, 0) = 0 then
    raise exception 'this due is already paid';
  end if;
  update public.worker_dues set waived_at = now(), waived_by = v_uid, waive_reason = v_reason
   where id = p_due and waived_at is null;
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (v_uid, 'dues_waived', 'worker_dues', p_due::text,
          jsonb_build_object('worker_id', v_d.worker_id, 'amount', v_d.amount, 'remaining', v_remaining),
          jsonb_build_object('waived', true), v_reason);
end;
$$;
revoke all on function public.admin_dues_waive(uuid, text) from public, anon;
grant execute on function public.admin_dues_waive(uuid, text) to authenticated;

-- A warning notice to a worker who has not paid. For an ACTIVE account only: a suspended worker gets no push and cannot read notices.
create function public.admin_dues_warn(p_worker uuid, p_text text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_sum jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if v_text is null or char_length(v_text) < 3 or char_length(v_text) > 300 then
    raise exception 'write the warning (3 to 300 characters)';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_worker and p.role = 'worker' and p.account_status = 'active') then
    raise exception 'this account is not active; a suspended worker cannot get notices';
  end if;
  v_sum := private.dues_summary(p_worker);
  perform private.notify(p_worker, 'dues_warning', null,
    jsonb_build_object('message', v_text, 'owed', (v_sum ->> 'owed')::integer, 'overdue', (v_sum ->> 'overdue')::integer));
  insert into public.audit_log (actor_id, action, table_name, record_id, new_data, reason)
  values (v_uid, 'dues_warning_sent', 'profiles', p_worker::text, v_sum, v_text);
end;
$$;
revoke all on function public.admin_dues_warn(uuid, text) from public, anon;
grant execute on function public.admin_dues_warn(uuid, text) to authenticated;

-- Where workers pay DHA (shown in My Dues).
create function public.admin_dues_pay_to_save(p_text text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_text text := btrim(coalesce(p_text, ''));
  v_old text;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if char_length(v_text) > 500 then
    raise exception 'keep it to 500 characters';
  end if;
  select s.value #>> '{}' into v_old from public.app_settings s where s.key = 'dues_pay_to';
  insert into public.app_settings (key, value, updated_by) values ('dues_pay_to', to_jsonb(v_text), v_uid)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  values (v_uid, 'dues_pay_to_saved', 'app_settings', 'dues_pay_to',
          jsonb_build_object('value', coalesce(v_old, '')), jsonb_build_object('value', v_text));
end;
$$;
revoke all on function public.admin_dues_pay_to_save(text) from public, anon;
grant execute on function public.admin_dues_pay_to_save(text) to authenticated;

-- 7. Settings > Dues: three more editable rules, and the save accepts any section the registry lists -------------------------
create or replace function private.rule_registry()
returns table (key text, grp text, label text, def numeric, lo numeric, hi numeric, is_int boolean, ord integer)
language sql immutable set search_path = ''
as $$
  select * from (values
    ('job_expiry_hours',         'jobs',    'Open jobs expire after (hours)',                      24::numeric,  6::numeric, 168::numeric, true,  1),
    ('job_expiry_reminder_hours','jobs',    'Reminder to the resident after (hours)',              20::numeric,  1::numeric, 167::numeric, true,  2),
    ('max_job_photos',           'jobs',    'Photos per job (maximum)',                             6::numeric,  1::numeric,  10::numeric, true,  3),
    ('stuck_scheduled_hours',    'jobs',    'Scheduled job counts as stuck after (hours)',         24::numeric,  1::numeric, 168::numeric, true,  4),
    ('stuck_in_progress_hours',  'jobs',    'Job in progress counts as stuck after (hours)',       48::numeric,  1::numeric, 336::numeric, true,  5),
    ('stuck_cash_hours',         'jobs',    'Cash not recorded counts as stuck after (hours)',     48::numeric,  1::numeric, 336::numeric, true,  6),
    ('top_rated_min_jobs',       'workers', 'Completed jobs needed for Top rated',                 10::numeric,  1::numeric, 500::numeric, true,  1),
    ('top_rated_min_rating',     'workers', 'Average rating needed for Top rated',                4.5::numeric,  1::numeric,   5::numeric, false, 2),
    ('dha_fee_percent',          'dues',    'DHA fee (% of the worker''s labour price)',           20::numeric,  0::numeric,  60::numeric, false, 1),
    ('dha_fee_min',              'dues',    'Smallest DHA fee per job (Rs)',                       50::numeric,  0::numeric, 5000::numeric, true,  2),
    ('dues_due_days',            'dues',    'Days a worker has to pay a due',                       5::numeric,  1::numeric,  30::numeric, true,  3)
  ) as t(key, grp, label, def, lo, hi, is_int, ord);
$$;

create or replace function public.admin_rules_save(p_group text, p_values jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_new numeric;
  v_cur numeric;
  v_old_json jsonb := '{}'::jsonb;
  v_new_json jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if p_group is null or not exists (select 1 from private.rule_registry() g where g.grp = p_group) then
    raise exception 'unknown settings section';
  end if;
  if jsonb_typeof(p_values) is distinct from 'object' then
    raise exception 'send the settings as one set of values';
  end if;
  if exists (select 1 from jsonb_object_keys(p_values) k
              where k not in (select key from private.rule_registry() where grp = p_group)) then
    raise exception 'unknown setting';
  end if;
  if (select count(*) from jsonb_object_keys(p_values)) <> (select count(*) from private.rule_registry() where grp = p_group) then
    raise exception 'send every setting of this section';
  end if;

  for r in select * from private.rule_registry() where grp = p_group order by ord loop
    if jsonb_typeof(p_values -> r.key) is distinct from 'number' then
      raise exception '% must be a number', r.label;
    end if;
    v_new := (p_values ->> r.key)::numeric;
    if v_new < r.lo or v_new > r.hi then
      raise exception '% must be between % and %', r.label, trim_scale(r.lo), trim_scale(r.hi);
    end if;
    if r.is_int and v_new <> trunc(v_new) then
      raise exception '% must be a whole number', r.label;
    end if;
    if not r.is_int and v_new <> round(v_new, 1) then
      raise exception '% can have one decimal at most', r.label;
    end if;
  end loop;
  if p_group = 'jobs' and (p_values ->> 'job_expiry_reminder_hours')::numeric >= (p_values ->> 'job_expiry_hours')::numeric then
    raise exception 'the reminder must come before the job expires';
  end if;

  for r in select * from private.rule_registry() where grp = p_group order by ord loop
    v_new := (p_values ->> r.key)::numeric;
    select coalesce((s.value #>> '{}')::numeric, r.def) into v_cur from public.app_settings s where s.key = r.key;
    v_cur := coalesce(v_cur, r.def);
    if v_cur <> v_new then
      insert into public.app_settings (key, value, updated_by)
      values (r.key, case when r.is_int then to_jsonb(v_new::integer) else to_jsonb(v_new) end, v_uid)
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
      v_old_json := v_old_json || jsonb_build_object(r.key, v_cur);
      v_new_json := v_new_json || jsonb_build_object(r.key, v_new);
    end if;
  end loop;

  if v_new_json <> '{}'::jsonb then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    values (v_uid, 'rules_saved', 'app_settings', p_group, v_old_json, v_new_json);
  end if;
  return jsonb_build_object('changed', (select count(*) from jsonb_object_keys(v_new_json)));
end;
$$;

-- 8. Dues notices are not "job updates": they always push, whatever the worker switched off --------------------------------
create or replace function private.apply_push_preferences()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_wd public.worker_details;
begin
  if new.push_sent_at is not null then
    return new;
  end if;
  select wd.* into v_wd
  from public.worker_details wd
  join public.profiles p on p.id = wd.profile_id
  where wd.profile_id = new.user_id and p.role = 'worker';
  if not found then
    return new;
  end if;
  if (new.type = 'new_job' and not v_wd.notify_new_jobs)
     or (new.type = 'staff_message' and not v_wd.notify_announcements)
     or (new.type like 'report\_%' and new.type <> 'report_warning' and not v_wd.notify_report_updates)
     or (new.type not in ('new_job', 'staff_message', 'job_reminder', 'verification_decided', 'account_suspended',
                          'account_reactivated', 'report_warning', 'busy_eta_needed', 'busy_eta_expired',
                          'dues_reminder', 'dues_payment_decided', 'dues_warning')
         and new.type not like 'report\_%' and not v_wd.notify_job_updates) then
    new.push_sent_at := now();   -- handled: send-push and the retry cron skip it; the in-app notice stays
  end if;
  return new;
end;
$$;

-- 9. A daily reminder ------------------------------------------------------------------------------------------------------------
-- Active workers whose due is within 24 hours or overdue; once a day (Karachi time), never twice.
create function private.dues_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
  v_today timestamptz := date_trunc('day', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi';
begin
  for r in
    select w.worker_id, w.owed, w.overdue, w.next_due_at
      from private.dues_workers(null) w
      join public.profiles p on p.id = w.worker_id and p.role = 'worker' and p.account_status = 'active'
     where w.owed > 0
       and (w.overdue > 0 or w.next_due_at < now() + interval '24 hours')
       and not exists (select 1 from public.notifications n
                        where n.user_id = w.worker_id and n.type = 'dues_reminder' and n.created_at >= v_today)
  loop
    perform private.notify(r.worker_id, 'dues_reminder', null,
      jsonb_build_object('owed', r.owed, 'overdue', r.overdue, 'due_at', r.next_due_at));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.dues_reminders() from public, anon, authenticated;
select cron.schedule('dw-dues-reminders', '0 5 * * *', 'select private.dues_reminders();');
