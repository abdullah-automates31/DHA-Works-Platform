-- Migration 0044: the worker proposes the visit window when claiming, may change the quote (price and/or window) once
-- before the customer accepts, and accepting books the worker's window. A stale accept is refused.
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

create function tests.make_job(p_title text, p_n text) returns uuid
language plpgsql as $$
declare
  v_job uuid;
  v_addr uuid;
begin
  perform tests.act('00000000-0000-0000-0000-0000000000a1');
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing today', 'asap', null, null, null, null,
                                 array['00000000-0000-0000-0000-0000000000a1/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;

-- Fixed future windows (whole hours) so the expectations are exact.
create temp table w as select
  date_trunc('hour', now()) + interval '1 day 2 hours' as s1, date_trunc('hour', now()) + interval '1 day 4 hours' as e1,
  date_trunc('hour', now()) + interval '2 days 1 hour' as s2, date_trunc('hour', now()) + interval '2 days 3 hours' as e2;
create temp table t as select tests.make_job('ASAP leak', '1') as a, tests.make_job('Old build', '2') as b;
grant select on w, t to authenticated;

-- ---------------------------------------------------------------- claim with a window
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.accept_job((select a from t), 3000, 0, null, null, now() - interval '1 hour', now() + interval '1 hour') $$,
  'the visit must be in the future', 'a window in the past is refused');
select throws_ok($$ select public.accept_job((select a from t), 3000, 0, null, null, (select e1 from w), (select s1 from w)) $$,
  'the visit must end after it starts', 'a window that ends before it starts is refused');
select throws_ok($$ select public.accept_job((select a from t), 3000, 0, null, null, (select s1 from w), (select s1 from w) + interval '13 hours') $$,
  'the visit window can be at most 12 hours', 'a window over 12 hours is refused');
select throws_ok($$ select public.accept_job((select a from t), 3000, 0, null, null, (select s1 from w), null) $$,
  'choose when you will come', 'half a window is refused');
select lives_ok($$ select public.accept_job((select a from t), 3000, 0, null, null, (select s1 from w), (select e1 from w)) $$,
  'an ASAP job is claimed with a price and a window');
select is((select my_quote_revision from public.worker_jobs where id = (select a from t)), 0::smallint, 'worker_jobs: the quote can still be changed once');
select tests.back();
select is((select visit_start from public.quotes where job_id = (select a from t)), (select s1 from w), 'the window is stored on the quote');

select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select visit_end from public.resident_quotes where job_id = (select a from t)), (select e1 from w), 'the customer sees the window');
select is((select revision from public.resident_quotes where job_id = (select a from t)), 0::smallint, 'and the revision');
select tests.back();

-- ---------------------------------------------------------------- re-quote once
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.revise_quote((select id from public.quotes where job_id = (select a from t)), 2800, 0, null, null, (select s2 from w), (select e2 from w)) $$,
  'quote not found', 'another worker cannot change the quote');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.revise_quote((select id from public.quotes where job_id = (select a from t)), 2800, 200, 'washer', 'cheaper after the call', (select s2 from w), (select e2 from w)) $$,
  'the worker changes price and window after the call');
select throws_ok($$ select public.revise_quote((select id from public.quotes where job_id = (select a from t)), 2500, 0, null, null, (select s2 from w), (select e2 from w)) $$,
  'you have already changed this quote once', 'a second change is refused');
select tests.back();
select is((select total from public.quotes where job_id = (select a from t)), 3000, 'the new total is stored');
select is((select revision from public.quotes where job_id = (select a from t)), 1::smallint, 'the quote is marked as changed');
select is((select visit_start from public.quotes where job_id = (select a from t)), (select s2 from w), 'the new window is stored');
select is((select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and type = 'quote_revised' and job_id = (select a from t)), 1,
  'the customer is notified (push + live refresh)');
select is((select count(*)::int from public.job_events where job_id = (select a from t) and event_type = 'quote_revised'), 1, 'the change is in the job history');

-- ---------------------------------------------------------------- accept: stale revision refused, current one books the window
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select a from t)), 0::smallint) $$,
  'the worker changed the quote', 'accepting the quote as it was before the change is refused');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select a from t)), 1::smallint) $$,
  'accepting the current quote works');
select tests.back();
select is((select status::text from public.jobs where id = (select a from t)), 'scheduled', 'the job is scheduled');
select is((select scheduled_start from public.jobs where id = (select a from t)), (select s2 from w), 'an ASAP job is booked at the worker''s window (start)');
select is((select scheduled_end from public.jobs where id = (select a from t)), (select e2 from w), '... and end');
select is((select agreed_amount from public.cash_records where job_id = (select a from t)), 3000, 'the cash amount is the changed price');

select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.revise_quote((select id from public.quotes where job_id = (select a from t)), 2000, 0, null, null, (select s2 from w), (select e2 from w)) $$,
  'the customer already decided on your quote', 'the quote cannot change after the customer accepted');
select tests.back();

-- ---------------------------------------------------------------- old builds: no window, no revision
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.accept_job((select b from t), 1500) $$, 'an old worker build still claims without a window');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select b from t))) $$,
  'an old customer build still accepts without a revision');
select tests.back();
select is((select scheduled_start from public.jobs where id = (select b from t)), null::timestamptz, 'an ASAP job without a window falls back to no booked time');

select * from finish();
rollback;
