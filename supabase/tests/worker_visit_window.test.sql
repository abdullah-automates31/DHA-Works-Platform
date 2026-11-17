-- Migrations 0044 and 0059: the visit time is the one the CUSTOMER chose (a worker cannot pick or change it). The worker may
-- change the quote (price) once before the customer accepts, and accepting books the customer's time. A stale accept is refused.
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

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'res1@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida One', 'res1@test.dev', '03001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman One', 'w1@test.dev', '03003334444', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Bilal Two', 'w2@test.dev', '03005556666', 'approved');
insert into public.worker_details (profile_id) values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');
insert into public.worker_categories (worker_id, category_id) values
  ('00000000-0000-0000-0000-0000000000b1', 1), ('00000000-0000-0000-0000-0000000000b2', 1);
insert into public.worker_areas (worker_id, phase) values
  ('00000000-0000-0000-0000-0000000000b1', 6), ('00000000-0000-0000-0000-0000000000b2', 6);

create function tests.make_job(p_title text, p_n text, p_date date, p_from time) returns uuid
language plpgsql as $$
declare
  v_job uuid;
  v_addr uuid;
begin
  perform tests.act('00000000-0000-0000-0000-0000000000a1');
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing today',
                                 case when p_date is null then 'asap' else 'scheduled' end::public.job_urgency,
                                 p_date, p_from, case when p_from is null then null else p_from + interval '1 hour' end, null,
                                 array['00000000-0000-0000-0000-0000000000a1/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;

-- The customer picks tomorrow 14:00 (Karachi). Whatever time a worker sends is ignored (0059).
create temp table w as select
  ((((now() at time zone 'Asia/Karachi')::date + 1) + time '14:00') at time zone 'Asia/Karachi') as s1,
  ((((now() at time zone 'Asia/Karachi')::date + 1) + time '15:00') at time zone 'Asia/Karachi') as e1,
  date_trunc('hour', now()) + interval '5 days' as other_start;
create temp table t as select
  tests.make_job('Booked leak', '1', (now() at time zone 'Asia/Karachi')::date + 1, time '14:00') as a,
  tests.make_job('Old ASAP job', '2', null, null) as b;
grant select on w, t to authenticated;

-- ---------------------------------------------------------------- the visit is the customer's time
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.accept_job((select a from t), 3000, 0, null, null, (select other_start from w), (select other_start from w) + interval '2 hours') $$,
  'a worker who sends his own time still quotes');
select is((select my_quote_revision from public.worker_jobs where id = (select a from t)), 0::smallint, 'worker_jobs: the quote can still be changed once');
select tests.back();
select is((select visit_start from public.quotes where job_id = (select a from t)), (select s1 from w), 'the quote carries the CUSTOMER time, not the worker one');
select is((select visit_end from public.quotes where job_id = (select a from t)), (select e1 from w), 'the stored end is one hour after the start');

select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select visit_end from public.resident_quotes where job_id = (select a from t)), (select e1 from w), 'the customer sees his own time on the quote');
select is((select revision from public.resident_quotes where job_id = (select a from t)), 0::smallint, 'and the revision');
select tests.back();

-- ---------------------------------------------------------------- re-quote once (price only)
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.revise_quote((select id from public.quotes where job_id = (select a from t)), 2800, 0, null, null, null, null) $$,
  'quote not found', 'another worker cannot change the quote');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.revise_quote((select id from public.quotes where job_id = (select a from t)), 2800, 200, 'washer', 'cheaper after the call', (select other_start from w), (select other_start from w) + interval '2 hours') $$,
  'the worker changes the price after the call (a time he sends is ignored)');
select throws_ok($$ select public.revise_quote((select id from public.quotes where job_id = (select a from t)), 2500, 0, null, null, null, null) $$,
  'you have already changed this quote once', 'a second change is refused');
select tests.back();
select is((select total from public.quotes where job_id = (select a from t)), 3000, 'the new total is stored');
select is((select revision from public.quotes where job_id = (select a from t)), 1::smallint, 'the quote is marked as changed');
select is((select visit_start from public.quotes where job_id = (select a from t)), (select s1 from w), 'the visit is still the customer time');
select is((select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and type = 'quote_revised' and job_id = (select a from t)), 1,
  'the customer is notified (push + live refresh)');
select is((select count(*)::int from public.job_events where job_id = (select a from t) and event_type = 'quote_revised'), 1, 'the change is in the job history');

-- ---------------------------------------------------------------- accept: stale revision refused, current one books the customer's time
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select a from t)), 0::smallint) $$,
  'the worker changed the quote', 'accepting the quote as it was before the change is refused');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select a from t)), 1::smallint) $$,
  'accepting the current quote works');
select tests.back();
select is((select status::text from public.jobs where id = (select a from t)), 'scheduled', 'the job is scheduled');
select is((select scheduled_start from public.jobs where id = (select a from t)), (select s1 from w), 'booked at the customer time (start)');
select is((select scheduled_end from public.jobs where id = (select a from t)), (select e1 from w), '... and end');
select is((select agreed_amount from public.cash_records where job_id = (select a from t)), 3000, 'the cash amount is the changed price');

select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.revise_quote((select id from public.quotes where job_id = (select a from t)), 2000, 0, null, null, null, null) $$,
  'the customer already decided on your quote', 'the quote cannot change after the customer accepted');
select tests.back();

-- ---------------------------------------------------------------- an old job with no time, and a time that has passed
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.accept_job((select b from t), 1500) $$, 'an old job with no time is still quoted by a free worker');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select b from t))) $$,
  'and the customer accepts it');
select tests.back();
select is((select scheduled_start from public.jobs where id = (select b from t)), null::timestamptz, 'an old job without a customer time has no booked time');

-- the customer time passes while the job waits: it cannot be quoted any more
select tests.back();
create temp table c as select tests.make_job('Time already gone', '3', (now() at time zone 'Asia/Karachi')::date + 1, time '09:00') as id;
grant select on c to authenticated;
update public.jobs set preferred_date = (now() at time zone 'Asia/Karachi')::date - 1 where id = (select id from c);
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.accept_job((select id from c), 1500) $$,
  'the visiting time the customer chose has already passed', 'a visiting time in the past cannot be quoted');
select tests.back();

select * from finish();
rollback;
