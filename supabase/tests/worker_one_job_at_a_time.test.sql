-- Migration 0058 (16 Nov): a worker who is in the middle of a job may still accept and quote another, but only for a booked
-- day and time (never "as soon as possible"); a second job may be STARTED only for the same customer on the same day;
-- one visiting time is enough (the stored end is one hour later); and a worker is reminded one hour before a visit.
-- (File name kept from 0056; the rules it checks changed.)
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

create function tests.make_job(p_res uuid, p_title text, p_n text) returns uuid
language plpgsql as $$
declare
  v_job uuid;
  v_addr uuid;
begin
  perform tests.act(p_res);
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing today', 'asap', null, null, null, null,
                                 array[p_res::text || '/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;

-- A and B: customer one; C: customer two; D: customer one (a different day); E, F: more jobs of customer one.
create temp table t as select
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job A', '1') as a,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job B', '2') as b,
  tests.make_job('00000000-0000-0000-0000-0000000000a2', 'Job C', '3') as c,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job D', '4') as d,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job E', '5') as e,
  tests.make_job('00000000-0000-0000-0000-0000000000a1', 'Job F', '6') as f;
grant select on t to authenticated;
-- tomorrow 10:00 / 14:00 and the day after at 10:00, Karachi time
create temp table slot as select
  ((date_trunc('day', now() at time zone 'Asia/Karachi') + interval '1 day 10 hours') at time zone 'Asia/Karachi') as d1_10,
  ((date_trunc('day', now() at time zone 'Asia/Karachi') + interval '1 day 14 hours') at time zone 'Asia/Karachi') as d1_14,
  ((date_trunc('day', now() at time zone 'Asia/Karachi') + interval '2 days 10 hours') at time zone 'Asia/Karachi') as d2_10;
grant select on slot to authenticated;

-- 1. A free worker claims with ONE time; the stored end is one hour later -----------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.accept_job((select a from t), 3000, p_visit_start => (select d1_10 from slot)) $$, 'a free worker claims job A with a start time only');
select tests.back();
select is((select visit_end - visit_start from public.quotes where job_id = (select a from t)), interval '1 hour', 'the stored end is one hour after the start');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select a from t))) $$, 'the customer accepts');
select tests.back();
select is((select status::text from public.jobs where id = (select a from t)), 'scheduled', 'job A is scheduled');
select is((select scheduled_start from public.jobs where id = (select a from t)), (select d1_10 from slot), 'booked at the time the worker named');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.start_job((select a from t)) $$, 'the worker starts job A (now in progress)');

-- 2. A busy worker may accept and quote, but only for a booked time ---------------------------------------------------------
select is((select count(*) from public.worker_feed where id in ((select b from t), (select c from t), (select d from t))), 3::bigint, 'busy: other jobs are still in the feed');
select throws_ok($$ select public.accept_job((select b from t), 2000) $$, 'choose the day and time you will visit', 'busy and no time: refused (no ASAP)');
select throws_ok($$ select public.accept_job((select b from t), 2000, p_visit_end => (select d1_14 from slot)) $$, 'choose the day and time you will visit', 'an end without a start does not count as a time');
select throws_ok($$ select public.accept_job((select b from t), 2000, p_visit_start => now() - interval '1 hour') $$, 'the visit must be in the future', 'a time in the past is refused');
select lives_ok($$ select public.accept_job((select b from t), 2000, p_visit_start => (select d1_14 from slot)) $$, 'busy with a time: job B (same customer) is quoted');
select lives_ok($$ select public.accept_job((select c from t), 2500, p_visit_start => (select d1_14 from slot)) $$, 'job C (another customer) can be quoted too');
select lives_ok($$ select public.accept_job((select d from t), 1800, p_visit_start => (select d2_10 from slot)) $$, 'job D (same customer, the next day) can be quoted too');
select tests.back();
select is((select count(*) from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1' and busy_eta_pending), 0::bigint, 'nothing is held back for a finish time any more');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and type = 'quote_received' and job_id = (select b from t)), 1::bigint, 'the customer is told at once');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'busy_eta_needed'), 0::bigint, 'and the worker is not asked for a finish time');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select visit_start from public.resident_quotes where job_id = (select b from t)), (select d1_14 from slot), 'the customer sees the visit time with the quote');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select b from t))) $$, 'the customer accepts job B');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select d from t))) $$, 'and job D');
select tests.act('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select c from t))) $$, 'customer two accepts job C');
select tests.back();
select is((select status::text from public.jobs where id = (select b from t)), 'scheduled', 'job B is a scheduled job, not ASAP');
select is((select scheduled_start from public.jobs where id = (select b from t)), (select d1_14 from slot), 'booked at the quoted time');

-- 3. Starting a second job: same customer and same day only ---------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.start_job((select c from t)) $$, 'finish your current job before starting a job for another customer or on another day', 'another customer: refused');
select throws_ok($$ select public.start_job((select d from t)) $$, 'finish your current job before starting a job for another customer or on another day', 'same customer, another day: refused');
select lives_ok($$ select public.start_job((select b from t)) $$, 'same customer, same day: allowed');
select is((select count(*) from public.jobs where accepted_worker_id = '00000000-0000-0000-0000-0000000000b1' and status = 'in_progress'), 2::bigint, 'two jobs are in progress');
-- Finishing one is not enough while the other is still running
select lives_ok($$ select public.complete_job((select a from t), null) $$, 'job A is completed');
select throws_ok($$ select public.start_job((select c from t)) $$, 'finish your current job before starting a job for another customer or on another day', 'job B is still running: customer two still waits');
select lives_ok($$ select public.complete_job((select b from t), null) $$, 'job B is completed');
select lives_ok($$ select public.start_job((select c from t)) $$, 'now the other customer job can start');
select throws_ok($$ select public.start_job((select d from t)) $$, 'finish your current job before starting a job for another customer or on another day', 'and job D (another customer than C) still waits');
select tests.back();

-- 4. Other workers cannot start someone else's job, nor start one that is not scheduled -------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.start_job((select d from t)) $$, 'this job cannot be started', 'another worker cannot start it');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.start_job((select a from t)) $$, 'this job cannot be started', 'and a finished job cannot be started again');
select tests.back();

-- 5. Quotes held before this change still expire; the old hold still blocks a second claim -------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.accept_job((select e from t), 1500, p_visit_start => (select d1_10 from slot)) $$, 'a free worker claims job E');
select tests.back();
update public.quotes set busy_eta_pending = true where job_id = (select e from t);
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.accept_job((select f from t), 1500, p_visit_start => (select d1_10 from slot)) $$, 'tell the customer how long your current job will take on your other quote first', 'an old held quote still blocks a second claim');
select tests.back();
update public.quotes set created_at = now() - interval '31 minutes' where job_id = (select e from t);
select is(private.expire_busy_eta(), 1, 'an old held quote is withdrawn after 30 minutes');
select is((select status::text from public.jobs where id = (select e from t)), 'open', 'and the job is open again');

-- 6. Reminders: a switch, and a notice one hour before the visit (once) ----------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select job_reminders from public.worker_details), true, 'reminders are on by default');
select lives_ok($$ select public.accept_job((select f from t), 1500, p_visit_start => now() + interval '3 hours') $$, 'the worker quotes job F for three hours ahead');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select f from t))) $$, 'the customer accepts');
select tests.back();
select is(private.send_job_reminders(), 0, 'three hours ahead: no reminder yet');
update public.jobs set scheduled_start = now() + interval '50 minutes', scheduled_end = now() + interval '110 minutes' where id = (select f from t);
update public.quotes set decided_at = now() - interval '2 hours' where job_id = (select f from t) and status = 'accepted';
select is(private.send_job_reminders(), 1, 'fifty minutes ahead: one reminder');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b2' and type = 'job_reminder' and job_id = (select f from t)), 1::bigint, 'the worker has the reminder notice');
select is(private.send_job_reminders(), 0, 'and it is sent only once');
update public.jobs set scheduled_start = now() + interval '40 minutes' where id = (select f from t);
select is((select worker_reminded_at from public.jobs where id = (select f from t)), null::timestamptz, 'a visit that moves is reminded again');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.set_job_reminders(false) $$, 'the worker switches reminders off');
select is((select job_reminders from public.worker_details), false, 'stored');
select tests.back();
select is(private.send_job_reminders(), 0, 'switched off: no reminder');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.set_job_reminders(null) $$, 'choose on or off', 'null is refused');
select throws_ok($$ update public.worker_details set job_reminders = true $$, '42501', 'permission denied for table worker_details', 'the table cannot be written directly');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.set_job_reminders(true) $$, null, 'a customer cannot change a worker switch');
select tests.back();
select is(has_function_privilege('anon', 'public.set_job_reminders(boolean)', 'execute'), false, 'signed-out callers cannot call it');
select is(has_function_privilege('authenticated', 'private.send_job_reminders()', 'execute'), false, 'the sweep is not callable by apps');
-- a visit booked inside the hour is not reminded (the worker has just agreed to it)
update public.worker_details set job_reminders = true where profile_id = '00000000-0000-0000-0000-0000000000b2';
update public.jobs set scheduled_start = now() + interval '30 minutes', worker_reminded_at = null where id = (select f from t);
update public.quotes set decided_at = now() where job_id = (select f from t) and status = 'accepted';
select is(private.send_job_reminders(), 0, 'booked less than an hour ahead: no reminder');

select * from finish();
rollback;
