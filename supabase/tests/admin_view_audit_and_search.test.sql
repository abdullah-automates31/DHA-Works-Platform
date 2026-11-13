-- Migration 0050: detail views are audited once per person, record and 10 minutes; jobs search uses trigram indexes.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act(p_uid uuid, p_session uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_session)::text, true);
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
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'admin2@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status, account_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin@test.dev', '03009990001', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'Staff B', 'admin2@test.dev', '03009990002', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman', 'w@test.dev', '03003334444', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Bilal', 'w2@test.dev', '03003335555', 'approved', 'active');
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2');
insert into public.admin_verified_sessions (session_id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2');

-- 1. A view is written once, however often the page is reloaded ------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select lives_ok($$select public.admin_user_detail('00000000-0000-0000-0000-0000000000b1')$$, 'staff A opens a profile');
select lives_ok($$select public.admin_user_detail('00000000-0000-0000-0000-0000000000b1')$$, 'and reloads it');
select lives_ok($$select public.admin_user_detail('00000000-0000-0000-0000-0000000000b1')$$, 'and again');
select lives_ok($$select public.admin_verification_detail('00000000-0000-0000-0000-0000000000b1')$$, 'staff A opens the verification screen');
select lives_ok($$select public.admin_verification_detail('00000000-0000-0000-0000-0000000000b1')$$, 'and reloads it');
select tests.back();
select is((select count(*)::int from public.audit_log where action = 'user_viewed' and record_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'three profile views leave one audit row');
select is((select count(*)::int from public.audit_log where action = 'verification_viewed' and record_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'two verification views leave one audit row');

-- 2. A different record, or a different person, is still recorded ----------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select lives_ok($$select public.admin_user_detail('00000000-0000-0000-0000-0000000000b2')$$, 'staff A opens another profile');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000a201');
select lives_ok($$select public.admin_user_detail('00000000-0000-0000-0000-0000000000b1')$$, 'staff B opens the first profile');
select tests.back();
select is((select count(*)::int from public.audit_log where action = 'user_viewed'), 3, 'another profile and another person each get their own row');
select is((select count(distinct actor_id)::int from public.audit_log where action = 'user_viewed' and record_id = '00000000-0000-0000-0000-0000000000b1'), 2, 'both staff members are on record for the first profile');

-- 3. After 10 minutes a new view is recorded again -------------------------------------------------------------
-- The log is append only; this test run ages its own rows by switching the protection trigger off for one statement.
set local session_replication_role = replica;
update public.audit_log set created_at = now() - interval '11 minutes' where action = 'user_viewed';
set local session_replication_role = origin;
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select lives_ok($$select public.admin_user_detail('00000000-0000-0000-0000-0000000000b1')$$, 'staff A opens the profile 11 minutes later');
select tests.back();
select is((select count(*)::int from public.audit_log where action = 'user_viewed' and actor_id = '00000000-0000-0000-0000-0000000000a1' and record_id = '00000000-0000-0000-0000-0000000000b1'), 2, 'a view after the window is recorded again');

-- 4. The detail screens still refuse a worker --------------------------------------------------------------
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-0000000000b1');
select tests.act('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000b101');
select throws_ok($$select public.admin_user_detail('00000000-0000-0000-0000-0000000000b2')$$, '42501', 'not available', 'a worker cannot open a staff detail screen');
select tests.back();

-- 5. The jobs search can use trigram indexes ---------------------------------------------------------------
select has_index('public', 'jobs', 'jobs_code_trgm_idx', 'jobs.code has a trigram index');
select has_index('public', 'jobs', 'jobs_title_trgm_idx', 'jobs.title has a trigram index');
select has_index('public', 'profiles', 'profiles_full_name_trgm_idx', 'profiles.full_name has a trigram index');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.admin_jobs_list(null, null, null, false, 'nothing matches this', 25, 0) ->> 'total', '0', 'a search with no match returns nothing');
select tests.back();
select is(has_function_privilege('anon', 'public.admin_jobs_list(public.job_status, smallint, smallint, boolean, text, integer, integer)', 'execute'), false, 'anon still cannot search jobs');

select * from finish();
rollback;
