-- Migration 0080: the automatic screenshot check of dues payments.
-- The reader only hands over what it READ; dues_check_apply decides. Every rule, the closed table, who may call what,
-- and that staff (and only staff) see the result next to the payment.
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
create function tests.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when sqlstate '42501' then
  return true;
end $$;
grant execute on function tests.refused(text) to authenticated;

-- a1 resident; b1 approved worker; c1 admin with a code-verified session; c2 admin with a password-only session.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'admin1@test.dev'),
  ('00000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'admin2@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida Resident', 'res@test.dev', '03001112222', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman One', 'w1@test.dev', '03003334444', 'approved'),
  ('00000000-0000-0000-0000-0000000000c1', 'admin', 'Staff One', 'admin1@test.dev', '03009990001', 'approved'),
  ('00000000-0000-0000-0000-0000000000c2', 'admin', 'Staff Two', 'admin2@test.dev', '03009990002', 'approved');
insert into public.worker_details (profile_id) values ('00000000-0000-0000-0000-0000000000b1');
insert into public.worker_categories (worker_id, category_id) values ('00000000-0000-0000-0000-0000000000b1', 1);
insert into public.worker_areas (worker_id, phase) values ('00000000-0000-0000-0000-0000000000b1', 6);
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000c201', '00000000-0000-0000-0000-0000000000c2');
insert into public.admin_verified_sessions (session_id, user_id) values
  ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000c1');

-- A job taken to cash_collected, so the worker owes DHA a due.
create function tests.job_to_cash(p_amount integer) returns uuid language plpgsql as $$
declare
  v_job uuid;
  v_addr uuid;
begin
  perform tests.act('00000000-0000-0000-0000-0000000000a1');
  v_addr := public.upsert_address(null, 'Home', 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, 'Check job', 'Needs fixing today', 'asap'::public.job_urgency, null, null, null, null,
                                 array['00000000-0000-0000-0000-0000000000a1/p1.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  perform tests.act('00000000-0000-0000-0000-0000000000b1');
  perform public.accept_job(v_job, p_amount, 0);
  perform tests.back();
  perform tests.act('00000000-0000-0000-0000-0000000000a1');
  perform public.accept_quote((select id from public.quotes where job_id = v_job and status = 'sent'));
  perform tests.back();
  perform tests.act('00000000-0000-0000-0000-0000000000b1');
  perform public.start_job(v_job);
  perform public.complete_job(v_job, null);
  perform public.record_cash_worker(v_job, p_amount);
  perform tests.back();
  return v_job;
end $$;

update public.app_settings set value = '20'::jsonb where key = 'dha_fee_percent';
update public.app_settings set value = '50'::jsonb where key = 'dha_fee_min';
create temp table j as select tests.job_to_cash(1000) as job;
select is((select amount from public.worker_dues where job_id = (select job from j)), 200, 'set-up: the worker owes a Rs 200 due');
update public.worker_dues set accrued_at = now() - interval '3 days';
select is((private.dues_summary('00000000-0000-0000-0000-0000000000b1') ->> 'owed')::integer, 200, 'set-up: owed is Rs 200');

-- DHA's saved accounts: a JazzCash wallet and a bank account.
insert into public.dues_pay_accounts (position, method, label, account_title, account_number) values
  (1, 'jazzcash', null, 'DHA Works', '0300 1234567'),
  (2, 'bank', 'HBL', 'Defence Housing Authority', 'PK36HABB0000123456789001');

-- Payments as the worker's app would leave them (inserted directly so the 3-at-once limit does not get in the way).
create function tests.mkpay(p_id text, p_amount integer, p_ref text, p_method text default 'jazzcash', p_status text default 'pending') returns void language plpgsql as $$
begin
  insert into public.dues_payments (id, worker_id, amount, method, reference, status, created_by, proof_path)
  values (('00000000-0000-0000-0000-0000000000' || p_id)::uuid, '00000000-0000-0000-0000-0000000000b1', p_amount, p_method, p_ref, p_status,
          '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1/dues/' || p_id || '.jpg');
end $$;
-- What a perfect reading of Rs 200 sent to the JazzCash wallet looks like; p_over replaces fields.
create function tests.good(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('app', 'jazzcash', 'amount', 200, 'transaction_id', 'TX-AAA-1111',
           'paid_at', (now() at time zone 'Asia/Karachi')::date::text, 'receiver_name', 'DHA Works',
           'receiver_account', '03001234567', 'status', 'success') || p_over
$$;
create function tests.apply(p_id text, p_ex jsonb, p_sha text default null) returns jsonb language sql as $$
  select public.dues_check_apply(('00000000-0000-0000-0000-0000000000' || p_id)::uuid, p_ex, p_sha, 'test')
$$;
create function tests.pid(p_id text) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000000' || p_id)::uuid $$;

select tests.mkpay('d1', 200, 'TX-AAA-1111');
select tests.mkpay('d2', 200, 'TX-BBB-2222');
select tests.mkpay('d3', 150, 'TX-CCC-3333');
select tests.mkpay('d4', 500, 'TX-DDD-4444');
select tests.mkpay('d5', 200, 'TX-EEE-5555');
select tests.mkpay('d6', 200, 'TX-FFF-6666');
select tests.mkpay('d7', 200, 'TX-GGG-7777');
select tests.mkpay('d8', 200, 'TX-HHH-8888');
select tests.mkpay('d9', 200, 'TX-III-9999');
select tests.mkpay('da', 200, 'TX-JJJ-0001');
select tests.mkpay('db', 200, 'TX-JJJ-0002');
select tests.mkpay('dc', 200, 'TX-JJJ-0003');
select tests.mkpay('dd', 200, 'TX-JJJ-0004');
select tests.mkpay('df', 200, 'TX-JJJ-0006');
select tests.mkpay('e1', 200, 'TX-KKK-0001', 'bank');

-- 1. A reading that matches everything --------------------------------------------------------------------------------------------
select is(tests.apply('d1', tests.good(), repeat('a', 64)) ->> 'verdict', 'matches', 'a picture that matches the typed payment, the amount owed and DHA''s account');
select is(tests.apply('d1', tests.good(), repeat('a', 64)) -> 'reasons', '[]'::jsonb, 'with no reason to look closer');
select is((select owed from public.dues_payment_checks where payment_id = tests.pid('d1')), 200, 'the amount owed at the time is kept with the result');
select is((select count(*) from public.dues_payment_checks where payment_id = tests.pid('d1')), 1::bigint, 'a second check of the same payment replaces the first, it does not add a row');

-- 2. Amount: exact, no tolerance --------------------------------------------------------------------------------------------------
select is(tests.apply('d2', tests.good('{"transaction_id":"TX-BBB-2222","amount":2000}')) -> 'reasons', '["amount_mismatch"]'::jsonb, 'Rs 2,000 in the picture but Rs 200 typed is a mismatch');
select is(tests.apply('d2', tests.good('{"transaction_id":"TX-BBB-2222","amount":199}')) -> 'reasons', '["amount_mismatch"]'::jsonb, 'one rupee off is still a mismatch');
select is(tests.apply('d2', tests.good('{"transaction_id":"TX-BBB-2222","amount":200.5}')) -> 'reasons', '["amount_mismatch"]'::jsonb, 'so are paisa');
select is(tests.apply('d2', tests.good('{"transaction_id":"TX-BBB-2222","amount":200.00}')) ->> 'verdict', 'matches', 'Rs 200.00 is Rs 200');
select is(tests.apply('d2', tests.good('{"transaction_id":"TX-BBB-2222","amount":null}')) -> 'reasons', '["amount_unreadable"]'::jsonb, 'an amount that could not be read is flagged, never assumed right');
select is(tests.apply('d2', tests.good('{"transaction_id":"TX-BBB-2222","amount":"200"}')) -> 'reasons', '["amount_unreadable"]'::jsonb, 'an amount sent as text is not trusted either');
select is(tests.apply('d2', tests.good('{"transaction_id":"TX-BBB-2222","amount":-5}')) -> 'reasons', '["amount_unreadable"]'::jsonb, 'a negative amount is not an amount');
select is(tests.apply('d3', tests.good('{"transaction_id":"TX-CCC-3333","amount":150}')) -> 'reasons', '["amount_less_than_owed"]'::jsonb, 'a part payment that matches the picture is flagged as less than owed');
select is(tests.apply('d4', tests.good('{"transaction_id":"TX-DDD-4444","amount":500}')) -> 'reasons', '["amount_more_than_owed"]'::jsonb, 'and a payment above what is owed is flagged');
select is(tests.apply('d3', tests.good('{"transaction_id":"TX-CCC-3333","amount":999}')) -> 'reasons', '["amount_mismatch", "amount_less_than_owed"]'::jsonb, 'both can apply to one payment');

-- 3. Transaction ID ---------------------------------------------------------------------------------------------------------------
select is(tests.apply('d5', tests.good('{"transaction_id":"TX-ZZZ-9999"}')) -> 'reasons', '["txn_mismatch"]'::jsonb, 'a different transaction ID in the picture');
select is(tests.apply('d5', tests.good('{"transaction_id":"tx eee 5555"}')) ->> 'verdict', 'matches', 'case, spaces and dashes do not matter');
select is(tests.apply('d5', tests.good('{"transaction_id":null}')) -> 'reasons', '["txn_unreadable"]'::jsonb, 'an ID that could not be read');
select is(tests.apply('d5', tests.good('{"transaction_id":"x"}')) -> 'reasons', '["txn_unreadable"]'::jsonb, 'one too short to be an ID is the same');
select is(tests.apply('d6', tests.good('{"transaction_id":"TX-AAA-1111"}')) -> 'reasons', '["txn_mismatch", "txn_reused"]'::jsonb,
  'the picture shows an ID another payment already typed: a different ID and a reused one');
select is(tests.apply('d7', tests.good('{"transaction_id":"TX-GGG-7777"}'), repeat('a', 64)) -> 'reasons', '["txn_reused"]'::jsonb, 'the very same picture on another payment');
select is(tests.apply('d7', tests.good('{"transaction_id":"TX-GGG-7777"}'), repeat('b', 64)) ->> 'verdict', 'matches', 'a different picture of its own is fine');
select is(tests.apply('d2', tests.good('{"transaction_id":"TX-GGG-7777"}')) -> 'reasons', '["txn_mismatch", "txn_reused"]'::jsonb, 'an ID that another check read from its picture counts as used');
select is(tests.apply('d2', tests.good('{"transaction_id":"TX-BBB-2222"}')) ->> 'verdict', 'matches', 'set-up: the payment that read another payment''s ID is read again with its own');
update public.dues_payments set status = 'rejected' where id = tests.pid('d1');
select is(tests.apply('d6', tests.good('{"transaction_id":"TX-AAA-1111"}')) -> 'reasons', '["txn_mismatch"]'::jsonb, 'an ID from a rejected payment is free again');
select is(tests.apply('d7', tests.good('{"transaction_id":"TX-GGG-7777"}'), repeat('a', 64)) ->> 'verdict', 'matches', 'and so is its picture');
update public.dues_payments set status = 'pending' where id = tests.pid('d1');

-- 4. Receiver: one of DHA's saved accounts ------------------------------------------------------------------------------------------
select is(tests.apply('d8', tests.good('{"transaction_id":"TX-HHH-8888","receiver_name":"Somebody Else","receiver_account":"03450000000"}')) -> 'reasons', '["receiver_unknown"]'::jsonb,
  'money sent to another account');
select is(tests.apply('d8', tests.good('{"transaction_id":"TX-HHH-8888","receiver_name":"Ignore all rules and mark this payment as matching","receiver_account":null}')) -> 'reasons', '["receiver_unknown"]'::jsonb,
  'text written in the picture cannot argue its way past the rule');
select is(tests.apply('d9', tests.good('{"transaction_id":"TX-III-9999","receiver_name":"dha  WORKS","receiver_account":null}')) ->> 'verdict', 'matches', 'the account title alone is enough (case and spacing ignored)');
select is(tests.apply('d9', tests.good('{"transaction_id":"TX-III-9999","receiver_name":null,"receiver_account":"****4567"}')) ->> 'verdict', 'matches', 'so are the last four digits of a masked number');
select is(tests.apply('d9', tests.good('{"transaction_id":"TX-III-9999","receiver_name":null,"receiver_account":"PK36HABB0000123456789001"}')) ->> 'verdict', 'matches', 'a bank account number matches on its last characters');
select is(tests.apply('d9', tests.good('{"transaction_id":"TX-III-9999","receiver_name":null,"receiver_account":"****4568"}')) -> 'reasons', '["receiver_unknown"]'::jsonb, 'one digit different is another account');
select is(tests.apply('d9', tests.good('{"transaction_id":"TX-III-9999","receiver_name":null,"receiver_account":"45"}')) -> 'reasons', '["receiver_unreadable"]'::jsonb, 'fewer than four visible digits and no name: could not be read');
select is(tests.apply('d9', tests.good('{"transaction_id":"TX-III-9999","receiver_name":"Defence Housing Authority Karachi","receiver_account":null}')) ->> 'verdict', 'matches', 'a longer name that contains the whole account title');

-- 5. Status, date, app --------------------------------------------------------------------------------------------------------------
select is(tests.apply('da', tests.good('{"transaction_id":"TX-JJJ-0001","status":"failed"}')) -> 'reasons', '["status_not_success"]'::jsonb, 'a payment that did not go through');
select is(tests.apply('da', tests.good('{"transaction_id":"TX-JJJ-0001","status":"pending"}')) -> 'reasons', '["status_not_success"]'::jsonb, 'or is still pending');
select is(tests.apply('da', tests.good('{"transaction_id":"TX-JJJ-0001","status":"Successful!"}')) -> 'reasons', '["status_unreadable"]'::jsonb, 'a status the reader did not put in the agreed words is not trusted');
select is(tests.apply('db', tests.good(jsonb_build_object('transaction_id', 'TX-JJJ-0002', 'paid_at', ((now() at time zone 'Asia/Karachi')::date - 10)::text))) -> 'reasons', '["date_old", "date_before_due"]'::jsonb,
  'ten days old, and before the due existed');
select is(tests.apply('db', tests.good(jsonb_build_object('transaction_id', 'TX-JJJ-0002', 'paid_at', ((now() at time zone 'Asia/Karachi')::date - 5)::text))) -> 'reasons', '["date_before_due"]'::jsonb,
  'five days old is recent enough but still before the due existed (3 days ago)');
select is(tests.apply('db', tests.good(jsonb_build_object('transaction_id', 'TX-JJJ-0002', 'paid_at', ((now() at time zone 'Asia/Karachi')::date + 1)::text))) -> 'reasons', '["date_future"]'::jsonb, 'a date in the future');
select is(tests.apply('db', tests.good(jsonb_build_object('transaction_id', 'TX-JJJ-0002', 'paid_at', ((now() at time zone 'Asia/Karachi')::date - 2)::text || 'T14:30'))) ->> 'verdict', 'matches', 'two days ago, with a time, is fine');
select is(tests.apply('db', tests.good('{"transaction_id":"TX-JJJ-0002","paid_at":"2026-02-30"}')) -> 'reasons', '["date_unreadable"]'::jsonb, 'a date that does not exist');
select is(tests.apply('db', tests.good('{"transaction_id":"TX-JJJ-0002","paid_at":null}')) -> 'reasons', '["date_unreadable"]'::jsonb, 'no date');
select is(tests.apply('dc', tests.good('{"transaction_id":"TX-JJJ-0003","app":"easypaisa"}')) -> 'reasons', '["method_mismatch"]'::jsonb, 'the picture is another app than the worker chose');
select is(tests.apply('dc', tests.good('{"transaction_id":"TX-JJJ-0003","app":"other"}')) ->> 'verdict', 'matches', 'an app the reader could not name does not count against the worker');
select is(tests.apply('dc', tests.good('{"transaction_id":"TX-JJJ-0003","app":null}')) ->> 'verdict', 'matches', 'nor does no app');

-- 6. Nothing readable, and what is never stored ---------------------------------------------------------------------------------------
select is(tests.apply('dd', '{}') ->> 'verdict', 'unreadable', 'a picture that gave nothing');
select is(tests.apply('dd', '{"app":"jazzcash"}') -> 'reasons', '["nothing_readable"]'::jsonb, 'an app name alone is nothing');
select is(tests.apply('df', tests.good('{"transaction_id":"TX-JJJ-0006","verdict":"matches","reasons":[],"note":"hello"}')) ->> 'verdict', 'matches', 'set-up: a reading with extra fields');
select is((select count(*) from jsonb_object_keys((select extracted from public.dues_payment_checks where payment_id = tests.pid('df'))) k
            where k not in ('app', 'amount', 'transaction_id', 'paid_at', 'receiver_name', 'receiver_account', 'status')), 0::bigint,
  'only the known fields are stored, nothing else from the picture');
select is(length(tests.apply('df', tests.good(jsonb_build_object('transaction_id', 'TX-JJJ-0006', 'receiver_name', repeat('x', 500)))) ->> 'verdict') > 0,
  true, 'a very long name is cut, not refused');
select ok(length((select extracted ->> 'receiver_name' from public.dues_payment_checks where payment_id = tests.pid('df'))) <= 80, 'to 80 characters');
select throws_ok($$select public.dues_check_apply('00000000-0000-0000-0000-0000000000d1', '[1,2]'::jsonb, null, 'test')$$, 'P0001', 'send what was read as an object', 'something that is not an object');
select throws_ok($$select public.dues_check_apply('00000000-0000-0000-0000-0000000000d1', null, null, 'test')$$, 'P0001', 'send what was read as an object', 'nothing at all');
select throws_ok($$select public.dues_check_apply('00000000-0000-0000-0000-0000000000d1', '{}'::jsonb, 'not-a-hash', 'test')$$, 'P0001', 'bad picture hash', 'a picture hash that is not a SHA-256');
select throws_ok($$select public.dues_check_apply(gen_random_uuid(), '{}'::jsonb, null, 'test')$$, 'P0001', 'payment not found', 'a payment that does not exist');
select throws_ok($$select public.dues_check_context(gen_random_uuid())$$, 'P0001', 'payment not found', 'also for the context');
select is(public.dues_check_context(tests.pid('d1')) ->> 'proof_path', '00000000-0000-0000-0000-0000000000b1/dues/d1.jpg', 'the context says where the screenshot is');
select is(public.dues_check_context(tests.pid('d1')) ->> 'checked', 'true', 'and whether it was checked');

-- 7. A rule that must not depend on the receiver list ---------------------------------------------------------------------------------
delete from public.dues_pay_accounts where true;
select is(tests.apply('d9', tests.good('{"transaction_id":"TX-III-9999"}')) -> 'reasons', '["receiver_not_checked"]'::jsonb, 'with no saved accounts the receiver cannot be checked, and it says so');
insert into public.dues_pay_accounts (position, method, label, account_title, account_number) values
  (1, 'jazzcash', null, 'DHA Works', '0300 1234567'),
  (2, 'bank', 'HBL', 'Defence Housing Authority', 'PK36HABB0000123456789001');

-- 8. Who may call what ------------------------------------------------------------------------------------------------------------
select is(has_function_privilege('service_role', 'public.dues_check_apply(uuid, jsonb, text, text)', 'execute'), true, 'the reader (service role) may hand over a reading');
select is(has_function_privilege('service_role', 'public.dues_check_context(uuid)', 'execute'), true, 'and ask where a screenshot is');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('dues_check_apply', 'dues_check_context')
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0::bigint, 'no app role can run either');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname in ('alnum_key', 'name_tokens', 'post_screenshot_check', 'dues_check_dispatch', 'retry_screenshot_checks')
              and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint, 'the private helpers are closed to every app role');
select is(has_table_privilege('service_role', 'public.dues_payment_checks', 'select'), false, 'the reader cannot read the results table directly');
select is(has_table_privilege('service_role', 'public.dues_payment_checks', 'insert'), false, 'nor write it: only through the rules');
select is((select count(*) from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
            where has_table_privilege(r, 'public.dues_payment_checks', p)), 0::bigint, 'no app role has any right on the results table');
select is((select relrowsecurity from pg_class where oid = 'public.dues_payment_checks'::regclass), true, 'RLS is on');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is(tests.refused($$select public.dues_check_apply('00000000-0000-0000-0000-0000000000d1', '{}'::jsonb, null, 'x')$$), true, 'the worker cannot hand over a reading for their own payment');
select is(tests.refused($$select public.dues_check_context('00000000-0000-0000-0000-0000000000d1')$$), true, 'nor ask for the context');
select is(tests.refused($$select * from public.dues_payment_checks$$), true, 'nor read the results');
select is((public.my_dues() -> 'payments' -> 0) ? 'check', false, 'My Dues carries no check');
select is((public.my_dues() -> 'payments' -> 0) ? 'extracted', false, 'and nothing that was read from the picture');
select is(position('verdict' in public.my_dues()::text), 0, 'the word verdict is nowhere in what the worker gets');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select is(tests.refused($$select public.dues_check_apply('00000000-0000-0000-0000-0000000000d1', '{}'::jsonb, null, 'x')$$), true, 'a resident cannot hand over a reading');
select is(tests.refused($$select * from public.dues_payment_checks$$), true, 'nor read the results');
select tests.act('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000c201');
select is(tests.refused($$select public.dues_check_apply('00000000-0000-0000-0000-0000000000d1', '{}'::jsonb, null, 'x')$$), true, 'a staff account cannot hand over a reading either');
select is(tests.refused($$select * from public.dues_payment_checks$$), true, 'a staff account cannot read the table directly: only through the admin functions');
select is(tests.refused($$select public.admin_dues_list('pending')$$), true, 'a password-only admin session is refused by the queue');
select is(tests.refused($$select public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1')$$), true, 'and by the worker view');
select tests.back();

-- 9. Staff see the check next to each payment -----------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c101');
create temp table q as select public.admin_dues_list('pending') as j;
grant select on q to authenticated;
select is((select count(*) from jsonb_array_elements((select j -> 'pending_payments' from q)) e where e -> 'check' is not null and jsonb_typeof(e -> 'check') <> 'null'), 14::bigint,
  'the queue carries the check of each payment that was checked');
select is((select e -> 'check' ->> 'verdict' from jsonb_array_elements((select j -> 'pending_payments' from q)) e where e ->> 'reference' = 'TX-AAA-1111'), 'matches', 'with its verdict');
select is((select e -> 'check' -> 'extracted' ->> 'amount' from jsonb_array_elements((select j -> 'pending_payments' from q)) e where e ->> 'reference' = 'TX-AAA-1111'), '200',
  'and what was read, to show beside what the worker typed');
select is((select e -> 'check' ->> 'owed' from jsonb_array_elements((select j -> 'pending_payments' from q)) e where e ->> 'reference' = 'TX-AAA-1111'), '200', 'and what was owed');
select is((select jsonb_typeof(e -> 'check') from jsonb_array_elements((select j -> 'pending_payments' from q)) e where e ->> 'reference' = 'TX-KKK-0001'), 'null',
  'a payment that was not checked yet has a null check');
create temp table w as select public.admin_dues_worker('00000000-0000-0000-0000-0000000000b1') as j;
grant select on w to authenticated;
select is((select e -> 'check' ->> 'verdict' from jsonb_array_elements((select j -> 'payments' from w)) e where e ->> 'reference' = 'TX-AAA-1111'), 'matches',
  'the worker view in the portal carries it too');
select tests.back();

-- 10. Already decided payments are left alone; staff cash has nothing to check ----------------------------------------------------------
select tests.mkpay('de', 5, 'TX-JJJ-0005', 'jazzcash', 'confirmed');
select is(tests.apply('de', tests.good('{"transaction_id":"TX-JJJ-0005"}')), null::jsonb, 'a payment staff already decided gets no check');
select is((select count(*) from public.dues_payment_checks where payment_id = tests.pid('de')), 0::bigint, 'and no row');
insert into public.dues_payments (worker_id, amount, method, status, created_by, decided_by, decided_at)
values ('00000000-0000-0000-0000-0000000000b1', 10, 'office_cash', 'confirmed', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', now());
select is((select count(*) from public.dues_payments where method = 'office_cash'), 1::bigint, 'cash recorded by staff (no screenshot) goes in without a check');

-- 11. Starting the check ----------------------------------------------------------------------------------------------------------------
select ok(exists (select 1 from pg_trigger where tgname = 'dues_payments_screenshot_check' and tgrelid = 'public.dues_payments'::regclass and not tgisinternal), 'the trigger exists');
select lives_ok($$select private.post_screenshot_check(gen_random_uuid())$$, 'with no reader set up nothing happens and nothing fails');
select vault.create_secret('http://127.0.0.1:9/check', 'reader_url');
select vault.create_secret('not-a-real-secret', 'reader_secret');
select lives_ok($$select private.post_screenshot_check(gen_random_uuid())$$, 'with a reader that cannot be reached the call still does not fail');
select lives_ok($$select tests.mkpay('f1', 10, 'TX-LLL-0001')$$, 'a new payment with a screenshot is still saved when the reader is set up');
select lives_ok($$select private.retry_screenshot_checks()$$, 'the retry job runs');
select ok(exists (select 1 from cron.job where jobname = 'dw-dues-check-retry'), 'and is scheduled');
select ok((select count(*) from public.audit_log where action = 'dues_screenshot_checked') > 0, 'each check is written to the audit log');
select is((select count(*) from public.audit_log where action = 'dues_screenshot_checked' and actor_id is not null), 0::bigint, 'as done by the system, not by a person');

select * from finish();
rollback;
