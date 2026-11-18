-- Migrations 0040 and 0063: admin_dashboard(p_range). Wrong callers first, then the numbers on a small known data set.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act(p_uid uuid, p_session uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', coalesce(p_session, p_uid))::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
grant execute on function tests.act(uuid, uuid), tests.back() to authenticated;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev'),
  ('00000000-0000-0000-0000-0000000000b3', 'authenticated', 'authenticated', 'w3@test.dev'),
  ('00000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'res2@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status, verification_updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin@test.dev', '03009990001', 'approved', null),
  ('00000000-0000-0000-0000-0000000000c1', 'resident', 'Rida Resident', 'res@test.dev', '03001110001', 'approved', null),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Ali Raza', 'w1@test.dev', '03213334444', 'approved', null),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Imran Waiting', 'w2@test.dev', '03005556666', 'pending', now() - interval '20 hours'),
  ('00000000-0000-0000-0000-0000000000b3', 'worker', 'Zubair Waiting', 'w3@test.dev', '03339990005', 'pending', now() - interval '5 hours'),
  ('00000000-0000-0000-0000-0000000000c2', 'resident', 'Maryam Waiting', 'res2@test.dev', '03001110002', 'pending', now() - interval '9 hours');
insert into public.worker_details (profile_id) values ('00000000-0000-0000-0000-0000000000b1');
insert into public.worker_categories (worker_id, category_id) values ('00000000-0000-0000-0000-0000000000b1', 1);
insert into public.worker_areas (worker_id, phase) values ('00000000-0000-0000-0000-0000000000b1', 6);
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1');
insert into public.admin_verified_sessions (session_id, user_id) values ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1');

create function tests.make_job(p_title text, p_n text) returns uuid language plpgsql as $$
declare v_job uuid; v_addr uuid;
begin
  perform tests.act('00000000-0000-0000-0000-0000000000c1');
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing today', 'asap', null, null, null, null,
                                 array['00000000-0000-0000-0000-0000000000c1/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;
create temp table t as select
  tests.make_job('Open job', '1') as j_open, tests.make_job('Scheduled job', '2') as j_sched, tests.make_job('Progress job', '3') as j_prog,
  tests.make_job('Cash job', '4') as j_cash, tests.make_job('Stuck job', '5') as j_stuck, tests.make_job('Old job', '6') as j_old;
grant select on t to authenticated;

-- 1. Wrong callers ------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');   -- admin, password only
select throws_ok($$select public.admin_dashboard()$$, '42501', 'not available', 'a password-only admin session is refused');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select public.admin_dashboard()$$, '42501', 'not available', 'a resident is refused');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.admin_dashboard()$$, '42501', 'not available', 'a worker is refused');
select tests.back();
select is(has_function_privilege('anon', 'public.admin_dashboard(text)', 'execute'), false, 'anon cannot run it');
select is((select count(*) from pg_proc where proname = 'admin_dashboard'), 1::bigint, 'only the new version exists (the old one without a period is gone)');

-- 2. Put the jobs in different stages (as the database owner; the stage rules are tested elsewhere) -----------------------
update public.jobs set status = 'scheduled' where id = (select j_sched from t);
update public.jobs set status = 'in_progress' where id = (select j_prog from t);
update public.jobs set status = 'cash_collected' where id = (select j_cash from t);
update public.jobs set status = 'in_progress', stuck_since = now() - interval '30 hours', stuck_reason = 'no update from worker' where id = (select j_stuck from t);
update public.jobs set status = 'disputed', posted_at = now() - interval '3 days' where id = (select j_old from t);
insert into public.reports (job_id, reporter_id, against_id, reporter_role, kind) values
  ((select j_prog from t), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'worker', 'unsafe'),
  ((select j_cash from t), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'resident', 'poor_work'),
  ((select j_old from t), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'resident', 'no_show');
update public.reports set status = 'resolved', action = 'no_action', resolved_at = now() where kind = 'no_show';
insert into public.cancellation_requests (job_id, requester_id, requester_role, reason_code) values
  ((select j_sched from t), '00000000-0000-0000-0000-0000000000c1', 'resident', 'schedule_conflict');

-- 3. The numbers --------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
create temp table d as select public.admin_dashboard() as j;
grant select on d to authenticated;
select is((select j -> 'workers_pending' ->> 'count' from d), '2', 'two workers are waiting');
select ok((select (j -> 'workers_pending' ->> 'oldest_since')::timestamptz from d) < now() - interval '19 hours', 'the oldest waiting worker is the 20-hour one');
select is((select j -> 'residents_pending' ->> 'count' from d), '1', 'one resident is waiting');
select is((select j -> 'reports_open' ->> 'count' from d), '2', 'two reports are open (the resolved one is not counted)');
select is((select j -> 'reports_open' ->> 'unsafe' from d), '1', 'one of them is unsafe');
select is((select j -> 'jobs_today' ->> 'count' from d), '5', 'five jobs were posted today (the 3-day-old one is not)');
select is((select j -> 'jobs_today' ->> 'in_progress' from d), '2', 'two jobs are in progress now');
select is((select j -> 'stages' from d), '{"open":1,"scheduled":1,"in_progress":2,"completed":0,"cash_collected":1,"disputed":1,"cancelled":0,"expired":0}'::jsonb, 'jobs by stage');
select is((select jsonb_array_length(j -> 'attention') from d), 7, 'needs attention: 2 reports + 3 applications + 1 cancellation + 1 stuck job');
select is((select j -> 'attention' -> 0 ->> 'kind' from d), 'unsafe', 'the unsafe report is first');
select is((select j -> 'attention' -> 1 ->> 'priority' from d), 'high', 'then the poor-work report (high priority)');
select is((select j -> 'attention' -> 2 ->> 'kind' from d), 'stuck', 'then the oldest normal item: the job stuck for 30 hours');
select is((select j -> 'attention' -> 3 ->> 'kind' from d), 'cancellation', 'then the cancellation request');
select is((select j -> 'attention' -> 4 ->> 'kind' from d), 'worker', 'applications come last, the worker waiting 20 hours first');
select is((select j -> 'attention' -> 4 ->> 'title' from d), 'Imran Waiting is waiting for review', 'with the name');
select ok((select bool_and(e ->> 'ref' is not null and e ->> 'status' is not null and e ->> 'person' is not null and e ->> 'priority' in ('urgent', 'high', 'normal', 'low')) from d, jsonb_array_elements(j -> 'attention') e), 'every item has a reference, a status, a person and a priority');
select is((select j ->> 'attention_total' from d), '7', 'the total of items needing attention');
select ok((select bool_and(e ->> 'id' is not null and e ->> 'title' is not null and e ->> 'since' is not null) from d, jsonb_array_elements(j -> 'attention') e), 'every item has an id, a title and a time');
select is((select count(*) from d, jsonb_array_elements(j -> 'attention') e where e ->> 'kind' = 'stuck'), 1::bigint, 'the stuck job is listed');
select is((select count(*) from d, jsonb_array_elements(j -> 'attention') e where e ->> 'kind' = 'cancellation'), 1::bigint, 'the cancellation request is listed');
select ok((select position('0300' in j::text) = 0 and position('1111' in j::text) = 0 from d), 'no phone number or CNIC leaks into the summary');

-- The list is capped at 10 ------------------------------------------------------------------------------------------------
select tests.back();
insert into auth.users (id, aud, role, email) select ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'authenticated', 'authenticated', 'bulk' || g || '@test.dev' from generate_series(1, 15) g;
insert into public.profiles (id, role, full_name, email, phone, verification_status, verification_updated_at)
select ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'resident', 'Bulk ' || g, 'bulk' || g || '@test.dev', '0310000' || lpad(g::text, 4, '0'), 'pending', now() - (g || ' minutes')::interval from generate_series(1, 15) g;
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(jsonb_array_length(public.admin_dashboard() -> 'attention'), 15, 'at most fifteen items are listed however many are waiting');
select is(public.admin_dashboard() ->> 'attention_total', '22', 'the total still counts all 22');
select is((public.admin_dashboard() -> 'residents_pending' ->> 'count'), '16', 'but the count still shows all 16 waiting residents');
select tests.back();

-- 4. The period (0063) -------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select throws_ok($$select public.admin_dashboard('1y')$$, '22023', 'unknown period', 'an unknown period is refused');
select is(public.admin_dashboard('today') ->> 'range', 'today', 'the period is echoed back');
select tests.back();
-- one resident registered three days ago
update public.profiles set created_at = now() - interval '3 days' where id = '00000000-0000-0000-0000-0000000000c2';
update public.reports set resolved_at = now() + interval '1 second' where kind = 'no_show';  -- newest event (all else shares now() in this transaction)
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
create temp table p as select public.admin_dashboard('today') as td, public.admin_dashboard('7d') as wk, public.admin_dashboard('90d') as q;
grant select on p to authenticated;
select is((select td -> 'period' ->> 'jobs_posted' from p), '5', 'today: five jobs posted (the 3-day-old one is not)');
select is((select wk -> 'period' ->> 'jobs_posted' from p), '6', 'last 7 days: all six');
select ok((select (wk -> 'period' ->> 'residents_registered')::int = (td -> 'period' ->> 'residents_registered')::int + 1 from p), 'last 7 days also counts the resident from 3 days ago');
select is((select td -> 'period' ->> 'workers_registered' from p), '3', 'three workers registered today');
select is((select td -> 'period' ->> 'reports_filed' from p), '3', 'three reports filed');
select is((select td -> 'period' ->> 'reports_resolved' from p), '1', 'one resolved');
select is((select td -> 'period' ->> 'jobs_completed' from p), '0', 'none completed');
select is((select td -> 'workers_pending' from p), (select q -> 'workers_pending' from p), 'the period never changes the waiting counts');
select is((select td -> 'stages' from p), (select q -> 'stages' from p), 'or the stages');
select is((select td -> 'attention' from p), (select q -> 'attention' from p), 'or the attention list');

-- 5. Recent activity ------------------------------------------------------------------------------------------------------
select ok((select jsonb_array_length(td -> 'activity') between 1 and 20 from p), 'activity is listed, at most 20');
select ok((select bool_and(e ->> 'kind' in ('registered', 'verified', 'job', 'cancellation', 'report', 'account')
                           and e ->> 'text' is not null and e ->> 'ref' is not null and e ->> 'link_id' is not null and e ->> 'at' is not null)
             from p, jsonb_array_elements(td -> 'activity') e), 'every activity item has a kind, text, reference, link and time');
select ok((select coalesce(bool_and(a.at >= b.at), true)
             from p,
                  lateral (select (x.e ->> 'at')::timestamptz as at, x.n from jsonb_array_elements(p.td -> 'activity') with ordinality x(e, n)) a
                  join lateral (select (y.e ->> 'at')::timestamptz as at, y.n from jsonb_array_elements(p.td -> 'activity') with ordinality y(e, n)) b on b.n = a.n + 1),
          'newest first');
select ok((select count(*) from p, jsonb_array_elements(q -> 'activity') e where e ->> 'text' = 'Job posted') > 0, 'job posted events are included');
select ok((select count(*) from p, jsonb_array_elements(q -> 'activity') e where e ->> 'text' like 'Report resolved%') = 1, 'the resolved report is included');
select ok((select position('0300' in td::text) = 0 and position('0321' in td::text) = 0 and position('0310' in td::text) = 0 from p), 'no phone number in the period view either');
select tests.back();

-- 6. Suspended worker who still has a job -----------------------------------------------------------------------------
update public.jobs set accepted_worker_id = '00000000-0000-0000-0000-0000000000b1' where id = (select j_sched from t);
update public.profiles set account_status = 'suspended', suspended_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.audit_log (actor_id, action, table_name, record_id, reason)
values ('00000000-0000-0000-0000-0000000000a1', 'account_suspended', 'profiles', '00000000-0000-0000-0000-0000000000b1', 'test');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is((select count(*) from jsonb_array_elements(public.admin_dashboard() -> 'attention') e
            where e ->> 'kind' = 'suspended_active' and e ->> 'id' = (select j_sched from t)::text and e ->> 'priority' = 'high'),
          1::bigint, 'a suspended worker with a scheduled job is listed with high priority');
select ok((select count(*) from jsonb_array_elements(public.admin_dashboard() -> 'activity') e
            where e ->> 'kind' = 'account' and e ->> 'text' = 'Worker suspended' and e ->> 'ref' = 'Ali Raza') = 1, 'the suspension shows in the activity');

-- 7. Jobs list stage filter (0063) ------------------------------------------------------------------------------------
select is((public.admin_jobs_list(null, null, null, false, null, 25, 0, 'open') ->> 'total'), '1', 'stage open');
select is((public.admin_jobs_list(null, null, null, false, null, 25, 0, 'scheduled') ->> 'total'), '1', 'stage scheduled');
select tests.back();
update public.jobs set status = 'reviewed' where id = (select j_cash from t);
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is((public.admin_jobs_list(null, null, null, false, null, 25, 0, 'cash_collected') ->> 'total'), '1', 'stage cash collected includes a reviewed job');
select is((public.admin_dashboard() -> 'stages' ->> 'cash_collected'), '1', 'the same number as the dashboard stage');
select is((public.admin_jobs_list('cash_collected', null, null, false, null, 25, 0) ->> 'total'), '0', 'the exact status filter is unchanged');
select throws_ok($$select public.admin_jobs_list(null, null, null, false, null, 25, 0, 'nonsense')$$, '22023', 'unknown stage', 'an unknown stage is refused');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select public.admin_jobs_list(null, null, null, false, null, 25, 0, 'open')$$, '42501', 'not available', 'a resident cannot use the stage filter');
select tests.back();
select is(has_function_privilege('anon', 'public.admin_jobs_list(public.job_status, smallint, smallint, boolean, text, integer, integer, text)', 'execute'), false, 'anon cannot run the jobs list');

select * from finish();
rollback;
