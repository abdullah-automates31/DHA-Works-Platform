-- Migrations 0031 + 0043: accept_job (claim-and-lock). A worker claims an open job with a price; the job is quoted and
-- locked to them, and is scheduled only when the customer accepts the quote (0043).
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
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev'),
  ('00000000-0000-0000-0000-0000000000b3', 'authenticated', 'authenticated', 'w3@test.dev'),
  ('00000000-0000-0000-0000-0000000000b4', 'authenticated', 'authenticated', 'w4@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida One', 'res1@test.dev', '03001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman One', 'w1@test.dev', '03003334444', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Bilal Two', 'w2@test.dev', '03005556666', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'worker', 'Wrong Trade', 'w3@test.dev', '03007778888', 'approved'),
  ('00000000-0000-0000-0000-0000000000b4', 'worker', 'Not Approved', 'w4@test.dev', '03009990000', 'incomplete');
insert into public.worker_details (profile_id) values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000b3'), ('00000000-0000-0000-0000-0000000000b4');
insert into public.worker_categories (worker_id, category_id) values
  ('00000000-0000-0000-0000-0000000000b1', 1), ('00000000-0000-0000-0000-0000000000b2', 1),
  ('00000000-0000-0000-0000-0000000000b3', 2), ('00000000-0000-0000-0000-0000000000b4', 1);
insert into public.worker_areas (worker_id, phase) select id, 6 from public.profiles where role = 'worker' and id::text like '00000000-0000-0000-0000-%';

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

create temp table t as
select tests.make_job('Job A', '1') as a, tests.make_job('Job B', '2') as b, tests.make_job('Job C', '3') as c;
grant select on t to authenticated;

-- ---------------------------------------------------------------- happy path
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.accept_job((select a from t), 3000, 500, 'pipes') $$, 'an approved matching worker can accept an open job');
select tests.back();

select is((select status::text from public.jobs where id = (select a from t)), 'quoted', 'the job is quoted, waiting for the customer');
select is((select accepted_worker_id from public.jobs where id = (select a from t)), null::uuid, 'no accepted worker before the customer accepts');
select is((select count(*)::int from public.quotes where job_id = (select a from t) and status = 'sent'), 1, 'one sent quote exists');
select is((select total from public.quotes where job_id = (select a from t)), 3500, 'quote total = labour + materials');
select is((select count(*)::int from public.cash_records where job_id = (select a from t)), 0, 'no cash amount before the customer accepts');
select is((select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and type = 'quote_received' and job_id = (select a from t)), 1, 'the resident is told a quote arrived');
select is((select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and type = 'job_accepted' and job_id = (select a from t)), 0, 'the resident is not told the job was accepted');

-- before the customer accepts, the worker sees their quote but not the resident
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select my_quote_status::text from public.worker_jobs where id = (select a from t)), 'sent', 'worker_jobs shows the sent quote');
select is((select resident_name from public.worker_jobs where id = (select a from t)), null, 'resident details stay hidden before the customer accepts');
select tests.back();

-- the customer sees it and accepts
select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select status::text from public.resident_quotes where job_id = (select a from t)), 'sent', 'resident_quotes shows the open quote');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select a from t))) $$, 'the customer accepts the quote');
select tests.back();
select is((select status::text from public.jobs where id = (select a from t)), 'scheduled', 'accepting schedules the job');
select is((select accepted_worker_id from public.jobs where id = (select a from t)), '00000000-0000-0000-0000-0000000000b1'::uuid, 'it is locked to the worker');
select is((select agreed_amount from public.cash_records where job_id = (select a from t)), 3500, 'agreed amount = labour + materials');
select is((select accepted_quote_id from public.jobs where id = (select a from t)), (select id from public.quotes where job_id = (select a from t) and status = 'accepted'), 'accepted_quote_id points at the quote');
select is((select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'quote_accepted' and job_id = (select a from t)), 1, 'the worker is told');

select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select is_mine from public.worker_jobs where id = (select a from t)), true, 'worker_jobs shows it as mine');
select is((select resident_name from public.worker_jobs where id = (select a from t)), 'Rida One', 'resident details unlock after the customer accepts');
select tests.back();

-- ---------------------------------------------------------------- second worker loses
create temp table tq as select tests.make_job('Job Q', '6') as q;
grant select on tq to authenticated;
select tests.act('00000000-0000-0000-0000-0000000000b1');
select public.accept_job((select q from tq), 1200);
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.accept_job((select q from tq), 100) $$, 'this job is not available', 'a second worker cannot claim a quoted job');
select is((select count(*)::int from public.worker_feed where id = (select q from tq)), 0, 'a quoted job leaves the feed');
select throws_ok($$ select public.accept_job((select a from t), 100) $$, 'this job is not available', 'a second worker cannot take a scheduled job');
select is((select count(*)::int from public.worker_feed where id = (select a from t)), 0, 'a scheduled job is not in the feed');
select tests.back();

-- the customer replaces the worker before accepting (reject_quote): the job reopens and that worker is excluded
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.reject_quote((select id from public.quotes where job_id = (select q from tq)), 'too expensive') $$, 'the customer can replace a quoting worker');
select tests.back();
select is((select status::text from public.jobs where id = (select q from tq)), 'open', 'the job reopens');
select is((select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'quote_rejected' and job_id = (select q from tq)), 1, 'the replaced worker is told');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.accept_job((select q from tq), 100) $$, 'the resident did not accept your quote on this job', 'the replaced worker cannot claim it again');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.accept_job((select q from tq), 1100) $$, 'another worker can claim the reopened job');
select tests.back();

-- the customer cancels a quoted job: it closes
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.cancel_job((select q from tq), 'changed my mind') $$, 'the customer can cancel a quoted job');
select tests.back();
select is((select status::text from public.jobs where id = (select q from tq)), 'cancelled', 'the job is cancelled');
select is((select status::text from public.quotes where job_id = (select q from tq) and worker_id = '00000000-0000-0000-0000-0000000000b2'), 'expired', 'the open quote is closed');

-- ---------------------------------------------------------------- who may not accept
select tests.act('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select public.accept_job((select b from t), 100) $$, 'this job is not available', 'a worker of another trade cannot accept');
select tests.act('00000000-0000-0000-0000-0000000000b4');
select throws_ok($$ select public.accept_job((select b from t), 100) $$, 'your account is not approved yet', 'an unapproved worker cannot accept');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.accept_job((select b from t), 100) $$, 'this action is not available for your account type', 'a resident cannot call accept_job');
select tests.back();
set local role anon;
select throws_ok($$ select public.accept_job((select b from t), 100) $$, '42501', null, 'anon cannot call accept_job');
reset role;

select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.accept_job((select b from t), 0, 0) $$, 'enter a price', 'a zero price is refused');
select throws_ok($$ select public.accept_job((select b from t), -5, 100) $$, 'amounts cannot be negative', 'a negative price is refused');
select throws_ok($$ select public.accept_job(gen_random_uuid(), 100) $$, 'this job is not available', 'an unknown job is refused');
select tests.back();

update public.jobs set posted_at = now() - interval '30 hours' where id = (select c from t);
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.accept_job((select c from t), 100) $$, 'this job has expired', 'an expired job cannot be accepted');
select tests.back();

-- ---------------------------------------------------------------- the material bill rule still applies
select tests.act('00000000-0000-0000-0000-0000000000b1');
select public.start_job((select a from t));
select throws_ok($$ select public.complete_job((select a from t), null) $$, 'upload the material bill', 'materials above 0 still need the bill at completion');
select tests.back();

-- ---------------------------------------------------------------- replace worker, then someone else accepts
create temp table t2 as select tests.make_job('Job D', '4') as d;
grant select on t2 to authenticated;
select tests.act('00000000-0000-0000-0000-0000000000b1');
select public.accept_job((select d from t2), 2000);
select tests.act('00000000-0000-0000-0000-0000000000a1');
select public.accept_quote((select id from public.resident_quotes where job_id = (select d from t2)));
select public.replace_worker((select d from t2), 'too expensive');
select tests.back();
select is((select status::text from public.jobs where id = (select d from t2)), 'open', 'replace_worker reopens the job');
select is((select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'quote_rejected' and job_id = (select d from t2)), 1, 'the replaced worker is told');

select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.accept_job((select d from t2), 100) $$, 'the resident did not accept your quote on this job', 'the replaced worker cannot take it again');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$ select public.accept_job((select d from t2), 2500) $$, 'another worker can take the reopened job');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.accept_quote((select id from public.resident_quotes where job_id = (select d from t2) and status = 'sent')) $$, 'the customer accepts the new worker (the old cash row does not block it)');
select tests.back();
select is((select agreed_amount from public.cash_records where job_id = (select d from t2)), 2500, 'agreed amount follows the new worker (stale cash row replaced)');
select is((select accepted_worker_id from public.jobs where id = (select d from t2)), '00000000-0000-0000-0000-0000000000b2'::uuid, 'locked to the new worker');

-- ---------------------------------------------------------------- an old-style sent quote also locks the job
create temp table t3 as select tests.make_job('Job E', '5') as e;
grant select on t3 to authenticated;
select tests.act('00000000-0000-0000-0000-0000000000b2');
select public.express_interest((select e from t3));
select public.submit_quote((select e from t3), 1500);
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.accept_job((select e from t3), 1800) $$, 'this job is not available', 'a job with a sent quote cannot be claimed');
select tests.back();
select is((select status::text from public.quotes where job_id = (select e from t3) and worker_id = '00000000-0000-0000-0000-0000000000b2'), 'sent', 'the earlier quote is untouched');

select * from finish();
rollback;
