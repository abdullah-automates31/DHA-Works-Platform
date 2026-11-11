-- The job lock rule (user, 11 Nov 2026), end to end:
--   posted -> open; a worker quotes -> quoted (nobody else can see or quote it);
--   the customer rejects -> back to open (everyone matching sees it again, the rejected worker does not);
--   the customer accepts -> scheduled and visible only to that worker, for good.
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
  ('00000000-0000-0000-0000-0000000000b3', 'authenticated', 'authenticated', 'w3@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida One', 'res1@test.dev', '03001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman One', 'w1@test.dev', '03003334441', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Bilal Two', 'w2@test.dev', '03003334442', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'worker', 'Kamran Three', 'w3@test.dev', '03003334443', 'approved');
insert into public.worker_details (profile_id) values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2'), ('00000000-0000-0000-0000-0000000000b3');
insert into public.worker_categories (worker_id, category_id) values
  ('00000000-0000-0000-0000-0000000000b1', 1), ('00000000-0000-0000-0000-0000000000b2', 1), ('00000000-0000-0000-0000-0000000000b3', 1);
insert into public.worker_areas (worker_id, phase) values
  ('00000000-0000-0000-0000-0000000000b1', 6), ('00000000-0000-0000-0000-0000000000b2', 6), ('00000000-0000-0000-0000-0000000000b3', 6);

-- ------------------------------------------------------------------ 1. posted: open, every matching worker sees it
select tests.act('00000000-0000-0000-0000-0000000000a1');
create temp table t as select
  public.upsert_address(null, 'Home', 6::smallint, 'Lane 4', '12-C', '2nd', false) as addr;
grant select on t to authenticated;
alter table t add column job uuid;
update t set job = public.save_job_draft(null, 1::smallint, addr, 'Lock flow job', 'Needs fixing today', 'asap', null, null, null, null,
                                         array['00000000-0000-0000-0000-0000000000a1/p1.jpg']);
select public.post_job((select job from t));
select tests.back();

select is((select status::text from public.jobs where id = (select job from t)), 'open', 'a posted job is open');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.worker_feed where id = (select job from t)), 1, 'worker 1 sees the open job');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from public.worker_feed where id = (select job from t)), 1, 'worker 2 sees the open job');
select tests.back();

-- ------------------------------------------------------------------ 2. a worker quotes: quoted, nobody else can see or quote it
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.accept_job((select job from t), 3000, 500, 'pipes')$$, 'worker 1 sends a quote');
select tests.back();
select is((select status::text from public.jobs where id = (select job from t)), 'quoted', 'the job is quoted');

select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from public.worker_feed where id = (select job from t)), 0, 'worker 2 no longer sees the quoted job');
select throws_ok($$select public.accept_job((select job from t), 2500, 0)$$, null, null, 'worker 2 cannot quote it while it is quoted');
select tests.back();
select is((select count(*)::int from public.quotes where job_id = (select job from t)), 1, 'still exactly one quote on the job');

-- ------------------------------------------------------------------ 3. the customer rejects: back to open
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.reject_quote((select id from public.resident_quotes where job_id = (select job from t)), 'too expensive')$$, 'the customer rejects the quote');
select tests.back();
select is((select status::text from public.jobs where id = (select job from t)), 'open', 'the job is open again as soon as the quote is rejected');
select is((select accepted_worker_id from public.jobs where id = (select job from t)), null, 'and is locked to nobody');

select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from public.worker_feed where id = (select job from t)), 1, 'worker 2 sees it again');
select tests.act('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from public.worker_feed where id = (select job from t)), 1, 'worker 3 sees it again');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.worker_feed where id = (select job from t)), 0, 'the worker whose quote was rejected does not see it again');
select throws_ok($$select public.accept_job((select job from t), 2000, 0)$$, null, null, 'and cannot quote it again');
select tests.back();

-- ------------------------------------------------------------------ 4. another worker quotes; the customer accepts: locked
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select public.accept_job((select job from t), 2800, 0)$$, 'worker 2 quotes after the rejection');
select tests.back();
select is((select status::text from public.jobs where id = (select job from t)), 'quoted', 'quoted again');
select tests.act('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from public.worker_feed where id = (select job from t)), 0, 'worker 3 cannot see it while it is quoted');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.accept_quote((select id from public.resident_quotes where job_id = (select job from t) and status = 'sent'))$$, 'the customer accepts worker 2''s quote');
select tests.back();
select is((select status::text from public.jobs where id = (select job from t)), 'scheduled', 'the job is scheduled');
select is((select accepted_worker_id from public.jobs where id = (select job from t)), '00000000-0000-0000-0000-0000000000b2'::uuid, 'locked to worker 2');

-- ------------------------------------------------------------------ 5. locked: visible only to that worker
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from public.worker_jobs where id = (select job from t)), 1, 'worker 2 sees the job in My Jobs');
select tests.act('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from public.worker_feed where id = (select job from t)), 0, 'worker 3 does not see it in the feed');
select is((select count(*)::int from public.worker_jobs where id = (select job from t)), 0, 'nor in My Jobs');
select is((select count(*)::int from public.jobs where id = (select job from t)), 0, 'nor by reading the jobs table directly');
select throws_ok($$select public.accept_job((select job from t), 1500, 0)$$, null, null, 'and cannot quote it');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select resident_name from public.worker_jobs where id = (select job from t)), null, 'rejected worker: no customer name (only a bare Rejected card, title and status)');
select is((select description from public.worker_jobs where id = (select job from t)), null, 'rejected worker: description blank');
select is((select my_quote_status::text from public.worker_jobs where id = (select job from t)), 'rejected', 'rejected worker: sees their quote as rejected');
select is((select count(*)::int from public.jobs where id = (select job from t)), 0, 'nor read it directly');
select tests.back();

select * from finish();
rollback;
