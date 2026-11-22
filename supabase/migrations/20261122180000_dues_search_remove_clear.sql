-- 0079 (22 Nov 2026): the owner dropped "Clear all" for My Dues (0077, 0078) in favour of a search box.
-- 1. The clear and restore functions and the "hidden" stamp are removed (cleared cards were only hidden, so nothing is lost: they all show again).
-- 2. My Dues is rebuilt from two helpers that can also filter, and search_my_dues(p_query) searches ALL of the worker's dues and payments
--    (My Dues itself still lists the latest 50 dues and 30 payments).

-- A word-by-word match: every word typed must appear somewhere in the text of the card. Plain text, not a pattern, so % and _ mean themselves.
create function private.dues_match(p_hay text, p_query text)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(btrim(p_query), '') = ''
      or not exists (select 1 from unnest(string_to_array(lower(btrim(p_query)), ' ')) as t (tok) where tok <> '' and position(tok in p_hay) = 0);
$$;
revoke all on function private.dues_match(text, text) from public, anon, authenticated;

-- The dues cards, newest first. Searchable: job code, title, amount, state (paid, waived, due, overdue) and the date.
create function private.due_items(p_worker uuid, p_query text, p_limit integer)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x.item order by x.accrued_at desc, x.due_id), '[]'::jsonb)
    from (select s.accrued_at, s.due_id,
                 jsonb_build_object('id', s.due_id, 'job_id', s.job_id, 'job_code', s.code, 'job_title', s.title,
                   'amount', s.amount, 'paid', s.paid, 'remaining', s.remaining, 'accrued_at', s.accrued_at, 'due_at', s.due_at,
                   'status', s.status) as item
            from (select r.*, j.code, j.title,
                         case when r.waived then 'waived' when r.remaining = 0 then 'paid' when r.due_at < now() then 'overdue' else 'due' end as status
                    from private.dues_rows(p_worker) r
                    join public.jobs j on j.id = r.job_id) s
           where private.dues_match(lower(concat_ws(' ', s.code, s.title, s.amount::text, s.status, to_char(s.accrued_at at time zone 'Asia/Karachi', 'DD Mon YYYY'))), p_query)
           order by s.accrued_at desc, s.due_id
           limit p_limit) x;
$$;
revoke all on function private.due_items(uuid, text, integer) from public, anon, authenticated;

-- The payment cards, newest first. Searchable: transaction ID, way of paying, amount, state and the date.
create function private.payment_items(p_worker uuid, p_query text, p_limit integer)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', dp.id, 'amount', dp.amount, 'method', dp.method, 'reference', dp.reference,
                     'status', dp.status, 'has_proof', dp.proof_path is not null, 'created_at', dp.created_at, 'decided_at', dp.decided_at,
                     'reason', dp.decision_reason, 'by_staff', dp.created_by <> p_worker)
                   order by dp.created_at desc, dp.id), '[]'::jsonb)
    from (select d2.*
            from public.dues_payments d2
           where d2.worker_id = p_worker
             and private.dues_match(lower(concat_ws(' ', d2.reference, d2.method, d2.amount::text, d2.status, to_char(d2.created_at at time zone 'Asia/Karachi', 'DD Mon YYYY'))), p_query)
           order by d2.created_at desc, d2.id
           limit p_limit) dp;
$$;
revoke all on function private.payment_items(uuid, text, integer) from public, anon, authenticated;

-- My Dues: as in 0075, built from the helpers (no filter)
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
    'dues', private.due_items(v_uid, null, v_limit),
    'payments', private.payment_items(v_uid, null, 30));
end;
$$;

-- Search: all of this worker's dues and payments that match (up to 50 of each). Also works for a suspended worker.
create function public.search_my_dues(p_query text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_q text := left(btrim(coalesce(p_query, '')), 40);
begin
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'worker') then
    raise exception 'not available' using errcode = '42501';
  end if;
  return jsonb_build_object('dues', private.due_items(v_uid, v_q, 50), 'payments', private.payment_items(v_uid, v_q, 50));
end;
$$;
revoke all on function public.search_my_dues(text) from public, anon;
grant execute on function public.search_my_dues(text) to authenticated;

-- Clear all is gone
drop function public.clear_my_dues_history(text);
drop function public.restore_my_dues_history(text);
alter table public.worker_dues drop column worker_hidden_at;
alter table public.dues_payments drop column worker_hidden_at;
