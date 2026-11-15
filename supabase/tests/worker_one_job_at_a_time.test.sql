-- Migration 0056: a worker does one job at a time. While a job is in progress (started, not yet marked complete) the
-- worker's feed is empty and accept_job, express_interest and submit_quote refuse. Other workers are unaffected.
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

create temp table t as select tests.make_job('First job', '1') as a, tests.make_job('Second job', '2') as b, tests.make_job('Third job', '3') as c;
grant select on t to authenticated;

-- 1. Before any job is started the worker sees everything and can claim --------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.worker_feed), 3::bigint, 'a free worker sees all three jobs');
select lives_ok($$ select public.accept_job((select a from t), 3000) $$, 'and claims the first job');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select a from t))) $$, 'the customer accepts: the job is scheduled');
select tests.back();

-- 2. A scheduled job (not started) does not block -------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.worker_feed), 2::bigint, 'scheduled only: the other two jobs are still visible');
select lives_ok($$ select public.accept_job((select b from t), 2000) $$, 'and a second job can still be claimed while the first is only scheduled');
select tests.back();

-- 3. Starting the first job blocks everything new -----------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.start_job((select a from t)) $$, 'the worker starts the first job');
select is((select count(*) from public.worker_feed), 0::bigint, 'in progress: the feed is empty');
select is((select count(*) from public.worker_feed where id = (select c from t)), 0::bigint, 'the open third job is invisible');
select throws_ok($$ select public.accept_job((select c from t), 1000) $$, 'finish the job you have started before taking another', 'accept_job is refused');
select throws_ok($$ select public.express_interest((select c from t)) $$, 'finish the job you have started before taking another', 'express_interest is refused');
select throws_ok($$ select public.submit_quote((select c from t), 1000) $$, 'finish the job you have started before taking another', 'submit_quote is refused');
select is((select count(*) from public.worker_jobs where is_mine and id = (select a from t)), 1::bigint, 'the started job stays in My jobs');
select is((select my_quote_status::text from public.worker_jobs where id = (select b from t)), 'sent', 'and the quote already sent on the second job stays visible to the worker');
select tests.back();
select is((select status::text from public.jobs where id = (select c from t)), 'open', 'the third job stays open for everyone else');

-- 4. Other workers are not affected --------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.worker_feed where id = (select c from t)), 1::bigint, 'another worker still sees the third job');
select lives_ok($$ select public.accept_job((select c from t), 1500) $$, 'and can claim it');
select tests.back();

-- 5. Marking the job complete frees the worker --------------------------------------------------------------------
create temp table t2 as select tests.make_job('Fourth job', '4') as d;
grant select on t2 to authenticated;
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.worker_feed where id = (select d from t2)), 0::bigint, 'a new job posted meanwhile is hidden too');
select lives_ok($$ select public.complete_job((select a from t), null) $$, 'the worker marks the first job complete');
select is((select count(*) from public.worker_feed where id = (select d from t2)), 1::bigint, 'the feed is back');
select lives_ok($$ select public.accept_job((select d from t2), 2500) $$, 'and a new job can be claimed');
select tests.back();

select * from finish();
rollback;
