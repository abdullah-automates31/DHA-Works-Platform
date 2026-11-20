-- Attack drill for migration 0070: a busy worker tries every way round "say how long your current job will take when the visit
-- is soon". Each attempt must fail (or, where the rule does not apply, be shown to be harmless). Fake data, rolled back.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated, anon;
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
-- true when the statement is refused for any reason (runs with the caller's role)
create function tests.fails(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;
grant execute on function tests.act(uuid), tests.back(), tests.fails(text) to authenticated, anon;

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

create function tests.make_job(p_res uuid, p_title text, p_n text) returns uuid
language plpgsql as $$
declare
  v_job uuid;
  v_addr uuid;
begin
  perform tests.act(p_res);
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing',
                                 'scheduled'::public.job_urgency,
                                 (now() at time zone 'Asia/Karachi')::date + 1, time '10:00', time '11:00', null,
                                 array[p_res::text || '/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;

-- A: the worker's current job. S2, S3: visits 2 and 3 hours away. S4: 4 hours (moved later in the test). S6: 6.2 hours.
create temp table t as select
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job A', '1') as a,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job S2', '2') as s2,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job S3', '3') as s3,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job S4', '4') as s4,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job S6', '5') as s6,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job S5', '6') as s5;
grant select on t to authenticated, anon;

create function tests.visit_in(p_job uuid, p_hours numeric) returns void language plpgsql as $$
declare
  v_at timestamp := (now() + make_interval(secs => (p_hours * 3600)::int)) at time zone 'Asia/Karachi';
  v_from time := date_trunc('minute', v_at)::time;
begin
  update public.jobs set preferred_date = v_at::date, window_from = v_from,
                         window_to = case when v_from < time '23:00' then v_from + interval '1 hour' else time '23:59:59' end
   where id = p_job;
end $$;
select tests.visit_in((select s2 from t), 2);
select tests.visit_in((select s3 from t), 3);
select tests.visit_in((select s4 from t), 4);
select tests.visit_in((select s5 from t), 5.9);
select tests.visit_in((select s6 from t), 6.2);

-- the worker becomes busy: job A is claimed, accepted by the customer and started
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.accept_job((select a from t), 3000) $$, 'free worker claims job A');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select a from t))) $$, 'the customer accepts');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.start_job((select a from t)) $$, 'job A is in progress: the worker is busy');

select throws_ok($$ select public.accept_job((select s2 from t), 2000) $$, 'tell the customer how long your current job will take, because this visit is soon', 'baseline: no estimate on a soon visit is refused');

-- 1. Wrong or odd estimate values
select throws_ok($$ select public.accept_job((select s2 from t), 2000, p_busy_eta_minutes => 0) $$, 'the time left on your current job must be between 5 minutes and 3 days', 'zero minutes');
select throws_ok($$ select public.accept_job((select s2 from t), 2000, p_busy_eta_minutes => -30) $$, 'the time left on your current job must be between 5 minutes and 3 days', 'negative minutes');
select throws_ok($$ select public.accept_job((select s2 from t), 2000, p_busy_eta_minutes => 4321) $$, 'the time left on your current job must be between 5 minutes and 3 days', 'more than 3 days');
select throws_ok($$ select public.accept_job((select s2 from t), 2000, p_busy_eta_minutes => 2147483647) $$, 'the time left on your current job must be between 5 minutes and 3 days', 'huge number');

-- 2. Lying about the visit time: the worker cannot send his own visit time to look "later"
select throws_ok($$ select public.accept_job((select s2 from t), 2000, p_visit_start => now() + interval '30 days') $$, 'tell the customer how long your current job will take, because this visit is soon', 'sending a far visit time does not change the real one');
select throws_ok($$ select public.accept_job((select s2 from t), 2000, p_visit_end => now() + interval '30 days') $$, 'tell the customer how long your current job will take, because this visit is soon', 'nor does sending only an end time');

-- 3. Other doors that can create a quote or change a job
select ok(tests.fails($$ select public.submit_quote((select s3 from t), 2000, now() + interval '30 days', now() + interval '31 days', 0, null, 0, null, null, null) $$), 'the old submit_quote path is refused for a busy worker');
select ok(tests.fails($$ select public.express_interest((select s3 from t)) $$), 'the old express_interest path is refused for a busy worker');
select ok(tests.fails($$ insert into public.quotes (job_id, worker_id, labour, materials, status, visit_start, visit_end) values ((select s4 from t), '00000000-0000-0000-0000-0000000000b1', 1000, 0, 'sent', now(), now()) $$), 'a direct INSERT into quotes is refused for the worker role');
-- direct writes as the worker role (refused or filtered to nothing; either way the data must be unchanged, checked below)
select tests.fails($$ update public.jobs set status = 'quoted' where id = (select s4 from t) $$);
select tests.fails($$ update public.app_settings set value = '0'::jsonb where key = 'busy_estimate_window_hours' $$);
select tests.back();
select is(private.setting_int('busy_estimate_window_hours', 6), 6, 'the worker could not shrink the window by writing to app_settings');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.quotes where job_id in ((select s3 from t), (select s4 from t))), 0::bigint, 'none of those attempts left a quote behind');
select is((select status::text from public.jobs where id = (select s4 from t)), 'open', 'and the soon job is still open');

-- 4. Boundary: 5.9 hours away still needs it, 6.2 hours away does not
select throws_ok($$ select public.accept_job((select s5 from t), 2000) $$, 'tell the customer how long your current job will take, because this visit is soon', '5.9 hours away: still needs it');
select lives_ok($$ select public.accept_job((select s6 from t), 2000) $$, '6.2 hours away: does not');

-- 5. A proper quote, then trying to strip or fake the estimate afterwards
select lives_ok($$ select public.accept_job((select s2 from t), 2000, p_busy_eta_minutes => 90) $$, 'a proper quote with an estimate goes through');
select tests.back();
select is((select busy_eta_minutes from public.quotes where job_id = (select s2 from t)), 90, 'estimate stored');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select tests.fails($$ update public.quotes set busy_eta_minutes = null where job_id = (select s2 from t) $$);
select tests.back();
select is((select busy_eta_minutes from public.quotes where job_id = (select s2 from t)), 90, 'a direct UPDATE could not remove the estimate');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.revise_quote((select id from public.quotes where job_id = (select s2 from t)), 2500) $$, 'revising the price is allowed');
select tests.back();
select is((select busy_eta_minutes from public.quotes where job_id = (select s2 from t)), 90, 'and the revision keeps the estimate');

-- 6. Known limit (documented, not a bypass): a worker who is FREE when he quotes is not asked; if he becomes busy later the
-- earlier quote stands. The customer decides knowing the worker was free at that moment.
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.accept_job((select s3 from t), 2000) $$, 'a free worker quotes a soon job without an estimate (allowed)');
select tests.back();

-- 7. Other roles cannot call it at all
select tests.act('00000000-0000-0000-0000-0000000000a1');
select ok(tests.fails($$ select public.accept_job((select s4 from t), 2000, p_busy_eta_minutes => 30) $$), 'a resident cannot call accept_job');
select tests.back();
set local role anon;
select ok(tests.fails($$ select public.accept_job((select s4 from t), 2000, p_busy_eta_minutes => 30) $$), 'a signed-out caller cannot call accept_job');
reset role;

select * from finish();
rollback;
