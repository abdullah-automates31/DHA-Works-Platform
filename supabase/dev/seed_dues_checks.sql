-- DEMO ONLY (24 Nov 2026, for the Fri 27 Nov demo): fills the automatic screenshot check (migration 0080) for payments that are
-- waiting on DEV, so the Dues page shows each state before the real reader service exists. It is not a test and not for TEST or
-- production. It reads nothing from a picture: it hands dues_check_apply made-up readings, and the database applies its real rules.
--
-- Run it yourself against DEV when you want it (the owner asks for it in that task), for example:
--   supabase db query --linked -f supabase/dev/seed_dues_checks.sql
-- It touches only payments that are pending and have a screenshot, at most four of them, oldest first:
--   1st  a reading that matches what the worker typed
--   2nd  an amount in the picture that is ten times the typed one (shows the red "Amount does not match")
--   3rd  a different transaction ID in the picture
--   4th  nothing could be read
-- Running it again replaces the same four readings. Payments with a real check from the reader are left alone.
do $$
declare
  r record;
  n integer := 0;
  v_today text := (now() at time zone 'Asia/Karachi')::date::text;
  v_title text;
  v_number text;
  v_ex jsonb;
begin
  select a.account_title, a.account_number into v_title, v_number from public.dues_pay_accounts a order by a.position limit 1;
  for r in
    select d.id, d.amount, d.reference, d.method
      from public.dues_payments d
     where d.status = 'pending' and d.proof_path is not null
       and not exists (select 1 from public.dues_payment_checks c where c.payment_id = d.id and coalesce(c.engine, '') <> 'demo-seed')
     order by d.created_at, d.id
     limit 4
  loop
    n := n + 1;
    v_ex := jsonb_build_object(
      'app', case when r.method in ('jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay') then r.method else 'other' end,
      'amount', r.amount, 'transaction_id', r.reference, 'paid_at', v_today,
      'receiver_name', coalesce(v_title, 'DHA Works'), 'receiver_account', v_number, 'status', 'success');
    if n = 2 then v_ex := v_ex || jsonb_build_object('amount', r.amount * 10); end if;
    if n = 3 then v_ex := v_ex || jsonb_build_object('transaction_id', 'DEMO-OTHER-ID-0001'); end if;
    if n = 4 then v_ex := '{}'::jsonb; end if;
    perform public.dues_check_apply(r.id, v_ex, null, 'demo-seed');
  end loop;
  raise notice 'demo screenshot checks written for % payment(s)', n;
end $$;
