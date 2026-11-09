-- Job lifecycle, competing quotes, cash and privacy rules (docs/DB-API-DESIGN.md sections 2, 5, 9).
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;

-- Acts as a signed-in user for the rest of the transaction; back() returns to the superuser.
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

-- People: one resident, three workers (two approved, one pending), one admin.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev'),
  ('00000000-0000-0000-0000-0000000000b3', 'authenticated', 'authenticated', 'w3@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'admin@test.dev');

insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida Resident', 'res@test.dev', '03001112222', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman One', 'w1@test.dev', '03003334444', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Bilal Two', 'w2@test.dev', '03005556666', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'worker', 'Pending Three', 'w3@test.dev', '03007778888', 'pending'),
  ('00000000-0000-0000-0000-0000000000c1', 'admin', 'Staff', 'admin@test.dev', '03009990000', 'approved');

insert into public.worker_details (profile_id) values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000b3');
-- Plumbing (id 1) in phase 6 for all three workers.
insert into public.worker_categories (worker_id, category_id) select id, 1 from public.profiles where role = 'worker' and id::text like '00000000-0000-0000-0000-%';
insert into public.worker_areas (worker_id, phase) select id, 6 from public.profiles where role = 'worker' and id::text like '00000000-0000-0000-0000-%';

-- ---------------------------------------------------------------- draft and post
select tests.act('00000000-0000-0000-0000-0000000000a1');

select lives_ok($$select public.upsert_address(null, 'Home', 6::smallint, 'Lane 4', '12-C', '2nd', true)$$, 'resident adds an address');

select lives_ok($$
  select public.save_job_draft(null, 1::smallint, (select id from public.addresses limit 1),
    'Kitchen tap leaking', 'Tap under the sink drips all day', 'asap', null, null, null, null,
    array['00000000-0000-0000-0000-0000000000a1/p1.jpg'])
$$, 'resident saves a draft');

select tests.back();
create temp table t_job as select id from public.jobs where title = 'Kitchen tap leaking' limit 1;
grant select on t_job to authenticated;

select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.jobs where title = 'Kitchen tap leaking'), 0::bigint, 'workers do not see a draft');

select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.post_job((select id from t_job))$$, 'resident posts the job');
select is((select status from public.jobs), 'open'::public.job_status, 'job is open');

-- ---------------------------------------------------------------- feed visibility
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.worker_feed where title = 'Kitchen tap leaking'), 1::bigint, 'matching approved worker sees the job in the feed');
select is((select count(*) from public.job_private), 0::bigint, 'plot, floor and phone are hidden before acceptance');

select tests.act('00000000-0000-0000-0000-0000000000b3');
select is((select count(*) from public.worker_feed where title = 'Kitchen tap leaking'), 0::bigint, 'pending worker sees no feed');
select throws_ok($$select public.express_interest((select id from t_job))$$, null, null, 'pending worker cannot show interest');

-- ---------------------------------------------------------------- competing quotes
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.express_interest((select id from t_job))$$, 'worker 1 shows interest');
select throws_ok($$
  select public.submit_quote((select id from t_job), 3000, now() + interval '1 day', now() + interval '1 day 2 hours',
    0, null, 500, null, null)$$, null, null, 'extra charge without a note is refused');
select lives_ok($$
  select public.submit_quote((select id from t_job), 3000, now() + interval '1 day', now() + interval '1 day 2 hours',
    500, 'washer', 0, null, 'bring own tools')$$, 'worker 1 sends a quote');
select is((select total from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1'), 3500, 'total is computed by the database');
select throws_ok($$
  select public.submit_quote((select id from t_job), 1000, now() + interval '1 day', now() + interval '1 day 2 hours')$$,
  null, null, 'a second live quote from the same worker is refused');

select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select public.express_interest((select id from t_job))$$, 'worker 2 shows interest');
select lives_ok($$
  select public.submit_quote((select id from t_job), 2800, now() + interval '2 days', now() + interval '2 days 2 hours')$$,
  'worker 2 sends a quote');
select is((select count(*) from public.quotes), 1::bigint, 'worker 2 sees only their own quote');

select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select status from public.jobs), 'quoted'::public.job_status, 'job is quoted');
select is((select count(*) from public.resident_quotes), 2::bigint, 'resident sees both quotes');
select is((select min(lowest_quote) from public.resident_jobs), 2800, 'lowest quote shown on the job card');
select is((select count(*) from public.resident_quotes where worker_phone is not null), 0::bigint,
  'worker phone is hidden before acceptance');

-- Reject worker 2 first: they cannot quote or show interest again.
select lives_ok($$select public.reject_quote((select id from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b2'))$$,
  'resident rejects worker 2');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select public.express_interest((select id from t_job))$$, null, null, 'rejected worker cannot re-enter the job');

-- ---------------------------------------------------------------- accept
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.accept_quote((select id from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1'))$$,
  'resident accepts worker 1');
select is((select status from public.jobs), 'scheduled'::public.job_status, 'job goes straight to scheduled');
select is((select count(*) from public.resident_quotes where worker_phone = '03003334444'), 1::bigint,
  'accepted worker phone is now visible to the resident');
select throws_ok($$select public.accept_quote((select id from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1'))$$,
  null, null, 'accepting twice is refused');

select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.job_private), 1::bigint, 'accepted worker now sees plot, floor and phone');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.job_private), 0::bigint, 'other workers still see nothing private');

-- ---------------------------------------------------------------- execute and cash
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.complete_job((select id from t_job))$$, null, null, 'cannot complete before starting');
select lives_ok($$select public.start_job((select id from t_job))$$, 'worker starts the job');
select throws_ok($$select public.complete_job((select id from t_job))$$, null, null, 'a job with materials cannot be completed without the bill');
select throws_ok($$select public.complete_job((select id from t_job), '00000000-0000-0000-0000-0000000000b2/bill.jpg')$$, null, null,
  'the bill must be in the worker''s own folder');
select lives_ok($$insert into storage.objects (bucket_id, name, owner) values ('job-media', '00000000-0000-0000-0000-0000000000b1/bill.jpg', '00000000-0000-0000-0000-0000000000b1')$$, 'worker uploads the bill photo');
select lives_ok($$select public.complete_job((select id from t_job), '00000000-0000-0000-0000-0000000000b1/bill.jpg')$$, 'worker completes the job with the bill');
select throws_ok($$select public.record_cash_worker((select id from t_job), 4000)$$, null, null,
  'a different amount needs a reason');
select lives_ok($$select public.record_cash_worker((select id from t_job), 3500)$$, 'worker records the quoted amount');
select is((select status from public.jobs), 'cash_collected'::public.job_status, 'the worker''s cash entry closes the job');
select throws_ok($$select public.record_cash_worker((select id from t_job), 3500)$$, null, null, 'cash entry is write-once');

select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.confirm_cash_resident((select id from t_job), 3500)$$, null,
  'the worker confirms the cash; you can rate the worker once they do', 'the resident no longer confirms cash');
select is((select count(*) from public.notifications where type = 'rate_worker' and job_id = (select id from t_job)), 1::bigint,
  'the resident is asked to rate the worker');

-- ---------------------------------------------------------------- review is anonymous
select lives_ok($$select public.submit_review((select id from t_job), 5::smallint, 4::smallint, 5::smallint, true, 'great')$$,
  'resident rates the worker');
select is((select status from public.jobs), 'reviewed'::public.job_status, 'job is reviewed');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.reviews), 0::bigint, 'worker cannot read reviews');
select is((select rating_count from public.worker_details), 1, 'aggregate rating is updated');
select is((select jobs_done from public.worker_details), 1, 'jobs done counted once cash is collected');

-- ---------------------------------------------------------------- cash different from the quote
select tests.act('00000000-0000-0000-0000-0000000000a1');
select public.save_job_draft(null, 1::smallint, (select id from public.addresses limit 1), 'Second leak', 'Pipe leaking in the bathroom',
  'asap', null, null, null, null, array['00000000-0000-0000-0000-0000000000a1/p2.jpg']);
select tests.back();
create temp table t_job2 as select id from public.jobs where title = 'Second leak';
grant select on t_job2 to authenticated;

select tests.act('00000000-0000-0000-0000-0000000000a1');
select public.post_job((select id from t_job2));
select tests.act('00000000-0000-0000-0000-0000000000b1');
select public.express_interest((select id from t_job2));
select public.submit_quote((select id from t_job2), 2000, now() + interval '1 day', now() + interval '1 day 2 hours');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select public.accept_quote((select id from public.quotes where job_id = (select id from t_job2) and status = 'sent'));
select tests.act('00000000-0000-0000-0000-0000000000b1');
select public.start_job((select id from t_job2));
select public.complete_job((select id from t_job2));
select public.record_cash_worker((select id from t_job2), 2500, 'extra pipe fitting');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select status from public.jobs where id = (select id from t_job2)), 'cash_collected'::public.job_status,
  'an amount different from the quote still closes the job (never disputed by itself)');
select tests.back();
select is((select quote_difference from public.cash_records where job_id = (select id from t_job2)), 500,
  'the gap against the quote is kept on cash_records');
select is((select matched from public.cash_records where job_id = (select id from t_job2)), true,
  'a worker-only entry counts as matched (worker earnings)');
select is((select count(*) from public.reports where job_id = (select id from t_job2)), 0::bigint,
  'a price difference files no report');

-- ---------------------------------------------------------------- rating below 3 -> poor_work report
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.submit_review((select id from t_job2), 2::smallint, 2::smallint, 3::smallint, false, 'left a mess')$$,
  'resident gives a low rating');
select tests.back();
select is((select count(*) from public.reports where job_id = (select id from t_job2) and kind = 'poor_work' and system_generated),
  1::bigint, 'a rating below 3 files a poor_work report');
select is((select count(*) from public.reports where job_id = (select id from t_job)), 0::bigint,
  'a good rating files no report');

-- ---------------------------------------------------------------- audit log is append only
select throws_ok($$update public.audit_log set action = 'x'$$, null, 'audit_log is append only', 'audit rows cannot be changed');
select throws_ok($$delete from public.audit_log$$, null, 'audit_log is append only', 'audit rows cannot be deleted');

select * from finish();
rollback;
