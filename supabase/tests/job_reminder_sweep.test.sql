-- The one-hour job reminder sweep (migration 0058) and the suspension rule (migration 20261127100000).
-- A suspended worker gets no push for anything (dues and notices already obey this); a visit reminder is no exception.
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

create function tests.make_job(p_n text) returns uuid
language plpgsql as $$
declare
  v_job uuid;
  v_addr uuid;
begin
  perform tests.act('00000000-0000-0000-0000-0000000000a1');
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, 'Reminder job ' || p_n, 'Needs fixing today',
                                 'asap'::public.job_urgency, null, null, null, null,
                                 array['00000000-0000-0000-0000-0000000000a1/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;

-- A visit one hour from now, accepted by the customer. The worker quoted it earlier, so the rule
-- "a visit booked less than an hour ahead is not reminded" does not block it.
create function tests.book_visit_soon(p_job uuid, p_worker uuid) returns void
language plpgsql as $$
begin
  perform tests.act(p_worker);
  perform public.accept_job(p_job, 3000, p_visit_start => now() + interval '9 days');
  perform tests.back();
  perform tests.act('00000000-0000-0000-0000-0000000000a1');
  perform public.accept_quote((select id from public.resident_quotes where job_id = p_job));
  perform tests.back();
  update public.jobs set scheduled_start = now() + interval '50 minutes', scheduled_end = now() + interval '110 minutes' where id = p_job;
  update public.quotes set decided_at = now() - interval '2 hours' where job_id = p_job and status = 'accepted';
end $$;

-- 1. An active worker with a visit in 50 minutes is reminded once
select tests.book_visit_soon(tests.make_job('1'), '00000000-0000-0000-0000-0000000000b1');
select is((select status::text from public.jobs where title = 'Reminder job 1'), 'scheduled', 'job 1 is scheduled');
select is(private.send_job_reminders(), 1, 'an active worker is reminded');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'job_reminder'), 1::bigint, 'the reminder notice is stored');

-- 2. The same kind of visit for a worker who is suspended: no reminder, no push
select tests.book_visit_soon(tests.make_job('2'), '00000000-0000-0000-0000-0000000000b2');
update public.profiles set account_status = 'suspended', suspended_at = now(), suspension_reason = 'test' where id = '00000000-0000-0000-0000-0000000000b2';
select is(private.send_job_reminders(), 0, 'a suspended worker is not reminded');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b2' and type = 'job_reminder'), 0::bigint, 'no reminder notice for a suspended worker');
select is((select worker_reminded_at from public.jobs where title = 'Reminder job 2'), null::timestamptz, 'the visit stays unreminded, so it is handled if the worker is reinstated');

select * from finish();
rollback;
