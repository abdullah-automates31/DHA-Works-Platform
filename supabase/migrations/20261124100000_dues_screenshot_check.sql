-- Migration 0080 (24 Nov 2026): automatic check of the worker's dues payment screenshot.
--
-- Owner and Shariq Bhai, 23-24 Nov: when a worker sends a dues payment with its screenshot, DHA's own reader service (no third party,
-- see services/screenshot-reader) reads the picture and the DATABASE decides whether it matches what the worker typed. Staff then see a
-- badge and the numbers side by side. The admin still confirms or rejects by hand; nothing here confirms, rejects or unlocks anything.
--
--   dues_payment_checks            closed table (RLS on, no grant): one row per checked payment; staff reach it only through the two
--                                  admin functions below; a worker or resident can never read it
--   dues_check_context(uuid)       service_role only: where the screenshot is (the reader asks for this)
--   dues_check_apply(uuid, ...)    service_role only: the reader hands over what it READ (fixed fields); the rules below decide
--   private.post_screenshot_check  tells the reader a payment needs checking (Vault: reader_url, reader_secret); never raises
--   trigger on dues_payments       fires for a new pending payment that has a screenshot
--   cron dw-dues-check-retry       every 5 minutes: re-asks for payments that still have no check (the reader was down or the call was lost)
--   admin_dues_list / admin_dues_worker   gain "check" on each payment (null = not checked yet)
--
-- The reader gives no verdict. What it reads can only ever be compared, never trusted: anything written inside the picture cannot change a rule.
-- An edited screenshot can still pass and a match does not prove the money arrived: the admin keeps the final decision.
--
-- Reason codes (the portal words them; red = a mismatch to look at first, yellow = could not be confirmed):
--   amount_mismatch (screenshot amount differs from the amount typed), amount_unreadable, amount_less_than_owed, amount_more_than_owed,
--   txn_mismatch (transaction ID in the picture differs from the one typed), txn_unreadable, txn_reused (same ID or same picture on another payment),
--   receiver_unknown (not one of DHA's saved accounts), receiver_unreadable, receiver_not_checked (no accounts saved),
--   status_not_success, status_unreadable, date_old, date_future, date_before_due, date_unreadable, method_mismatch.
-- Verdict: matches (no reason), flagged (any reason), unreadable (nothing could be read at all).

-- 1. Helpers --------------------------------------------------------------------------------------------------------------------
-- Letters and digits only, upper case: "tx-12 34" and "TX1234" are the same transaction ID.
create function private.alnum_key(p_text text)
returns text
language sql immutable set search_path = ''
as $$ select nullif(upper(regexp_replace(coalesce(p_text, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;
revoke all on function private.alnum_key(text) from public, anon, authenticated;

-- Words of a name, lower case: "DHA  Works (Pvt)" -> {dha,works,pvt}; null when there is none (for example only Urdu script).
create function private.name_tokens(p_text text)
returns text[]
language sql immutable set search_path = ''
as $$ select string_to_array(nullif(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g')), ''), ' ') $$;
revoke all on function private.name_tokens(text) from public, anon, authenticated;

-- 2. The results ----------------------------------------------------------------------------------------------------------------
create table public.dues_payment_checks (
  payment_id   uuid primary key references public.dues_payments (id) on delete cascade,
  verdict      text not null check (verdict in ('matches', 'flagged', 'unreadable')),
  reasons      text[] not null default '{}',
  extracted    jsonb not null,
  owed         integer,
  image_sha256 text check (image_sha256 is null or image_sha256 ~ '^[0-9a-f]{64}$'),
  engine       text check (engine is null or char_length(engine) <= 40),
  checked_at   timestamptz not null default now()
);
alter table public.dues_payment_checks enable row level security;
-- Not even the reader may touch the table directly: it can only go through dues_check_apply (security definer).
revoke all on public.dues_payment_checks from public, anon, authenticated, service_role;
create index dues_payment_checks_sha_idx on public.dues_payment_checks (image_sha256) where image_sha256 is not null;

-- 3. The reader asks where the screenshot is ----------------------------------------------------------------------------------------
create function public.dues_check_context(p_payment uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_pay public.dues_payments;
begin
  select * into v_pay from public.dues_payments d where d.id = p_payment;
  if not found then
    raise exception 'payment not found';
  end if;
  return jsonb_build_object(
    'proof_path', v_pay.proof_path,
    'pending', v_pay.status = 'pending',
    'checked', exists (select 1 from public.dues_payment_checks c where c.payment_id = p_payment));
end;
$$;
revoke all on function public.dues_check_context(uuid) from public, anon, authenticated;
grant execute on function public.dues_check_context(uuid) to service_role;

-- 4. The rules. The reader hands over what it READ; this decides. -------------------------------------------------------------------
-- p_extracted (all keys optional, null = could not be read):
--   app (jazzcash|easypaisa|bank|sadapay|nayapay|other), amount (number), transaction_id, paid_at ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM', Pakistan time),
--   receiver_name, receiver_account (only the digits that are visible; at least 4 or null), status (success|failed|pending)
-- Returns the verdict and reasons, or null when there is nothing to review (the payment was already decided).
create function public.dues_check_apply(p_payment uuid, p_extracted jsonb, p_sha text, p_engine text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_pay public.dues_payments;
  v_sha text := lower(nullif(btrim(coalesce(p_sha, '')), ''));
  v_engine text := left(nullif(btrim(coalesce(p_engine, '')), ''), 40);
  v_app text;
  v_status text;
  v_amount numeric;
  v_txn text;
  v_key text;
  v_paid date;
  v_paid_text text;
  v_rname text;
  v_racct text;
  v_rtail text;
  v_rtok text[];
  v_ex jsonb;
  v_owed integer;
  v_created date;
  v_oldest date;
  v_reasons text[] := '{}';
  v_reused boolean := false;
  v_verdict text;
begin
  if p_extracted is null or jsonb_typeof(p_extracted) <> 'object' then
    raise exception 'send what was read as an object';
  end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'bad picture hash';
  end if;
  select * into v_pay from public.dues_payments d where d.id = p_payment;
  if not found then
    raise exception 'payment not found';
  end if;
  if v_pay.status <> 'pending' or v_pay.proof_path is null then
    return null;
  end if;

  -- Keep only the known fields, trimmed and capped, so nothing else from the picture is ever stored.
  v_app := lower(left(btrim(coalesce(p_extracted ->> 'app', '')), 20));
  if v_app not in ('jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'other') then v_app := null; end if;
  v_status := lower(left(btrim(coalesce(p_extracted ->> 'status', '')), 20));
  if v_status not in ('success', 'failed', 'pending') then v_status := null; end if;
  if jsonb_typeof(p_extracted -> 'amount') = 'number' then
    v_amount := (p_extracted ->> 'amount')::numeric;
    if v_amount <= 0 or v_amount > 100000000 then v_amount := null; end if;
  end if;
  v_txn := left(btrim(coalesce(p_extracted ->> 'transaction_id', '')), 60);
  if private.alnum_key(v_txn) is null or char_length(private.alnum_key(v_txn)) < 3 then v_txn := null; end if;
  begin
    v_paid := left(btrim(coalesce(p_extracted ->> 'paid_at', '')), 10)::date;
    if v_paid < date '2020-01-01' then v_paid := null; end if;
  exception when others then
    v_paid := null;
  end;
  v_paid_text := case when v_paid is not null then left(btrim(p_extracted ->> 'paid_at'), 16) end;
  v_rname := nullif(left(btrim(coalesce(p_extracted ->> 'receiver_name', '')), 80), '');
  v_racct := nullif(left(btrim(coalesce(p_extracted ->> 'receiver_account', '')), 40), '');
  v_rtail := case when char_length(coalesce(private.alnum_key(v_racct), '')) >= 4 then right(private.alnum_key(v_racct), 4) end;
  v_rtok := private.name_tokens(v_rname);
  v_ex := jsonb_build_object('app', v_app, 'amount', v_amount, 'transaction_id', v_txn, 'paid_at', v_paid_text,
                             'receiver_name', v_rname, 'receiver_account', v_racct, 'status', v_status);

  v_owed := coalesce((private.dues_summary(v_pay.worker_id) ->> 'owed')::integer, 0);

  if v_amount is null and v_txn is null and v_rname is null and v_racct is null then
    v_verdict := 'unreadable';
    v_reasons := array['nothing_readable'];
  else
    -- Amount: exact, no tolerance. Paid (screenshot) against submitted (typed), then submitted against what is owed.
    if v_amount is null then
      v_reasons := array_append(v_reasons, 'amount_unreadable'::text);
    elsif v_amount <> v_pay.amount then
      v_reasons := array_append(v_reasons, 'amount_mismatch'::text);
    end if;
    if v_pay.amount < v_owed then
      v_reasons := array_append(v_reasons, 'amount_less_than_owed'::text);
    elsif v_pay.amount > v_owed then
      v_reasons := array_append(v_reasons, 'amount_more_than_owed'::text);
    end if;

    -- Transaction ID: the one in the picture against the one typed, and not used on another payment.
    if v_txn is null then
      v_reasons := array_append(v_reasons, 'txn_unreadable'::text);
    else
      if private.alnum_key(v_txn) is distinct from private.alnum_key(v_pay.reference) then
        v_reasons := array_append(v_reasons, 'txn_mismatch'::text);
      end if;
      v_key := private.alnum_key(v_txn);
      v_reused := exists (select 1 from public.dues_payments d
                           where d.id <> p_payment and d.status <> 'rejected' and private.alnum_key(d.reference) = v_key)
               or exists (select 1 from public.dues_payment_checks c join public.dues_payments d on d.id = c.payment_id
                           where c.payment_id <> p_payment and d.status <> 'rejected' and private.alnum_key(c.extracted ->> 'transaction_id') = v_key);
    end if;
    if not v_reused and v_sha is not null then
      v_reused := exists (select 1 from public.dues_payment_checks c join public.dues_payments d on d.id = c.payment_id
                           where c.payment_id <> p_payment and d.status <> 'rejected' and c.image_sha256 = v_sha);
    end if;
    if v_reused then
      v_reasons := array_append(v_reasons, 'txn_reused'::text);
    end if;

    -- Receiver: one of DHA's saved accounts, by the last 4 characters of the number or by the account title.
    if not exists (select 1 from public.dues_pay_accounts) then
      v_reasons := array_append(v_reasons, 'receiver_not_checked'::text);
    elsif v_rtail is null and v_rtok is null then
      v_reasons := array_append(v_reasons, 'receiver_unreadable'::text);
    elsif not exists (
      select 1 from public.dues_pay_accounts a
       where (v_rtail is not null and right(coalesce(private.alnum_key(a.account_number), ''), 4) = v_rtail)
          or (v_rtok is not null and private.name_tokens(a.account_title) is not null
              and (private.name_tokens(a.account_title) <@ v_rtok
                   or (cardinality(v_rtok) >= 2 and v_rtok <@ private.name_tokens(a.account_title))))) then
      v_reasons := array_append(v_reasons, 'receiver_unknown'::text);
    end if;

    -- Status: the payment must show as successful.
    if v_status is null then
      v_reasons := array_append(v_reasons, 'status_unreadable'::text);
    elsif v_status <> 'success' then
      v_reasons := array_append(v_reasons, 'status_not_success'::text);
    end if;

    -- Date (calendar days, Pakistan time): not more than 7 days before it was sent, not after it was sent, not before the oldest open due existed.
    if v_paid is null then
      v_reasons := array_append(v_reasons, 'date_unreadable'::text);
    else
      v_created := (v_pay.created_at at time zone 'Asia/Karachi')::date;
      if v_paid < v_created - 7 then
        v_reasons := array_append(v_reasons, 'date_old'::text);
      elsif v_paid > v_created then
        v_reasons := array_append(v_reasons, 'date_future'::text);
      end if;
      select (min(r.accrued_at) at time zone 'Asia/Karachi')::date into v_oldest
        from private.dues_rows(v_pay.worker_id) r where r.remaining > 0 and not r.waived;
      if v_oldest is not null and v_paid < v_oldest then
        v_reasons := array_append(v_reasons, 'date_before_due'::text);
      end if;
    end if;

    -- The app in the picture against the way the worker said they paid ("other" accepts anything).
    if v_app is not null and v_app <> 'other' and v_pay.method <> 'other' and v_app <> v_pay.method then
      v_reasons := array_append(v_reasons, 'method_mismatch'::text);
    end if;

    v_verdict := case when cardinality(v_reasons) = 0 then 'matches' else 'flagged' end;
  end if;

  insert into public.dues_payment_checks (payment_id, verdict, reasons, extracted, owed, image_sha256, engine, checked_at)
  values (p_payment, v_verdict, v_reasons, v_ex, v_owed, v_sha, v_engine, now())
  on conflict (payment_id) do update
    set verdict = excluded.verdict, reasons = excluded.reasons, extracted = excluded.extracted, owed = excluded.owed,
        image_sha256 = excluded.image_sha256, engine = excluded.engine, checked_at = excluded.checked_at;

  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (null, 'dues_screenshot_checked', 'dues_payments', p_payment::text,
          jsonb_build_object('verdict', v_verdict, 'reasons', to_jsonb(v_reasons), 'engine', v_engine));

  return jsonb_build_object('verdict', v_verdict, 'reasons', to_jsonb(v_reasons));
end;
$$;
revoke all on function public.dues_check_apply(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.dues_check_apply(uuid, jsonb, text, text) to service_role;

-- 5. Starting the check -----------------------------------------------------------------------------------------------------------
-- Configuration lives in Vault, as for push: reader_url (https://<our server>/check) and reader_secret (also the server's READER_WEBHOOK_SECRET).
-- Without them nothing is sent and the payment simply waits in the normal manual queue ("not checked yet").
create function private.post_screenshot_check(p_payment uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'reader_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'reader_secret';
  if v_url is null or v_secret is null then
    return;   -- the reader is not set up on this project
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('payment_id', p_payment),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reader-secret', v_secret),
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'screenshot check dispatch failed: %', sqlerrm;   -- never undo the worker's payment
end;
$$;
revoke all on function private.post_screenshot_check(uuid) from public, anon, authenticated;

create function private.dues_check_dispatch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.post_screenshot_check(new.id);
  return null;
end;
$$;
revoke all on function private.dues_check_dispatch() from public, anon, authenticated;

create trigger dues_payments_screenshot_check
  after insert on public.dues_payments
  for each row when (new.status = 'pending' and new.proof_path is not null)
  execute function private.dues_check_dispatch();

create function private.retry_screenshot_checks()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select d.id from public.dues_payments d
     where d.status = 'pending' and d.proof_path is not null
       and d.created_at between now() - interval '1 hour' and now() - interval '2 minutes'
       and not exists (select 1 from public.dues_payment_checks c where c.payment_id = d.id)
     order by d.created_at
     limit 20
  loop
    perform private.post_screenshot_check(r.id);
  end loop;
end;
$$;
revoke all on function private.retry_screenshot_checks() from public, anon, authenticated;
select cron.schedule('dw-dues-check-retry', '*/5 * * * *', 'select private.retry_screenshot_checks();');

-- 6. Staff see the check next to each payment (the worker never does: my_dues and search_my_dues are untouched) ----------------------------
-- Both functions are the 0073 definitions with one extra key, 'check'.
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
                         'method', dp.method, 'reference', dp.reference, 'proof_path', dp.proof_path, 'created_at', dp.created_at,
                         'check', (select jsonb_build_object('verdict', c.verdict, 'reasons', to_jsonb(c.reasons), 'extracted', c.extracted,
                                                             'owed', c.owed, 'engine', c.engine, 'checked_at', c.checked_at)
                                     from public.dues_payment_checks c where c.payment_id = dp.id))
                       order by dp.created_at, dp.id)
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
                         'by_staff', dp.created_by <> p_worker, 'created_by_name', cb.full_name, 'decided_by_name', db.full_name,
                         'check', (select jsonb_build_object('verdict', c.verdict, 'reasons', to_jsonb(c.reasons), 'extracted', c.extracted,
                                                             'owed', c.owed, 'engine', c.engine, 'checked_at', c.checked_at)
                                     from public.dues_payment_checks c where c.payment_id = dp.id))
                       order by dp.created_at desc, dp.id)
        from (select * from public.dues_payments d2 where d2.worker_id = p_worker order by d2.created_at desc, d2.id limit 100) dp
        left join public.profiles cb on cb.id = dp.created_by
        left join public.profiles db on db.id = dp.decided_by), '[]'::jsonb));
end;
$$;
