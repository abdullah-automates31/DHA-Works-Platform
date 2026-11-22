-- Migration 0072: the customer must not be able to learn about the DHA fee (owner, 22 Nov 2026).
--
-- 0071 keeps the fee out of everything the customer app shows (the views, the totals, the cash amount, the notices). Two
-- doors were still open to a customer's own login (anyone can call the API with it):
--   1. quotes.dha_fee: authenticated has a table-level SELECT on quotes, and the customer may read the quotes of their own job.
--   2. app_settings: every signed-in user may read it (and get_setting), including dha_fee_percent / dha_fee_min.
-- Both are closed here for everyone except staff and the worker the fee belongs to.

-- 1. quotes: SELECT on every column except dha_fee (the worker reads their own fee through my_job_fee below).
--    A table-level grant cannot be narrowed by a column revoke, so the grant is replaced by a column list.
--    A column added to quotes later needs its own grant (the same rule as every table here: least privilege).
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'quotes' and column_name <> 'dha_fee';
  execute 'revoke select on public.quotes from authenticated';
  execute 'grant select (' || v_cols || ') on public.quotes to authenticated';
end $$;

-- 2. app_settings: the fee and dues settings are for staff and workers only. Everything else stays readable as before.
drop policy app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated
  using (
    key not in ('dha_fee_percent', 'dha_fee_min', 'dues_due_days', 'dues_pay_to')
    or public.is_admin()
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'worker')
  );

create or replace function public.get_setting(p_key text)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select s.value
    from public.app_settings s
   where s.key = p_key
     and (s.key not in ('dha_fee_percent', 'dha_fee_min', 'dues_due_days', 'dues_pay_to')
          or public.is_admin()
          or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'worker'));
$$;

-- 3. The worker's own fee on a job (the cash screen says how much of the cash is DHA's). A worker only; null when they have no quote.
create function public.my_job_fee(p_job_id uuid)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'worker') then
    raise exception 'not available' using errcode = '42501';
  end if;
  return (select q.dha_fee from public.quotes q
           where q.job_id = p_job_id and q.worker_id = v_uid
           order by q.created_at desc limit 1);
end;
$$;
revoke all on function public.my_job_fee(uuid) from public, anon;
grant execute on function public.my_job_fee(uuid) to authenticated;
