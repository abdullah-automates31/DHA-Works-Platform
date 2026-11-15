-- Migration 0057: a worker who is in the middle of a job (in_progress) still sees jobs and may claim one. The quote then
-- waits for the worker to say how long the current job will take (set_busy_eta); only after that does the customer see the
-- quote, with that time. A quote that is never answered is withdrawn after 30 minutes. A second job cannot be started while
-- one is in progress.
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

create temp table t as select tests.make_job('First job', '1') as a, tests.make_job('Second job', '2') as b,
  tests.make_job('Third job', '3') as c, tests.make_job('Fourth job', '4') as d, tests.make_job('Fifth job', '5') as e;
grant select on t to authenticated;

-- 1. A free worker claims; the customer is told at once; nothing waits ---------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.worker_feed), 5::bigint, 'a free worker sees all five jobs');
select lives_ok($$ select public.accept_job((select a from t), 3000) $$, 'and claims the first job');
select tests.back();
select is((select busy_eta_pending from public.quotes where job_id = (select a from t)), false, 'nothing waits for a free worker');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and type = 'quote_received' and job_id = (select a from t)), 1::bigint, 'the customer got the quote notice at once');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select busy_eta_minutes from public.resident_quotes where job_id = (select a from t)), null::integer, 'and sees a quote with no estimate');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select a from t))) $$, 'the customer accepts: scheduled');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.start_job((select a from t)) $$, 'the worker starts the first job');

-- 2. A busy worker still sees jobs and claims without being refused -----------------------------------------------
select is((select count(*) from public.worker_feed), 4::bigint, 'in progress: the other four jobs are still in the feed');
select lives_ok($$ select public.accept_job((select b from t), 2000) $$, 'and the second job can be claimed');
select tests.back();

-- 3. The quote waits; the worker is told; the customer is not -------------------------------------------------------
create temp table qb as select id from public.quotes where job_id = (select b from t);
grant select on qb to authenticated;
select is((select busy_eta_pending from public.quotes where job_id = (select b from t)), true, 'the quote waits for the estimate');
select is((select status::text from public.jobs where id = (select b from t)), 'quoted', 'the job is held for this worker');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'busy_eta_needed' and job_id = (select b from t)), 1::bigint, 'the worker is asked how long their current job will take');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and type = 'quote_received' and job_id = (select b from t)), 0::bigint, 'the customer has not been told');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.resident_quotes where job_id = (select b from t)), 0::bigint, 'the customer does not see the quote yet');
select is((select count(*) from public.quotes where job_id = (select b from t)), 0::bigint, 'nor in the quotes table (the row is closed to the customer)');
select throws_ok($$ select public.accept_quote((select id from qb)) $$, 'the worker has not said yet how long their current job will take', 'and could not accept it even knowing its id');
select throws_ok($$ select public.reject_quote((select id from qb)) $$, 'quote not found', 'nor reject it');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.revise_quote((select id from public.quotes where job_id = (select b from t)), 900) $$, 'tell the customer how long your current job will take first', 'the worker cannot change the quote before answering');
select throws_ok($$ select public.accept_job((select c from t), 1500) $$, 'tell the customer how long your current job will take on your other quote first', 'and cannot claim a third job while one answer is owed');
select is((select count(*) from public.worker_feed where id = (select c from t)), 1::bigint, 'the third job stays in the feed for everyone');

-- 4. The worker answers ------------------------------------------------------------------------------------------------
select throws_ok($$ select public.set_busy_eta((select id from public.quotes where job_id = (select b from t)), 4) $$, 'the time left on your current job must be between 5 minutes and 3 days', 'under 5 minutes is refused');
select throws_ok($$ select public.set_busy_eta((select id from public.quotes where job_id = (select b from t)), 4321) $$, 'the time left on your current job must be between 5 minutes and 3 days', 'over 3 days is refused');
select throws_ok($$ select public.set_busy_eta((select id from public.quotes where job_id = (select b from t)), null) $$, 'the time left on your current job must be between 5 minutes and 3 days', 'no number is refused');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.set_busy_eta((select id from public.quotes where job_id = (select b from t)), 20) $$, 'quote not found', 'another worker cannot answer for them');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.set_busy_eta((select id from public.quotes where job_id = (select b from t)), 20) $$, 'the worker says 20 minutes');
select throws_ok($$ select public.set_busy_eta((select id from public.quotes where job_id = (select b from t)), 30) $$, 'there is nothing to answer on this quote', 'and cannot change it afterwards');
select tests.back();

-- 5. Now the customer sees it ------------------------------------------------------------------------------------------
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and type = 'quote_received'
            and job_id = (select b from t) and (payload->>'busy_eta_minutes')::int = 20), 1::bigint, 'the customer is told now, with the 20 minutes');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select busy_eta_minutes from public.resident_quotes where job_id = (select b from t)), 20, 'the customer sees the quote with 20 minutes');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select b from t))) $$, 'and can accept it (they chose to wait)');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.start_job((select b from t)) $$, 'finish the job you have started before starting another', 'the second job cannot be started while the first is in progress');
select lives_ok($$ select public.complete_job((select a from t), null) $$, 'the worker finishes the first job');
select lives_ok($$ select public.start_job((select b from t)) $$, 'and can then start the second');
select tests.back();

-- 6. A quote that is never answered is withdrawn after 30 minutes --------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.accept_job((select c from t), 1500) $$, 'busy again: the worker claims a third job and does not answer');
select tests.back();
select is(private.expire_busy_eta(), 0, 'right away nothing is withdrawn');
update public.quotes set created_at = now() - interval '31 minutes' where job_id = (select c from t);
select is(private.expire_busy_eta(), 1, 'after 31 minutes the quote is withdrawn');
select is((select status::text from public.jobs where id = (select c from t)), 'open', 'the job is open for everyone again');
select is((select status::text from public.quotes where job_id = (select c from t)), 'withdrawn', 'the quote is closed');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'busy_eta_expired' and job_id = (select c from t)), 1::bigint, 'and the worker is told');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.set_busy_eta((select id from public.quotes where job_id = (select c from t)), 20) $$, 'there is nothing to answer on this quote', 'a late answer is refused');
select tests.back();

-- 7. A caller that already knows the time sends it with the claim (nothing waits) ------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.accept_job((select d from t), 2500, p_busy_eta_minutes => 3) $$, 'the time left on your current job must be between 5 minutes and 3 days', 'a time out of range is refused');
select lives_ok($$ select public.accept_job((select d from t), 2500, p_busy_eta_minutes => 45) $$, 'a time sent with the claim works');
select tests.back();
select is((select busy_eta_pending from public.quotes where job_id = (select d from t)), false, 'nothing waits');
select is((select busy_eta_minutes from public.quotes where job_id = (select d from t)), 45, 'the 45 minutes is stored');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and type = 'quote_received' and job_id = (select d from t)), 1::bigint, 'the customer is told at once');

-- 8. A free worker who sends a time anyway: it is ignored -----------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.accept_job((select e from t), 1500, p_busy_eta_minutes => 60) $$, 'a free worker can send one');
select tests.back();
select is((select busy_eta_minutes from public.quotes where job_id = (select e from t)), null::integer, 'but it is not stored');
select is((select busy_eta_pending from public.quotes where job_id = (select e from t)), false, 'and nothing waits');

-- 9. Old claim paths cannot be used to dodge the question -------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.express_interest((select c from t)) $$, 'finish the job you have started before taking another', 'express_interest is refused while busy');
select throws_ok($$ select public.submit_quote((select c from t), 1000) $$, 'finish the job you have started before taking another', 'and submit_quote');
select tests.back();

select * from finish();
rollback;
