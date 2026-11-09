-- W13 Record cash / W18 Request cancellation: what the worker can do and read. Fixture jobs start with 'W13 '.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
grant execute on function tests.act(uuid), tests.back() to authenticated;

insert into auth.users (id, aud, role, email)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'c' || n || '@test.dev'
from unnest(array['a1', 'b1', 'b2']) n;
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Hira Farooq', 'c1@test.dev', '+923215550148', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Winner Worker', 'c2@test.dev', '+923001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Other Worker', 'c3@test.dev', '+923001110002', 'approved');
insert into public.worker_details (profile_id) select id from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.worker_categories (worker_id, category_id) select id, 1 from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.worker_areas (worker_id, phase) select id, 6 from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.addresses (id, resident_id, label, phase, lane, plot_no, floor, is_default)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Home', 6, 'Lane 7', '118-C', 'Ground', true);
insert into public.jobs (id, resident_id, category_id, address_id, phase, lane, title, description, urgency, status, posted_at) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'W13 cash', 'x', 'asap', 'open', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'W13 cancel', 'x', 'asap', 'open', now() - interval '1 hour');
insert into public.job_private (job_id, plot_no, floor, resident_phone) select id, '118-C', 'Ground', '+923215550148' from public.jobs where title like 'W13 %';

-- both jobs are won by w1 through the real RPCs
select tests.act('00000000-0000-0000-0000-0000000000b1');
select public.express_interest('00000000-0000-0000-0000-00000000c001');
select public.submit_quote('00000000-0000-0000-0000-00000000c001', 3200, now() + interval '2 hours', now() + interval '4 hours');
select public.express_interest('00000000-0000-0000-0000-00000000c002');
select public.submit_quote('00000000-0000-0000-0000-00000000c002', 1000, now() + interval '2 hours', now() + interval '4 hours');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select public.accept_quote((select id from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1' and job_id = '00000000-0000-0000-0000-00000000c001'));
select public.accept_quote((select id from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1' and job_id = '00000000-0000-0000-0000-00000000c002'));

-- ---------------------------------------------------------------- record cash
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.record_cash_worker('00000000-0000-0000-0000-00000000c001', 3200)$$, null, 'record the cash after you mark the job completed', 'cash cannot be recorded before the job is completed');
select lives_ok($$select public.start_job('00000000-0000-0000-0000-00000000c001')$$, 'w1 starts the job');
select lives_ok($$select public.complete_job('00000000-0000-0000-0000-00000000c001')$$, 'and completes it (no materials, no bill)');
select throws_ok($$select public.record_cash_worker('00000000-0000-0000-0000-00000000c001', -5)$$, null, 'enter the amount you received', 'a negative amount is refused');
select throws_ok($$select public.record_cash_worker('00000000-0000-0000-0000-00000000c001', 3000)$$, null, 'explain why the amount differs from the quote', 'a different amount needs a reason');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select public.record_cash_worker('00000000-0000-0000-0000-00000000c001', 3200)$$, null, null, 'another worker cannot record cash on this job');
select is((select count(*) from public.cash_records where job_id = '00000000-0000-0000-0000-00000000c001'), 0::bigint, 'and cannot read its cash row');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.record_cash_worker('00000000-0000-0000-0000-00000000c001', 3000, 'I gave a discount')$$, 'w1 records Rs 3,000 with a reason');
select is((select worker_amount from public.cash_records where job_id = '00000000-0000-0000-0000-00000000c001'), 3000, 'the amount is stored');
select is((select worker_reason from public.cash_records where job_id = '00000000-0000-0000-0000-00000000c001'), 'I gave a discount', 'with the reason');
select is((select status::text from public.worker_jobs where id = '00000000-0000-0000-0000-00000000c001'), 'cash_collected', 'the job closes as cash collected (worker-only cash)');
select throws_ok($$select public.record_cash_worker('00000000-0000-0000-0000-00000000c001', 3200)$$, null, null, 'the amount is write-once');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.confirm_cash_resident('00000000-0000-0000-0000-00000000c001', 3000)$$, null,
  'the worker confirms the cash; you can rate the worker once they do', 'the customer does not confirm cash');
select tests.act('00000000-0000-0000-0000-0000000000b1');

-- ---------------------------------------------------------------- request cancellation
select throws_ok($$select public.request_cancellation('00000000-0000-0000-0000-00000000c001', 'other', 'x')$$, null, 'cancellation can be requested while the job is scheduled or in progress', 'a finished job cannot be cancelled');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select public.request_cancellation('00000000-0000-0000-0000-00000000c002', 'other', 'x')$$, null, null, 'a worker who did not win the job cannot request a cancellation');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.request_cancellation('00000000-0000-0000-0000-00000000c002', 'schedule_conflict', 'Car broke down')$$, 'w1 requests a cancellation');
select is((select cancellation_pending from public.worker_jobs where id = '00000000-0000-0000-0000-00000000c002'), true, 'worker_jobs shows it as pending');
select is((select status::text from public.worker_jobs where id = '00000000-0000-0000-0000-00000000c002'), 'scheduled', 'the job stays scheduled');
select is((select requester_role::text from public.cancellation_requests where job_id = '00000000-0000-0000-0000-00000000c002'), 'worker', 'the request is readable by the worker, as theirs');
select throws_ok($$select public.request_cancellation('00000000-0000-0000-0000-00000000c002', 'other', null)$$, null, 'a cancellation request is already waiting for review', 'a second request is refused while one is pending');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.cancellation_requests where job_id = '00000000-0000-0000-0000-00000000c002'), 0::bigint, 'another worker cannot read the request');
select throws_ok($$select public.withdraw_cancellation_request((select id from public.cancellation_requests where job_id = '00000000-0000-0000-0000-00000000c002' and status = 'pending'))$$, null, null, 'and cannot withdraw it');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.withdraw_cancellation_request((select id from public.cancellation_requests where job_id = '00000000-0000-0000-0000-00000000c002' and status = 'pending'))$$, 'w1 withdraws the request');
select is((select cancellation_pending from public.worker_jobs where id = '00000000-0000-0000-0000-00000000c002'), false, 'it is no longer pending');
select lives_ok($$select public.request_cancellation('00000000-0000-0000-0000-00000000c002', 'safety_concern', null)$$, 'w1 can request again after withdrawing, with no details');
select is((select details from public.cancellation_requests where job_id = '00000000-0000-0000-0000-00000000c002' and status = 'pending'), null, 'details are optional');

select * from finish();
rollback;
