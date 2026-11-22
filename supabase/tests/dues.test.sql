-- Migration 0071: DHA fee on every job and My Dues. The fee comes OUT of the worker's quote (the customer sees only the quote).
-- Fee maths, the due created on cash, payments, staff actions, suspended workers, the rules and the closed tables.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act(p_uid uuid, p_session uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', coalesce(p_session, p_uid))::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
grant execute on function tests.act(uuid, uuid), tests.back() to authenticated;

-- a1 resident; b1 and b2 approved workers; c1 admin with a code-verified session; c2 admin with a password-only session.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'admin1@test.dev'),
  ('00000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'admin2@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida Resident', 'res@test.dev', '03001112222', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman One', 'w1@test.dev', '03003334444', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Bilal Two', 'w2@test.dev', '03005556666', 'approved'),
  ('00000000-0000-0000-0000-0000000000c1', 'admin', 'Staff One', 'admin1@test.dev', '03009990001', 'approved'),
  ('00000000-0000-0000-0000-0000000000c2', 'admin', 'Staff Two', 'admin2@test.dev', '03009990002', 'approved');
insert into public.worker_details (profile_id) values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');
insert into public.worker_categories (worker_id, category_id) values
  ('00000000-0000-0000-0000-0000000000b1', 1), ('00000000-0000-0000-0000-0000000000b2', 1);
insert into public.worker_areas (worker_id, phase) values
  ('00000000-0000-0000-0000-0000000000b1', 6), ('00000000-0000-0000-0000-0000000000b2', 6);
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000c201', '00000000-0000-0000-0000-0000000000c2');
insert into public.admin_verified_sessions (session_id, user_id) values
  ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000c1');

-- Helpers: a posted job, a quoted job, an accepted job, a job taken to cash_collected.
create function tests.make_job(p_title text, p_n text) returns uuid language plpgsql as $$
declare
  v_job uuid;
  v_addr uuid;
begin
  perform tests.act('00000000-0000-0000-0000-0000000000a1');
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing today', 'asap'::public.job_urgency, null, null, null, null,
                                 array['00000000-0000-0000-0000-0000000000a1/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;
create function tests.to_quote(p_title text, p_n text, p_worker uuid, p_labour integer, p_materials integer) returns uuid language plpgsql as $$
declare
  v_job uuid := tests.make_job(p_title, p_n);
begin
  perform tests.act(p_worker);
  perform public.accept_job(v_job, p_labour, p_materials);
  perform tests.back();
  return v_job;
end $$;
create function tests.to_accepted(p_title text, p_n text, p_worker uuid, p_labour integer, p_materials integer) returns uuid language plpgsql as $$
declare
  v_job uuid := tests.to_quote(p_title, p_n, p_worker, p_labour, p_materials);
begin
  perform tests.act('00000000-0000-0000-0000-0000000000a1');
  perform public.accept_quote((select id from public.quotes where job_id = v_job and status = 'sent'));
  perform tests.back();
  return v_job;
end $$;
create function tests.to_cash(p_job uuid, p_worker uuid, p_amount integer, p_bill text default null) returns void language plpgsql as $$
begin
  perform tests.act(p_worker);
  perform public.start_job(p_job);
  if p_bill is not null then
    insert into storage.objects (bucket_id, name, owner) values ('job-media', p_bill, p_worker);
  end if;
  perform public.complete_job(p_job, p_bill);
  perform public.record_cash_worker(p_job, p_amount);
  perform tests.back();
end $$;
create function tests.q(p_sql text) returns text language plpgsql security definer as $$
declare
  v text;
begin
  execute p_sql into v;
  return v;
end $$;
grant execute on function tests.q(text) to authenticated;
create function tests.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when sqlstate '42501' then
  return true;
end $$;
grant execute on function tests.refused(text) to authenticated;

-- 1. The fee maths. It ships switched off ---------------------------------------------------------------------------------
select is(private.dha_fee(1000), 0, 'the fee ships switched off: nothing is charged until the owner sets the rule');
select is((select count(*) from public.app_settings where key in ('dha_fee_percent', 'dha_fee_min', 'dues_due_days', 'dues_pay_to')), 4::bigint, 'the four settings exist');
update public.app_settings set value = '20'::jsonb where key = 'dha_fee_percent';
update public.app_settings set value = '50'::jsonb where key = 'dha_fee_min';
select is(private.dha_fee(1000), 200, '20% of Rs 1,000 labour is Rs 200');
select is(private.dha_fee(100), 50, 'the minimum applies: 20% of Rs 100 is 20, so Rs 50');
select is(private.dha_fee(240), 50, 'and just under it: 20% of Rs 240 is 48, so Rs 50');
select is(private.dha_fee(300), 60, 'above the minimum the percentage wins');
select is(private.dha_fee(0), 0, 'no labour price, no fee (materials are never charged)');
select is(private.dha_fee(null), 0, 'a missing labour price is no fee');
select is(private.dha_fee(30), 30, 'the fee is never more than the labour price (the Rs 50 minimum is capped at Rs 30)');
update public.app_settings set value = '12.5'::jsonb where key = 'dha_fee_percent';
select is(private.dha_fee(1000), 125, 'a percentage with one decimal works (12.5% of Rs 1,000)');
update public.app_settings set value = '20'::jsonb where key = 'dha_fee_percent';

-- 2. A revised quote is priced again; the customer sees the quote only ------------------------------------------------------
create temp table t as select tests.to_quote('Fee job zero', '0', '00000000-0000-0000-0000-0000000000b2', 1000, 0) as j0;
grant select on t to authenticated;
select is((select dha_fee from public.quotes where job_id = (select j0 from t)), 200, 'the fee is stored on the quote when the worker quotes');
select is((select total from public.quotes where job_id = (select j0 from t)), 1000, 'quotes.total is still the worker''s own price');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select total from public.resident_quotes where job_id = (select j0 from t)), 1000, 'the customer sees the quote only: the fee is taken out of it, not added');
select is((select lowest_quote from public.resident_jobs where id = (select j0 from t)), 1000, 'and so does the job card');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select public.revise_quote((select id from public.quotes where job_id = (select j0 from t)), 2000, 0, null, null, null, null)$$, 'the worker revises the quote once');
select is((select my_quote_total from public.worker_jobs where id = (select j0 from t)), 2000, 'the worker still sees their own price');
select tests.back();
select is((select dha_fee from public.quotes where job_id = (select j0 from t)), 400, 'a revised quote is priced again (20% of Rs 2,000)');

-- 3. Accepting: the customer hands over the quote, nothing more --------------------------------------------------------------------
create temp table j as select
  tests.to_accepted('Fee job one', '1', '00000000-0000-0000-0000-0000000000b1', 1000, 0) as j1;
grant select on j to authenticated;
select is((select agreed_amount from public.cash_records where job_id = (select j1 from j)), 1000, 'the cash to be paid is the quote');
update public.app_settings set value = '30'::jsonb where key = 'dha_fee_percent';
select is((select dha_fee from public.quotes where job_id = (select j1 from j) and status = 'accepted'), 200, 'changing the rule later does not change an accepted quote');
select lives_ok($$update public.quotes set labour = 5000 where job_id = (select j1 from j) and status = 'accepted'$$, 'an edit of an accepted quote''s labour');
select is((select dha_fee from public.quotes where job_id = (select j1 from j) and status = 'accepted'), 200, 'does not price it again');
update public.quotes set labour = 1000 where job_id = (select j1 from j) and status = 'accepted';
update public.app_settings set value = '20'::jsonb where key = 'dha_fee_percent';

-- 4. Cash: the due is created ----------------------------------------------------------------------------------------------------
select tests.to_cash((select j1 from j), '00000000-0000-0000-0000-0000000000b1', 1000);
select is((select status from public.jobs where id = (select j1 from j)), 'cash_collected'::public.job_status, 'the full quote needs no reason');
select is((select amount from public.worker_dues where job_id = (select j1 from j)), 200, 'one due of the fee is created');
select ok((select due_at between now() + interval '4 days 23 hours' and now() + interval '5 days 1 hour' from public.worker_dues where job_id = (select j1 from j)),
  'it is due in 5 days');
select is((select (payload ->> 'dha_fee')::integer from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'cash_collected'), 200,
  'the worker''s cash notice carries the fee');

create temp table j2 as select
  tests.to_accepted('Fee job two', '2', '00000000-0000-0000-0000-0000000000b1', 100, 0) as j2;
select tests.to_cash((select j2 from j2), '00000000-0000-0000-0000-0000000000b1', 100);
create temp table j3 as select tests.to_accepted('Fee job three', '3', '00000000-0000-0000-0000-0000000000b1', 1500, 0) as j3;
select tests.to_cash((select j3 from j3), '00000000-0000-0000-0000-0000000000b1', 1500);
create temp table j4 as select tests.to_accepted('Materials only', '4', '00000000-0000-0000-0000-0000000000b1', 0, 500) as j4;
select tests.to_cash((select j4 from j4), '00000000-0000-0000-0000-0000000000b1', 500, '00000000-0000-0000-0000-0000000000b1/bill.jpg');
grant select on j2, j3, j4 to authenticated;
select is((select dha_fee from public.quotes where job_id = (select j4 from j4) and status = 'accepted'), 0, 'a materials-only quote has no fee');
select is((select count(*) from public.worker_dues where job_id = (select j4 from j4)), 0::bigint, 'and no due');
select is((select amount from public.worker_dues where job_id = (select j2 from j2)), 50, 'the minimum fee became a Rs 50 due');
select is((select amount from public.worker_dues where job_id = (select j3 from j3)), 300, 'Rs 1,500 labour gives a Rs 300 due');
-- one transaction gives every due the same time; give them an order (oldest first)
update public.worker_dues set accrued_at = now() - interval '3 days' where job_id = (select j1 from j);
update public.worker_dues set accrued_at = now() - interval '2 days' where job_id = (select j2 from j2);
update public.worker_dues set accrued_at = now() - interval '1 day' where job_id = (select j3 from j3);

-- 5. Earnings are the worker's own money ------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((public.get_my_earnings() ->> 'cash_total')::integer, 2550, 'earnings leave out the DHA fees (800 + 50 + 1,200 + 500 kept of 3,100 collected)');
select is((public.get_my_earnings() ->> 'jobs_count')::integer, 4, 'all four jobs count');

select tests.back();
create temp table c3 as select code from public.jobs where id = (select j3 from j3);
create temp table dids as select id, job_id, amount from public.worker_dues;
grant select on c3, dids to authenticated;
select tests.act('00000000-0000-0000-0000-0000000000b1');
-- 6. My Dues (worker) ----------------------------------------------------------------------------------------------------------------
create temp table d1 as select public.my_dues() as j;
grant select on d1 to authenticated;
select is((select j -> 'summary' ->> 'owed' from d1), '550', 'the worker owes 200 + 50 + 300');
select is((select j -> 'summary' ->> 'overdue' from d1), '0', 'nothing is overdue yet');
select is((select jsonb_array_length(j -> 'dues') from d1), 3, 'three dues are listed');
select is((select j -> 'dues' -> 0 ->> 'job_code' from d1), (select code from c3), 'newest first');
select is((select j -> 'dues' -> 0 ->> 'status' from d1), 'due', 'each due shows its state');
select is((select j -> 'account' ->> 'status' from d1), 'active', 'the account state comes with it');
select is((select j ->> 'helpline' from d1), null::text, 'no helpline number while the helpline is off');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((public.my_dues() -> 'summary' ->> 'owed'), '0', 'another worker sees only their own dues');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.my_dues()$$, '42501', 'not available', 'a resident cannot read My Dues');
select throws_ok($$select public.submit_dues_payment(10, 'jazzcash', 'TX-R')$$, '42501', 'not available', 'nor send a payment');
select tests.back();

-- 7. Sending a payment ----------------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.submit_dues_payment(100, 'cheque', 'TX-1')$$, 'P0001', 'choose how you paid: JazzCash, Easypaisa or bank', 'a bad method');
select throws_ok($$select public.submit_dues_payment(0, 'jazzcash', 'TX-1')$$, 'P0001', 'enter the amount you paid', 'a zero amount');
select throws_ok($$select public.submit_dues_payment(100, 'jazzcash', null)$$, 'P0001', 'enter the transaction ID from your payment (3 to 60 characters)', 'no transaction ID');
select throws_ok($$select public.submit_dues_payment(100, 'jazzcash', 'ab')$$, 'P0001', 'enter the transaction ID from your payment (3 to 60 characters)', 'a transaction ID that is too short');
select throws_ok($$select public.submit_dues_payment(551, 'jazzcash', 'TX-1001')$$, 'P0001', 'the amount is more than you owe', 'more than owed');
select lives_ok($$select public.submit_dues_payment(250, 'jazzcash', 'TX-1001')$$, 'a payment of Rs 250 is sent');
select throws_ok($$select public.submit_dues_payment(10, 'jazzcash', 'tx-1001')$$, 'P0001', 'this transaction ID was already sent', 'the same transaction ID (any case) cannot be used twice');
select lives_ok($$select public.submit_dues_payment(10, 'easypaisa', 'TX-1002')$$, 'a second payment');
select lives_ok($$select public.submit_dues_payment(10, 'bank', 'TX-1003')$$, 'a third payment');
select throws_ok($$select public.submit_dues_payment(10, 'bank', 'TX-1004')$$, 'P0001',
  'DHA is still checking your earlier payments; please wait for them to be confirmed', 'not more than three payments waiting at once');
select is((public.my_dues() -> 'summary' ->> 'owed'), '550', 'a payment waiting for DHA does not lower what is owed yet');
select is((public.my_dues() -> 'summary' ->> 'pending_total'), '270', 'it is shown as waiting');
select is(tests.q('select count(*) from public.audit_log where action = ''dues_payment_submitted'''), '3', 'each payment sent is audited');
select tests.back();

-- 8. Wrong callers for the staff functions ------------------------------------------------------------------------------------------
create temp table calls (sql text);
insert into calls values
  ('select public.admin_dues_counts()'),
  ('select public.admin_dues_list(''all'', null, 25, 0)'),
  ('select public.admin_dues_worker(''00000000-0000-0000-0000-0000000000b1'')'),
  ('select public.admin_dues_payment_decide(gen_random_uuid(), true, null, null)'),
  ('select public.admin_dues_record_payment(''00000000-0000-0000-0000-0000000000b1'', 100, ''office_cash'', null, null)'),
  ('select public.admin_dues_waive(gen_random_uuid(), ''a reason'')'),
  ('select public.admin_dues_warn(''00000000-0000-0000-0000-0000000000b1'', ''please pay'')'),
  ('select public.admin_dues_pay_to_save(''x'')');
grant select on calls to authenticated;
select is((select count(*) from calls), 8::bigint, 'the list covers all 8 staff functions');
select tests.act('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000c201');
select is((select count(*) from calls c where not tests.refused(c.sql)), 0::bigint, 'a password-only admin session is refused by every one');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from calls c where not tests.refused(c.sql)), 0::bigint, 'a resident is refused by every one');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from calls c where not tests.refused(c.sql)), 0::bigint, 'a worker is refused by every one');
select tests.back();
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'admin\_dues\_%' or p.proname in ('my_dues', 'submit_dues_payment'))
              and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'anon can run none of the new functions');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname in ('dues_rows', 'dues_workers', 'dues_summary', 'dues_reminders', 'dha_fee', 'set_quote_dha_fee')
              and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint,
  'the private helpers are closed to every app role');
select is(has_table_privilege('authenticated', 'public.worker_dues', 'select'), false, 'worker_dues has no grant');
select is(has_table_privilege('authenticated', 'public.dues_payments', 'select'), false, 'dues_payments has no grant');
select is((select relrowsecurity from pg_class where oid = 'public.worker_dues'::regclass), true, 'worker_dues has RLS on');
select is((select relrowsecurity from pg_class where oid = 'public.dues_payments'::regclass), true, 'dues_payments has RLS on');

create temp table p1 as select id, reference from public.dues_payments where worker_id = '00000000-0000-0000-0000-0000000000b1';
grant select on p1 to authenticated;
-- 9. Staff work the queue --------------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c101');
select is((public.admin_dues_counts() ->> 'pending'), '3', 'three payments wait for staff');
select is((public.admin_dues_counts() ->> 'overdue_workers'), '0', 'no worker is overdue');
create temp table l1 as select public.admin_dues_list('pending') as j;
grant select on l1 to authenticated;
select is((select j ->> 'total' from l1), '1', 'the pending tab lists the one worker with payments waiting');
select is((select j -> 'rows' -> 0 ->> 'name' from l1), 'Usman One', 'by name');
select is((select j -> 'rows' -> 0 ->> 'owed' from l1), '550', 'with what they owe');
select is((select jsonb_array_length(j -> 'pending_payments') from l1), 3, 'and the queue of payments to check');
select is((select j -> 'totals' ->> 'owed' from l1), '550', 'the totals add up what is owed');
select is((public.admin_dues_list('owing') ->> 'total'), '1', 'one worker owes');
select is((public.admin_dues_list('overdue') ->> 'total'), '0', 'none overdue');
select is((public.admin_dues_list('all', 'usman') ->> 'total'), '1', 'search by name');
select is((public.admin_dues_list('all', 'nobody') ->> 'total'), '0', 'and nothing for another name');
select is((public.admin_dues_list('all', '%') ->> 'total'), '0', 'a % in the search is plain text');
select throws_ok($$select public.admin_dues_list('weird')$$, 'P0001', 'unknown list', 'an unknown tab');

select throws_ok($$select public.admin_dues_payment_decide((select id from p1 where reference = 'TX-1001'), false, null, null)$$,
  'P0001', 'give the worker a reason (3 to 300 characters)', 'a rejection needs a reason');
select lives_ok($$select public.admin_dues_payment_decide((select id from p1 where reference = 'TX-1001'), false, null, 'Transaction not found')$$, 'staff reject a payment');
select throws_ok($$select public.admin_dues_payment_decide((select id from p1 where reference = 'TX-1001'), true, null, null)$$,
  'P0001', 'this payment was already decided, or does not exist', 'a decided payment cannot be decided again');
select is(tests.q('select status from public.dues_payments where reference = ''TX-1001'''), 'rejected', 'it is rejected');
select is(tests.q('select count(*) from public.notifications where user_id = ''00000000-0000-0000-0000-0000000000b1'' and type = ''dues_payment_decided'''), '1', 'the worker is told');
select lives_ok($$select public.admin_dues_payment_decide((select id from p1 where reference = 'TX-1002'), true, null, null)$$, 'staff confirm Rs 10');
select lives_ok($$select public.admin_dues_payment_decide((select id from p1 where reference = 'TX-1003'), true, 40, null)$$, 'staff confirm with the amount that really arrived (Rs 40)');
select is(tests.q('select amount from public.dues_payments where reference = ''TX-1003'''), '40', 'the corrected amount is kept');
select is((public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') -> 'summary' ->> 'owed'), '500', 'Rs 50 confirmed: Rs 500 is left');
select is((public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') -> 'dues' -> 2 ->> 'paid'), '50', 'it went to the oldest due first');
select is((public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') -> 'dues' -> 2 ->> 'remaining'), '150', 'which still has Rs 150 to go');
select is(tests.q('select count(*) from public.audit_log where action in (''dues_payment_confirmed'', ''dues_payment_rejected'')'), '3', 'every decision is audited');

select throws_ok($$select public.admin_dues_record_payment('00000000-0000-0000-0000-0000000000b1', 100, 'cheque', null, null)$$, 'P0001', 'choose how the payment was made', 'a bad method');
select throws_ok($$select public.admin_dues_record_payment('00000000-0000-0000-0000-0000000000b1', 100, 'bank', null, null)$$, 'P0001', 'enter the transaction ID (3 to 60 characters)', 'a transfer needs its ID');
select lives_ok($$select public.admin_dues_record_payment('00000000-0000-0000-0000-0000000000b1', 150, 'office_cash', null, 'paid at the office')$$, 'staff record Rs 150 paid in cash at the office');
select is((public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') -> 'dues' -> 2 ->> 'status'), 'paid', 'the oldest due is now paid');
select is((public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') -> 'summary' ->> 'owed'), '350', 'Rs 350 is left');
select throws_ok($$select public.admin_dues_waive((select id from dids where amount = 200), 'kind gesture')$$,
  'P0001', 'this due is already paid', 'a paid due cannot be waived');
select throws_ok($$select public.admin_dues_waive((select id from dids where amount = 300), 'ab')$$,
  'P0001', 'give a reason (3 to 300 characters)', 'a waiver needs a reason');
select lives_ok($$select public.admin_dues_waive((select id from dids where amount = 50), 'worker had a problem with the customer')$$, 'staff waive the Rs 50 due');
select throws_ok($$select public.admin_dues_waive((select id from dids where amount = 50), 'again please')$$, 'P0001', 'this due was already waived', 'only once');
select is((public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') -> 'summary' ->> 'owed'), '300', 'Rs 300 is left after the waiver');
select is(tests.q('select count(*) from public.audit_log where action in (''dues_payment_recorded'', ''dues_waived'')'), '2', 'the office payment and the waiver are audited');

-- the 250 the worker sent again is confirmed: only what is owed counts, so a payment above it stays as credit
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.submit_dues_payment(250, 'jazzcash', 'TX-1001')$$, 'the rejected transaction ID can be sent again');
select tests.act('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c101');
select lives_ok($$select public.admin_dues_payment_decide(tests.q('select id from public.dues_payments where reference = ''TX-1001'' and status = ''pending''')::uuid, true, null, null)$$, 'and confirmed');
select is((public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') -> 'summary' ->> 'owed'), '50', 'Rs 50 is left');

-- overdue
select tests.back();
update public.worker_dues set due_at = now() - interval '1 day' where job_id = (select j3 from j3);
select tests.act('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c101');
select is((public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') -> 'summary' ->> 'overdue'), '50', 'the part of that due that is unpaid is overdue');
select is((public.admin_dues_counts() ->> 'overdue_workers'), '1', 'one worker is overdue');
select is((public.admin_dues_list('overdue') ->> 'total'), '1', 'the overdue tab lists them');
select is((public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') -> 'dues' -> 0 ->> 'status'), 'overdue', 'and the due says overdue');
select lives_ok($$select public.admin_dues_record_payment('00000000-0000-0000-0000-0000000000b1', 100, 'easypaisa', 'EP-77', null)$$, 'staff record an Easypaisa transfer of Rs 100');
select is((public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') -> 'summary' ->> 'owed'), '0', 'everything is paid');
select is((public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') -> 'summary' ->> 'credit'), '50', 'the extra Rs 50 stays as credit');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.submit_dues_payment(10, 'jazzcash', 'TX-ZERO')$$, 'P0001', 'you do not owe DHA anything right now', 'nothing to pay when nothing is owed');
select tests.back();

-- 10. Another due, reminders, warning ---------------------------------------------------------------------------------------------------
create temp table j5 as select tests.to_accepted('Fee job five', '5', '00000000-0000-0000-0000-0000000000b1', 1000, 0) as j5;
select tests.to_cash((select j5 from j5), '00000000-0000-0000-0000-0000000000b1', 1000);
update public.worker_dues set accrued_at = now(), due_at = now() + interval '12 hours' where job_id = (select j5 from j5);
select is((private.dues_summary('00000000-0000-0000-0000-0000000000b1') ->> 'owed'), '150', 'a new Rs 200 due, minus the Rs 50 credit');
select is(private.dues_reminders(), 1, 'a reminder goes to the worker whose due is within a day');
select is(private.dues_reminders(), 0, 'and only once a day');
select is((select count(*) from public.notifications where type = 'dues_reminder'), 1::bigint, 'one reminder notice');
update public.worker_details set notify_job_updates = false where profile_id = '00000000-0000-0000-0000-0000000000b1';
select private.notify('00000000-0000-0000-0000-0000000000b1', 'dues_warning', null, '{}'::jsonb);
select private.notify('00000000-0000-0000-0000-0000000000b1', 'quote_accepted', null, '{}'::jsonb);
select is((select push_sent_at is null from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'dues_warning' and payload = '{}'::jsonb), true,
  'a dues notice is still pushed when job updates are switched off');
select is((select push_sent_at is null from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'quote_accepted' and payload = '{}'::jsonb), false,
  'while an ordinary job update is not');
update public.worker_details set notify_job_updates = true where profile_id = '00000000-0000-0000-0000-0000000000b1';

select tests.act('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c101');
select throws_ok($$select public.admin_dues_warn('00000000-0000-0000-0000-0000000000b1', 'x')$$, 'P0001', 'write the warning (3 to 300 characters)', 'a warning needs a text');
select lives_ok($$select public.admin_dues_warn('00000000-0000-0000-0000-0000000000b1', 'Please pay your DHA dues this week.')$$, 'staff warn a worker');
select is(tests.q('select payload ->> ''owed'' from public.notifications where type = ''dues_warning'' and payload ? ''message'''), '150', 'the warning carries what is owed');
select is(tests.q('select count(*) from public.audit_log where action = ''dues_warning_sent'''), '1', 'and is audited');

-- where to pay, and the helpline
select throws_ok($$select public.admin_dues_pay_to_save(repeat('x', 501))$$, 'P0001', 'keep it to 500 characters', 'the pay-to text is limited');
select lives_ok($$select public.admin_dues_pay_to_save('JazzCash 0300 1234567, account title DHA Works')$$, 'staff save where to pay');
select tests.back();
update public.app_settings set value = 'true'::jsonb where key = 'helpline_enabled';
update public.app_settings set value = '"1092"'::jsonb where key = 'helpline_number';
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((public.my_dues() ->> 'pay_to'), 'JazzCash 0300 1234567, account title DHA Works', 'the worker sees where to pay');
select is((public.my_dues() ->> 'helpline'), '1092', 'and the helpline when it is on');
select tests.back();

-- 11. Suspension: the worker can still read My Dues and pay, nothing else ---------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c101');
select lives_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b1', true, 'Unpaid DHA dues', null)$$, 'staff suspend the worker');
select throws_ok($$select public.admin_dues_warn('00000000-0000-0000-0000-0000000000b1', 'Please pay.')$$, 'P0001',
  'this account is not active; a suspended worker cannot get notices', 'a suspended worker gets no warning notice');
select is((public.admin_dues_list('suspended') ->> 'total'), '1', 'the suspended tab lists them');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((public.my_dues() -> 'account' ->> 'status'), 'suspended', 'a suspended worker still reads My Dues');
select is((public.my_dues() -> 'account' ->> 'reason'), 'Unpaid DHA dues', 'with the reason');
select is((public.my_dues() -> 'summary' ->> 'owed'), '150', 'and what they owe');
select lives_ok($$select public.submit_dues_payment(150, 'jazzcash', 'TX-SUSP')$$, 'a suspended worker can send a payment');
select throws_ok($$select public.get_my_earnings()$$, '42501', 'your account is suspended', 'but nothing else in the app works');
select tests.back();
delete from public.notifications where type = 'dues_reminder';
select is(private.dues_reminders(), 0, 'a suspended worker gets no reminder');

-- 12. Settings > Dues -----------------------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c101');
create temp table g as select public.admin_rules_get() as j;
grant select on g to authenticated;
select is((select jsonb_array_length(j -> 'dues') from g), 3, 'three dues rules');
select is((select string_agg(e ->> 'key' || '=' || (e ->> 'value') || '/' || (e ->> 'default'), ',' order by ord) from g, jsonb_array_elements(j -> 'dues') with ordinality t(e, ord)),
  'dha_fee_percent=20/20,dha_fee_min=50/50,dues_due_days=5/5', 'the rules show the current value and the owner''s default');
select is((select jsonb_array_length(j -> 'jobs') from g), 6, 'the job rules are unchanged');
select throws_ok($$select public.admin_rules_save('dues', '{"dha_fee_percent":61,"dha_fee_min":50,"dues_due_days":5}'::jsonb)$$, 'P0001',
  'DHA fee (% of the worker''s labour price) must be between 0 and 60', 'the percent is capped');
select throws_ok($$select public.admin_rules_save('dues', '{"dha_fee_percent":12.55,"dha_fee_min":50,"dues_due_days":5}'::jsonb)$$, 'P0001',
  'DHA fee (% of the worker''s labour price) can have one decimal at most', 'one decimal at most');
select throws_ok($$select public.admin_rules_save('dues', '{"dha_fee_percent":20,"dha_fee_min":50,"dues_due_days":0}'::jsonb)$$, 'P0001',
  'Days a worker has to pay a due must be between 1 and 30', 'at least one day to pay');
select throws_ok($$select public.admin_rules_save('dues', '{"dha_fee_percent":20,"dha_fee_min":50.5,"dues_due_days":5}'::jsonb)$$, 'P0001',
  'Smallest DHA fee per job (Rs) must be a whole number', 'whole rupees for the minimum');
select is(public.admin_rules_save('dues', '{"dha_fee_percent":12.5,"dha_fee_min":50,"dues_due_days":7}'::jsonb) ->> 'changed', '2', 'two values changed');
select tests.back();
select is(private.dha_fee(1000), 125, 'the new percentage is used at once');
select is(private.setting_int('dues_due_days', 0), 7, 'and the new number of days');
select is((select count(*) from public.audit_log where action = 'rules_saved' and record_id = 'dues'), 1::bigint, 'the change is audited');

-- 13. The customer must not be able to learn about the fee (migration 0072) -----------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select dha_fee from public.quotes$$, '42501', null, 'a customer cannot read the fee column of a quote');
select throws_ok($$select * from public.quotes$$, '42501', null, 'nor read the whole quote row (it includes the fee)');
select ok((select count(*) from (select id, total, labour from public.quotes) x) >= 1, 'the customer still reads the rest of the quotes of their own job');
select is((select count(*) from public.app_settings where key in ('dha_fee_percent', 'dha_fee_min', 'dues_due_days', 'dues_pay_to')), 0::bigint, 'a customer sees none of the fee settings');
select is((select count(*) from public.app_settings where key = 'helpline_number'), 1::bigint, 'the other settings stay readable');
select is(public.get_setting('dha_fee_percent'), null::jsonb, 'get_setting hides the fee rule from a customer');
select isnt(public.get_setting('helpline_number'), null::jsonb, 'and still answers for the others');
select throws_ok($$select public.my_job_fee((select j0 from t))$$, '42501', 'not available', 'a customer cannot ask for the fee of a job');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is(public.my_job_fee((select j0 from t)), 400, 'the worker reads their own fee on the job');
select is((select count(*) from public.app_settings where key in ('dha_fee_percent', 'dha_fee_min', 'dues_due_days', 'dues_pay_to')), 4::bigint, 'a worker reads the fee settings');
select isnt(public.get_setting('dha_fee_percent'), null::jsonb, 'and get_setting answers for a worker');
select ok((select count(*) from (select id, labour, total from public.quotes) x) >= 1, 'a worker reads their own quote columns as before');
select tests.act('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c101');
select is((select count(*) from public.app_settings where key in ('dha_fee_percent', 'dha_fee_min', 'dues_due_days', 'dues_pay_to')), 4::bigint, 'staff read the fee settings');
select tests.back();
select is(has_column_privilege('authenticated', 'public.quotes', 'dha_fee', 'select'), false, 'authenticated has no grant on the fee column');
select is(has_column_privilege('authenticated', 'public.quotes', 'total', 'select'), true, 'but still has the other quote columns');

select * from finish();
rollback;
