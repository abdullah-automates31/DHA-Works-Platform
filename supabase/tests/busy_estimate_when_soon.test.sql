-- Migration 0070 (20 Nov): a busy worker must say how long the current job will take ONLY when the customer's visit is soon
-- (within app_settings busy_estimate_window_hours, default 6). A visit later than that, such as tomorrow, needs no answer.
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
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'res2@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida One', 'res1@test.dev', '03001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000a2', 'resident', 'Sana Two', 'res2@test.dev', '03001110002', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman One', 'w1@test.dev', '03003334444', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Bilal Two', 'w2@test.dev', '03005556666', 'approved');
insert into public.worker_details (profile_id) values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');
insert into public.worker_categories (worker_id, category_id) values
  ('00000000-0000-0000-0000-0000000000b1', 1), ('00000000-0000-0000-0000-0000000000b2', 1);
insert into public.worker_areas (worker_id, phase) values
  ('00000000-0000-0000-0000-0000000000b1', 6), ('00000000-0000-0000-0000-0000000000b2', 6);

create function tests.make_job(p_res uuid, p_title text, p_n text, p_day int default null, p_from time default null) returns uuid
language plpgsql as $$
declare
  v_job uuid;
  v_addr uuid;
begin
  perform tests.act(p_res);
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing today',
                                 case when p_day is null then 'asap' else 'scheduled' end::public.job_urgency,
                                 case when p_day is null then null else (now() at time zone 'Asia/Karachi')::date + p_day end, p_from,
                                 case when p_from is null then null else p_from + interval '1 hour' end, null,
                                 array[p_res::text || '/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;

-- Jobs of customer one: A is the worker's current job; S2 and S5 have visits 2 and 5 hours away, F7 7 hours away,
-- FT tomorrow, SX is another soon job for the free worker.
create temp table t as select
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job A', '1', 1, time '10:00') as a,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job S2', '2', 1, time '10:00') as s2,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job S5', '3', 1, time '10:00') as s5,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job F7', '4', 1, time '10:00') as f7,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job FT', '5', 1, time '10:00') as ft,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job SX', '6', 1, time '10:00') as sx,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job F9', '7', 1, time '10:00') as f9;
grant select on t to authenticated;

-- Put the visit of a job h hours from now (Karachi date and time taken from the same instant, so midnight cannot split them).
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
select tests.visit_in((select s5 from t), 5);
select tests.visit_in((select f7 from t), 7);
select tests.visit_in((select sx from t), 2);
select tests.visit_in((select f9 from t), 9);

-- The worker's current job: claimed, accepted by the customer, started.
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.accept_job((select a from t), 3000) $$, 'free worker claims job A');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select a from t))) $$, 'the customer accepts');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.start_job((select a from t)) $$, 'job A is in progress: the worker is busy');

-- 1. Soon: the estimate is required
select throws_ok($$ select public.accept_job((select s2 from t), 2000) $$, 'tell the customer how long your current job will take, because this visit is soon', 'busy, visit in 2 hours, no estimate: refused');
select throws_ok($$ select public.accept_job((select s5 from t), 2000) $$, 'tell the customer how long your current job will take, because this visit is soon', 'busy, visit in 5 hours, no estimate: refused');
select throws_ok($$ select public.accept_job((select s2 from t), 2000, p_busy_eta_minutes => 2) $$, 'the time left on your current job must be between 5 minutes and 3 days', 'an estimate outside 5 minutes to 3 days is still refused');
select lives_ok($$ select public.accept_job((select s2 from t), 2000, p_busy_eta_minutes => 90) $$, 'busy, visit in 2 hours, with an estimate: quoted');
select tests.back();
select is((select busy_eta_minutes from public.quotes where job_id = (select s2 from t)), 90, 'the estimate is stored on the quote');
select is((select (payload->>'busy_eta_minutes')::int from public.notifications where job_id = (select s2 from t) and type = 'quote_received'), 90, 'and the customer notice carries it');

-- 2. Later: no estimate needed
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.accept_job((select f7 from t), 2000) $$, 'busy, visit in 7 hours, no estimate: quoted');
select lives_ok($$ select public.accept_job((select ft from t), 2000) $$, 'busy, visit tomorrow, no estimate: quoted');
select tests.back();
select is((select busy_eta_minutes from public.quotes where job_id = (select ft from t)), null, 'no estimate is stored when none was asked');

-- 3. The window is a setting: with 12 hours a visit 9 hours away needs the estimate too
update public.app_settings set value = '12'::jsonb where key = 'busy_estimate_window_hours';
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.accept_job((select f9 from t), 2000) $$, 'tell the customer how long your current job will take, because this visit is soon', 'window 12 hours: a visit in 9 hours now needs the estimate');
select lives_ok($$ select public.accept_job((select f9 from t), 2000, p_busy_eta_minutes => 600) $$, 'and is quoted with one');
select tests.back();

-- 4. A free worker is never asked
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.accept_job((select sx from t), 2000) $$, 'a free worker quotes a job 2 hours away with no estimate');
select tests.back();

select * from finish();
rollback;
