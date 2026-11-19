-- Migration 0064: Settings page v2. Wrong callers first, then the rules, the audit viewer, staff activity, sign-out and status.
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
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin-a@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'admin-b@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin-a@test.dev', '03009990001', 'approved'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'Staff B', 'admin-b@test.dev', '03009990002', 'approved'),
  ('00000000-0000-0000-0000-0000000000c1', 'resident', 'Rida Resident', 'res@test.dev', '03001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Ali Raza', 'w1@test.dev', '03213334444', 'approved');
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2');
insert into public.admin_verified_sessions (session_id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2');

-- 1. Wrong callers ----------------------------------------------------------------------------------------------------
create temp table calls (sql text);
insert into calls values
  ('select public.admin_rules_get()'),
  ('select public.admin_rules_save(''workers'', ''{"top_rated_min_jobs":10,"top_rated_min_rating":4.5}''::jsonb)'),
  ('select public.admin_audit_list(null, null, null, null, 25, 0)'),
  ('select public.admin_staff_activity()'),
  ('select public.admin_signout_other_admins(''SIGN OUT'')'),
  ('select public.admin_system_status()');
grant select on calls to authenticated;
select is((select count(*) from calls), 6::bigint, 'the list covers all 6 new functions');
create function tests.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when sqlstate '42501' then
  return true;
end $$;
grant execute on function tests.refused(text) to authenticated;

select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');
select is((select count(*) from calls c where not tests.refused(c.sql)), 0::bigint, 'a password-only admin session is refused by every function');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000c1');
select is((select count(*) from calls c where not tests.refused(c.sql)), 0::bigint, 'a resident is refused by every function');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from calls c where not tests.refused(c.sql)), 0::bigint, 'a worker is refused by every function');
select tests.back();
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_rules_get', 'admin_rules_save', 'admin_audit_list', 'admin_staff_activity',
                                                          'admin_signout_other_admins', 'admin_system_status')
              and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'anon can run none of them');
select is(has_function_privilege('authenticated', 'private.rule_registry()', 'execute'), false, 'the rule list is private');

-- 2. The rules --------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
create temp table g as select public.admin_rules_get() as j;
grant select on g to authenticated;
select is((select jsonb_array_length(j -> 'jobs') from g), 6, 'six job rules');
select is((select jsonb_array_length(j -> 'workers') from g), 2, 'two worker rules');
select is((select string_agg(e ->> 'key' || '=' || (e ->> 'value'), ',' order by ord) from g, jsonb_array_elements(j -> 'jobs') with ordinality t(e, ord)),
          'job_expiry_hours=24,job_expiry_reminder_hours=20,max_job_photos=6,stuck_scheduled_hours=24,stuck_in_progress_hours=48,stuck_cash_hours=48',
          'the job rules start at the owner decisions (24 h expiry, 20 h reminder)');
select is((select string_agg(e ->> 'key' || '=' || (e ->> 'value'), ',' order by ord) from g, jsonb_array_elements(j -> 'workers') with ordinality t(e, ord)),
          'top_rated_min_jobs=10,top_rated_min_rating=4.5', 'Top rated starts at 10 jobs and 4.5');
select ok((select bool_and(e ->> 'changed_by' is null and e ->> 'changed_at' is null) from g, jsonb_array_elements(j -> 'jobs') e), 'nobody has changed them yet');

-- refusals (nothing is saved)
select throws_ok($$select public.admin_rules_save('nope', '{}'::jsonb)$$, 'P0001', 'unknown settings section', 'unknown section');
select throws_ok($$select public.admin_rules_save('workers', '[]'::jsonb)$$, 'P0001', 'send the settings as one set of values', 'not an object');
select throws_ok($$select public.admin_rules_save('workers', '{"top_rated_min_jobs":10,"top_rated_min_rating":4.5,"extra":1}'::jsonb)$$, 'P0001', 'unknown setting', 'unknown key');
select throws_ok($$select public.admin_rules_save('workers', '{"top_rated_min_jobs":10}'::jsonb)$$, 'P0001', 'send every setting of this section', 'missing key');
select throws_ok($$select public.admin_rules_save('workers', '{"top_rated_min_jobs":"10","top_rated_min_rating":4.5}'::jsonb)$$, 'P0001', 'Completed jobs needed for Top rated must be a number', 'text value');
select throws_ok($$select public.admin_rules_save('workers', '{"top_rated_min_jobs":0,"top_rated_min_rating":4.5}'::jsonb)$$, 'P0001', 'Completed jobs needed for Top rated must be between 1 and 500', 'too low');
select throws_ok($$select public.admin_rules_save('workers', '{"top_rated_min_jobs":10.5,"top_rated_min_rating":4.5}'::jsonb)$$, 'P0001', 'Completed jobs needed for Top rated must be a whole number', 'not whole');
select throws_ok($$select public.admin_rules_save('workers', '{"top_rated_min_jobs":10,"top_rated_min_rating":5.5}'::jsonb)$$, 'P0001', 'Average rating needed for Top rated must be between 1 and 5', 'rating too high');
select throws_ok($$select public.admin_rules_save('workers', '{"top_rated_min_jobs":10,"top_rated_min_rating":4.55}'::jsonb)$$, 'P0001', 'Average rating needed for Top rated can have one decimal at most', 'two decimals');
select throws_ok($$select public.admin_rules_save('jobs', '{"job_expiry_hours":24,"job_expiry_reminder_hours":24,"max_job_photos":6,"stuck_scheduled_hours":24,"stuck_in_progress_hours":48,"stuck_cash_hours":48}'::jsonb)$$,
                 'P0001', 'the reminder must come before the job expires', 'the reminder must be earlier than the expiry');
select throws_ok($$select public.admin_rules_save('jobs', '{"job_expiry_hours":2,"job_expiry_reminder_hours":1,"max_job_photos":6,"stuck_scheduled_hours":24,"stuck_in_progress_hours":48,"stuck_cash_hours":48}'::jsonb)$$,
                 'P0001', 'Open jobs expire after (hours) must be between 6 and 168', 'expiry below 6 hours');
select tests.back();
select is((select count(*) from public.audit_log where action = 'rules_saved'), 0::bigint, 'refusals wrote no audit rows');
select is(private.setting_int('job_expiry_hours', 0), 24, 'and changed nothing');

-- a save
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.admin_rules_save('workers', '{"top_rated_min_jobs":12,"top_rated_min_rating":4.6}'::jsonb) ->> 'changed', '2', 'two values changed');
select is(public.admin_rules_save('workers', '{"top_rated_min_jobs":12,"top_rated_min_rating":4.6}'::jsonb) ->> 'changed', '0', 'saving the same values again changes nothing');
select is(public.admin_rules_save('jobs', '{"job_expiry_hours":48,"job_expiry_reminder_hours":40,"max_job_photos":6,"stuck_scheduled_hours":24,"stuck_in_progress_hours":48,"stuck_cash_hours":48}'::jsonb) ->> 'changed', '2', 'only the two changed job values count');
select tests.back();
select is(private.setting_int('job_expiry_hours', 0), 48, 'the database now uses the new expiry');
select is(private.setting_int('job_expiry_reminder_hours', 0), 40, 'and the new reminder');
select is(private.setting_int('top_rated_min_jobs', 0), 12, 'and the new Top rated job count');
select is((public.get_setting('top_rated_min_rating') #>> '{}')::numeric, 4.6, 'and the new Top rated rating');
select is((select count(*) from public.audit_log where action = 'rules_saved'), 2::bigint, 'two saves are audited, the repeat is not');
select is((select old_data from public.audit_log where action = 'rules_saved' and record_id = 'workers'), '{"top_rated_min_jobs":10,"top_rated_min_rating":4.5}'::jsonb, 'the audit keeps the old values');
select is((select new_data from public.audit_log where action = 'rules_saved' and record_id = 'jobs'), '{"job_expiry_hours":48,"job_expiry_reminder_hours":40}'::jsonb, 'and only the values that changed');
select is((select actor_id::text from public.audit_log where action = 'rules_saved' and record_id = 'jobs'), '00000000-0000-0000-0000-0000000000a1', 'with who did it');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is((select e ->> 'changed_by' from jsonb_array_elements(public.admin_rules_get() -> 'jobs') e where e ->> 'key' = 'job_expiry_hours'), 'Staff A', 'the page can show who changed a rule');
select is((select e ->> 'changed_by' from jsonb_array_elements(public.admin_rules_get() -> 'jobs') e where e ->> 'key' = 'max_job_photos'), null, 'and nothing for one never changed');
select tests.back();

-- 3. The audit viewer -------------------------------------------------------------------------------------------------
insert into public.audit_log (actor_id, action, table_name, record_id, created_at) values
  ('00000000-0000-0000-0000-0000000000a2', 'staff_note_added', 'profiles', 'x', now() - interval '3 days'),
  (null, 'system_thing', 'jobs', 'y', now() - interval '10 days');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
create temp table al as select public.admin_audit_list(null, null, null, null, 25, 0) as j;
grant select on al to authenticated;
select ok((select (j ->> 'total')::int >= 4 from al), 'all rows are counted');
select is((select j -> 'rows' -> 0 ->> 'action' from al) in ('rules_saved'), true, 'newest first');
select ok((select (j -> 'rows' -> -1 ->> 'action') = 'system_thing' from al), 'and the oldest last');
select is((select j -> 'rows' -> -1 ->> 'actor' from al), null, 'an entry with no person shows no name');
select ok((select j -> 'actions' ? 'rules_saved' and j -> 'actions' ? 'staff_note_added' from al), 'the action list for the filter is complete');
select is((select jsonb_array_length(j -> 'admins') from al), 2, 'and so is the admin list');
select is((public.admin_audit_list('00000000-0000-0000-0000-0000000000a2') ->> 'total'), '1', 'filter by admin');
select is((public.admin_audit_list(null, 'rules_saved') ->> 'total'), '2', 'filter by action');
select is((public.admin_audit_list(null, null, (now() at time zone 'Asia/Karachi')::date, (now() at time zone 'Asia/Karachi')::date) ->> 'total')::int >= 2, true, 'filter by date: today');
select is((public.admin_audit_list(null, null, ((now() at time zone 'Asia/Karachi')::date + 1)) ->> 'total'), '0', 'filter by date: from tomorrow');
select is((public.admin_audit_list(null, null, null, ((now() at time zone 'Asia/Karachi')::date - 5)) ->> 'total'), '1', 'filter by date: up to five days ago');
select is(jsonb_array_length(public.admin_audit_list(null, null, null, null, 1, 0) -> 'rows'), 1, 'paging: one row');
select is(jsonb_array_length(public.admin_audit_list(null, null, null, null, 0, 0) -> 'rows'), 1, 'a limit of 0 is raised to 1');
select is(jsonb_array_length(public.admin_audit_list(null, null, null, null, 1000, 0) -> 'rows') <= 50, true, 'a huge limit is capped at 50');
select is((public.admin_audit_list(null, null, null, null, 1, 1) -> 'rows' -> 0 ->> 'id') <> (public.admin_audit_list(null, null, null, null, 1, 0) -> 'rows' -> 0 ->> 'id'), true, 'paging: the second page is a different row');
select tests.back();

-- 4. Staff activity -----------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
create temp table sa as select public.admin_staff_activity() as j;
grant select on sa to authenticated;
select is((select jsonb_array_length(j) from sa), 2, 'both admins are listed (and nobody else)');
select is((select (e ->> 'active_sessions')::int from sa, jsonb_array_elements(j) e where e ->> 'id' = '00000000-0000-0000-0000-0000000000a1'), 2, 'Staff A has two sessions');
select is((select (e ->> 'active_sessions')::int from sa, jsonb_array_elements(j) e where e ->> 'id' = '00000000-0000-0000-0000-0000000000a2'), 1, 'Staff B has one');
select tests.back();

-- 5. Sign out the other admin sessions ----------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select throws_ok($$select public.admin_signout_other_admins('sign out')$$, 'P0001', 'type SIGN OUT to confirm', 'the words must match exactly');
select throws_ok($$select public.admin_signout_other_admins(null)$$, 'P0001', 'type SIGN OUT to confirm', 'and cannot be empty');
select tests.back();
select is((select count(*) from auth.sessions), 3::bigint, 'nothing was ended by the refusals');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.admin_signout_other_admins('SIGN OUT') ->> 'ended', '2', 'two other sessions ended');
select is(public.admin_system_status() ->> 'active_admins', '2', 'the caller is still signed in and verified');
select tests.back();
select is((select array_agg(id::text order by id::text) from auth.sessions), array['00000000-0000-0000-0000-00000000a101'], 'only this session is left');
select is((select count(*) from public.admin_verified_sessions), 1::bigint, 'the other verified sessions are gone too');
select tests.act('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000a201');
select throws_ok($$select public.admin_rules_get()$$, '42501', 'not available', 'the other admin is refused right away');
select tests.back();
select is((select new_data ->> 'sessions_ended' from public.audit_log where action = 'admins_signed_out'), '2', 'the sign-out is audited with the number of sessions');
select is((select actor_id::text from public.audit_log where action = 'admins_signed_out'), '00000000-0000-0000-0000-0000000000a1', 'and who did it');

-- 6. System status ------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
create temp table ss as select public.admin_system_status() as j;
grant select on ss to authenticated;
select ok((select (j ->> 'database_bytes')::bigint > 0 from ss), 'the database size is reported');
select is((select jsonb_typeof(j -> 'storage') from ss), 'array', 'storage use is a list of buckets');
select is((select jsonb_typeof(j -> 'push') from ss), 'object', 'the push backlog is reported');
select is((select j ->> 'active_admins' from ss), '2', 'two active admins');
select ok((select jsonb_typeof(j -> 'cron') in ('array', 'null') from ss), 'the scheduled jobs are listed, or null when the scheduler cannot be read');
select ok((select position('SUPABASE' in upper(j::text)) = 0 and position('secret' in lower(j::text)) = 0 and position('service_role' in lower(j::text)) = 0 from ss), 'no key or secret appears in the status');
select tests.back();

select * from finish();
rollback;
