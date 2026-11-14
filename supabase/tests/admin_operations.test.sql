-- Migrations 0041 and 0042: admin reports, jobs, cancellations, helpline, users, reviews, settings, staff.
-- Wrong callers first (password-only admin, resident, worker, anon), then the rules on a small known data set.
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
-- true when the statement is refused with the admin "not available" error
create function tests.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = '42501' and sqlerrm = 'not available';
end $$;
-- runs a query as the database owner (a test helper; the portal never has this): notifications and the helpline table are not readable by staff directly
create function tests.scalar(p_sql text) returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin execute p_sql into v; return v; end $$;
grant execute on function tests.act(uuid, uuid), tests.back(), tests.refused(text), tests.scalar(text) to authenticated;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'admin2@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'res2@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev');
insert into public.profiles (id, role, full_name, email, phone, cnic, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin@test.dev', '03009990001', null, 'approved'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'Staff B', 'admin2@test.dev', '03009990002', null, 'approved'),
  ('00000000-0000-0000-0000-0000000000c1', 'resident', 'Rida Resident', 'res@test.dev', '03001110001', '42101-1111111-1', 'approved'),
  ('00000000-0000-0000-0000-0000000000c2', 'resident', 'Sara Second', 'res2@test.dev', '03001110002', '42101-2222222-2', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Ali Raza', 'w1@test.dev', '03213334444', '42101-3333333-3', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Bilal Khan', 'w2@test.dev', '03215556666', '42101-4444444-4', 'approved');
insert into public.worker_details (profile_id, experience_years, about) values
  ('00000000-0000-0000-0000-0000000000b1', 8, 'Plumber for eight years'),
  ('00000000-0000-0000-0000-0000000000b2', 3, 'Electrician');
insert into public.worker_categories (worker_id, category_id) values
  ('00000000-0000-0000-0000-0000000000b1', 1), ('00000000-0000-0000-0000-0000000000b2', 2);
insert into public.worker_areas (worker_id, phase) values
  ('00000000-0000-0000-0000-0000000000b1', 6), ('00000000-0000-0000-0000-0000000000b1', 7), ('00000000-0000-0000-0000-0000000000b2', 5);
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2');
insert into public.admin_verified_sessions (session_id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2');

create function tests.make_job(p_title text, p_n text, p_resident uuid default '00000000-0000-0000-0000-0000000000c1') returns uuid language plpgsql as $$
declare v_job uuid; v_addr uuid;
begin
  perform tests.act(p_resident);
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing today', 'asap', null, null, null, null,
                                 array[p_resident::text || '/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;
-- gives a job an accepted quote and a status (as the database owner; the lifecycle itself is tested elsewhere)
create function tests.accept(p_job uuid, p_worker uuid, p_status public.job_status, p_total integer default 3000) returns void language plpgsql as $$
declare v_q uuid;
begin
  insert into public.quotes (job_id, worker_id, labour, materials, visit_start, visit_end, status, decided_at)
  values (p_job, p_worker, p_total - 500, 500, now() + interval '1 day', now() + interval '1 day 2 hours', 'accepted', now())
  returning id into v_q;
  update public.jobs set accepted_quote_id = v_q, accepted_worker_id = p_worker, status = p_status,
         scheduled_start = now() + interval '1 day', scheduled_end = now() + interval '1 day 2 hours',
         started_at = case when p_status in ('in_progress', 'completed', 'cash_collected') then now() - interval '1 hour' end
   where id = p_job;
  insert into public.cash_records (job_id, agreed_amount) values (p_job, p_total);
end $$;

create temp table t as select
  tests.make_job('Open job', '1') as j_open, tests.make_job('Scheduled job', '2') as j_sched, tests.make_job('Progress job', '3') as j_prog,
  tests.make_job('Cash job', '4') as j_cash, tests.make_job('Decline job', '5') as j_decl, tests.make_job('Approve job', '6') as j_appr,
  tests.make_job('Replace job', '7') as j_repl, tests.make_job('Suspended worker job', '8') as j_susp,
  tests.make_job('Second resident job', '9', '00000000-0000-0000-0000-0000000000c2') as j_other;
grant select on t to authenticated;
select tests.accept((select j_sched from t), '00000000-0000-0000-0000-0000000000b1', 'scheduled');
select tests.accept((select j_prog from t), '00000000-0000-0000-0000-0000000000b1', 'in_progress', 3200);
select tests.accept((select j_cash from t), '00000000-0000-0000-0000-0000000000b1', 'cash_collected', 1800);
select tests.accept((select j_decl from t), '00000000-0000-0000-0000-0000000000b1', 'scheduled');
select tests.accept((select j_appr from t), '00000000-0000-0000-0000-0000000000b1', 'scheduled');
select tests.accept((select j_repl from t), '00000000-0000-0000-0000-0000000000b1', 'scheduled');
select tests.accept((select j_susp from t), '00000000-0000-0000-0000-0000000000b2', 'in_progress');
update public.cash_records set worker_amount = 1800, worker_recorded_at = now(), resident_amount = 1800, resident_confirmed_at = now(), matched = true, quote_difference = 0
 where job_id = (select j_cash from t);

-- 1. Wrong callers: every function refuses a password-only admin, a resident, a worker and anon ---------------------------
create temp table calls (sql text);
insert into calls values
  ('select public.admin_reports_counts()'),
  ('select public.admin_reports_list(''open'', null, null, 25, 0)'),
  ('select public.admin_report_detail(gen_random_uuid())'),
  ('select public.admin_report_decide(gen_random_uuid(), ''close'', ''reason'')'),
  ('select public.admin_report_add_note(gen_random_uuid(), ''note'')'),
  ('select public.admin_report_log_call(gen_random_uuid(), gen_random_uuid(), ''ok'')'),
  ('select public.admin_jobs_counts()'),
  ('select public.admin_jobs_list(null, null, null, false, null, 25, 0)'),
  ('select public.admin_job_detail(gen_random_uuid())'),
  ('select public.admin_cancel_job(gen_random_uuid(), ''reason'')'),
  ('select public.admin_cancellations_list(''pending'', 25, 0)'),
  ('select public.admin_decide_cancellation(gen_random_uuid(), true, null)'),
  ('select public.admin_job_resume(gen_random_uuid(), ''note'')'),
  ('select public.admin_job_replace_worker(gen_random_uuid(), ''reason'')'),
  ('select public.admin_log_call(''Name'', ''03001234567'', ''worker'', ''question'', ''answered'', null, null)'),
  ('select public.admin_helpline_summary()'),
  ('select public.admin_helpline_list(''today'', false, null, 25, 0)'),
  ('select public.admin_helpline_callback_done(gen_random_uuid())'),
  ('select public.admin_users_counts()'),
  ('select public.admin_users_list(''worker'', ''all'', null, null, 25, 0)'),
  ('select public.admin_user_detail(gen_random_uuid())'),
  ('select public.admin_add_staff_note(gen_random_uuid(), ''note'')'),
  ('select public.admin_send_message(gen_random_uuid(), ''hello there'')'),
  ('select public.admin_reviews_list(''all'', null, null, null, 25, 0)'),
  ('select public.admin_set_review_hidden(gen_random_uuid(), true, ''reason'')'),
  ('select public.admin_settings_get()'),
  ('select public.admin_save_settings(''1092'', true, 7, 7)'),
  ('select public.admin_add_category(''Gardening'', null)'),
  ('select public.admin_update_category(1::smallint, ''Plumbing'', null, true)'),
  ('select public.admin_set_phase_active(1::smallint, true)'),
  ('select public.admin_staff_list()'),
  ('select public.admin_remove_staff(gen_random_uuid(), ''reason'')');
grant select on calls to authenticated;
select is((select count(*) from calls), 32::bigint, 'the list covers all 32 new admin functions');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname ~ '^admin_' and p.proname in (
              'admin_reports_counts', 'admin_reports_list', 'admin_report_detail', 'admin_report_decide', 'admin_report_add_note',
              'admin_report_log_call', 'admin_jobs_counts', 'admin_jobs_list', 'admin_job_detail', 'admin_cancel_job',
              'admin_cancellations_list', 'admin_decide_cancellation', 'admin_job_resume', 'admin_job_replace_worker', 'admin_log_call',
              'admin_helpline_summary', 'admin_helpline_list', 'admin_helpline_callback_done', 'admin_users_counts', 'admin_users_list',
              'admin_user_detail', 'admin_add_staff_note', 'admin_send_message', 'admin_reviews_list', 'admin_set_review_hidden',
              'admin_settings_get', 'admin_save_settings', 'admin_add_category', 'admin_update_category', 'admin_set_phase_active',
              'admin_staff_list', 'admin_remove_staff')
              and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'anon can run none of them');

select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');   -- admin, password only
select is((select count(*) from calls where not tests.refused(sql)), 0::bigint, 'a password-only admin session is refused by every function');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000c1');
select is((select count(*) from calls where not tests.refused(sql)), 0::bigint, 'a resident is refused by every function');
select throws_ok($$select count(*) from public.helpline_calls$$, '42501', null, 'a resident cannot read the helpline table directly');
select throws_ok($$select count(*) from public.staff_notes$$, '42501', null, 'a resident cannot read staff notes directly');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from calls where not tests.refused(sql)), 0::bigint, 'a worker is refused by every function');
select tests.back();

-- 2. Reports ---------------------------------------------------------------------------------------------------------------
insert into public.reports (job_id, reporter_id, against_id, reporter_role, kind, reason_text) values
  ((select j_prog from t), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'worker', 'unsafe', 'I feel unsafe'),
  ((select j_cash from t), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'resident', 'cash_price', 'Asked for more'),
  ((select j_sched from t), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'resident', 'no_show', 'Did not come'),
  ((select j_repl from t), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'resident', 'rude_damage', 'Rude');
update public.jobs set under_review_reason = 'report_unsafe' where id = (select j_prog from t);
update public.reports set created_at = now() - interval '2 days' where kind = 'cash_price';

select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
create temp table rc as select public.admin_reports_counts() as j;
grant select on rc to authenticated;
select is((select j ->> 'open' from rc), '4', 'four reports are open');
select is((select j ->> 'resolved' from rc), '0', 'none resolved yet');
select is((select j -> 'open_by_kind' ->> 'unsafe' from rc), '1', 'one of them is unsafe');
select is((select j ->> 'unsafe_month' from rc), '1', 'one unsafe case this month');
select is((select j ->> 'cash_disputes_month' from rc), '1', 'one cash dispute this month');
select is((select j ->> 'first_call_minutes' from rc), null, 'no first-call time before any call');

select is((public.admin_reports_list('open', null, null, 25, 0) ->> 'total'), '4', 'the open list has four cases');
select is((public.admin_reports_list('open', null, null, 25, 0) -> 'rows' -> 0 ->> 'kind'), 'unsafe', 'the unsafe case is first');
select is((public.admin_reports_list('open', null, null, 25, 0) -> 'rows' -> 0 ->> 'reporter_role'), 'worker', 'the unsafe case was reported by the worker');
select is((public.admin_reports_list('open', null, null, 25, 0) -> 'rows' -> 0 ->> 'against_role'), 'resident', 'against a resident');
select is((public.admin_reports_list('open', 'cash_price', null, 25, 0) ->> 'total'), '1', 'filter by kind');
select is((public.admin_reports_list('open', null, 'rida', 25, 0) ->> 'total'), '4', 'search by a name (case-insensitive)');
select is((public.admin_reports_list('open', null, 'Progress', 25, 0) ->> 'total'), '1', 'search by a job title');
select is((public.admin_reports_list('open', null, '%', 25, 0) ->> 'total'), '0', 'a percent sign is searched literally');
select throws_ok($$select public.admin_reports_list('nonsense', null, null, 25, 0)$$, 'P0001', 'tab must be open, resolved or all', 'a bad tab is refused');
select throws_ok($$select public.admin_reports_list('open', null, repeat('x', 81), 25, 0)$$, 'P0001', 'search is too long', 'a very long search is refused');
select is(jsonb_array_length(public.admin_reports_list('all', null, null, 2, 0) -> 'rows'), 2, 'the page size is respected');

create temp table rd as select public.admin_report_detail((select id from public.reports where kind = 'unsafe')) as j;
grant select on rd to authenticated;
select is((select j -> 'reporter' ->> 'phone' from rd), '03213334444', 'the detail shows the reporter phone for the call-back');
select is((select j -> 'against' ->> 'role' from rd), 'resident', 'and the other person');
select is((select j -> 'job' ->> 'code' from rd), (select code from public.jobs where id = (select j_prog from t)), 'and the job');
select is((select j -> 'job' ->> 'quote_total' from rd), '3200', 'with its agreed quote');
select ok((select position('42101' in j::text) = 0 from rd), 'no CNIC in the case detail');
select is((select count(*) from public.audit_log where action = 'report_viewed'), 1::bigint, 'opening a case is audited');
select throws_ok($$select public.admin_report_detail(gen_random_uuid())$$, 'P0001', 'no such case', 'an unknown case is refused');

-- decide
select throws_ok(format($$select public.admin_report_decide(%L, 'close', '  ')$$, (select id from public.reports where kind = 'no_show')),
                 'P0001', 'write a reason for this decision (3 to 500 characters)', 'closing needs a reason');
select throws_ok(format($$select public.admin_report_decide(%L, 'banana', 'x')$$, (select id from public.reports where kind = 'no_show')),
                 'P0001', 'choose what to do with this case', 'an unknown choice is refused');
select public.admin_report_decide((select id from public.reports where kind = 'no_show'), 'keep_open', null);
select is((select status::text from public.reports where kind = 'no_show'), 'in_review', 'keep open marks the case in review');
select is(tests.scalar($$select assigned_to::text from public.reports where kind = 'no_show'$$), '00000000-0000-0000-0000-0000000000a1', 'and assigns it to the staff member');
select is(tests.scalar($$select count(*) from public.notifications where type = 'report_in_review' and user_id = (select reporter_id from public.reports where kind = 'no_show')$$), '1', 'the reporter is told that staff opened the case');
select is(tests.scalar($$select payload ->> 'code' from public.notifications where type = 'report_in_review'$$), (select code from public.reports where kind = 'no_show'), 'with the case code and nothing about the other person');
select is(tests.scalar($$select count(*) from public.notifications where type = 'report_in_review' and user_id = (select against_id from public.reports where kind = 'no_show')$$), '0', 'the person reported is not told the case was opened');
select public.admin_report_decide((select id from public.reports where kind = 'no_show'), 'close', 'Worker was ill, rescheduled');
select is(tests.scalar($$select status::text || '/' || action::text from public.reports where kind = 'no_show'$$), 'resolved/no_action', 'close resolves with no action');
select is(tests.scalar($$select payload ->> 'outcome' from public.notifications where type = 'report_resolved' and payload ->> 'code' = (select code from public.reports where kind = 'no_show')$$), 'no_action', 'closing tells the reporter no action was taken');
select is(tests.scalar($$select count(*) from public.notifications where type = 'report_resolved' and user_id = (select against_id from public.reports where kind = 'no_show')$$), '0', 'and says nothing to the person reported');
select throws_ok(format($$select public.admin_report_decide(%L, 'close', 'again')$$, (select id from public.reports where kind = 'no_show')),
                 'P0001', 'this case is already resolved', 'a resolved case cannot be decided again');

select public.admin_report_decide((select id from public.reports where kind = 'rude_damage'), 'warning', 'Please speak politely to workers.');
select is(tests.scalar($$select action::text from public.reports where kind = 'rude_damage'$$), 'warning', 'a warning is recorded');
select is(tests.scalar($$select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'report_warning'$$), '1', 'the person reported gets the warning');
select is(tests.scalar($$select payload ->> 'message' from public.notifications where type = 'report_warning'$$), 'Please speak politely to workers.', 'with the staff message');
select is(tests.scalar($$select payload ->> 'outcome' from public.notifications where type = 'report_resolved' and payload ->> 'code' = (select code from public.reports where kind = 'rude_damage')$$), 'action_taken', 'a warning tells the reporter that action was taken');
select is(tests.scalar($$select (payload::text ~* 'polite') from public.notifications where type = 'report_resolved' and user_id = (select reporter_id from public.reports where kind = 'rude_damage')$$), 'false', 'without saying what the warning said');
select is((select account_status::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'active', 'a warning does not suspend');

-- unsafe: call, note, then suspend the resident
select throws_ok(format($$select public.admin_report_log_call(%L, '00000000-0000-0000-0000-0000000000b2', 'x')$$, (select id from public.reports where kind = 'unsafe')),
                 'P0001', 'choose one of the two people on this case', 'only the two people on the case can be called');
select public.admin_report_log_call((select id from public.reports where kind = 'unsafe'), '00000000-0000-0000-0000-0000000000b1', 'Spoke to the worker, safe now');
select is((select status::text from public.reports where kind = 'unsafe'), 'in_review', 'the first call moves a new case to in review');
select is((select count(*) from public.report_calls where called_by = '00000000-0000-0000-0000-0000000000a1'), 1::bigint, 'the call is recorded');
select public.admin_report_add_note((select id from public.reports where kind = 'unsafe'), 'Called the worker first.');
select throws_ok(format($$select public.admin_report_add_note(%L, '   ')$$, (select id from public.reports where kind = 'unsafe')),
                 'P0001', 'write a note (1000 characters at most)', 'an empty note is refused');
select is((select count(*) from public.report_notes), 1::bigint, 'the note is saved');
select ok((select (public.admin_reports_counts() ->> 'first_call_minutes') is not null), 'a first-call time now exists');
select public.admin_report_decide((select id from public.reports where kind = 'unsafe'), 'suspend', 'Threatened the worker at the door');
select is((select account_status::text from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'suspended', 'suspend suspends the person reported');
select is(tests.scalar($$select action::text from public.reports where kind = 'unsafe'$$), 'suspend', 'and records the outcome');
select is(tests.scalar($$select payload ->> 'message' from public.notifications where type = 'account_suspended' and user_id = '00000000-0000-0000-0000-0000000000c1'$$), 'Threatened the worker at the door', 'the suspended person gets a notice with the reason');
select is(tests.scalar($$select payload ->> 'outcome' from public.notifications where type = 'report_resolved' and payload ->> 'code' = (select code from public.reports where kind = 'unsafe')$$), 'action_taken', 'and the reporter is told that action was taken');
select is((select under_review_reason from public.jobs where id = (select j_prog from t)), null, 'the job is no longer flagged for the unsafe report');
select is((select count(*) from public.audit_log where action = 'report_resolved'), 3::bigint, 'each resolution is audited');
select is((select public.admin_reports_counts() ->> 'open'), '1', 'one case (the cash one) is still open');

-- reactivate the resident for the rest of the test
select public.admin_set_account_status('00000000-0000-0000-0000-0000000000c1', false, 'Cleared after the call');

-- 3. Jobs ---------------------------------------------------------------------------------------------------------------
create temp table jc as select public.admin_jobs_counts() as j;
grant select on jc to authenticated;
select is((select j ->> 'total' from jc), '9', 'nine jobs (drafts are never counted)');
select is((select j -> 'by_status' ->> 'scheduled' from jc), '4', 'four scheduled');
select is((select j -> 'by_status' ->> 'cash_collected' from jc), '1', 'one cash collected');
select is((public.admin_jobs_list('scheduled', null, null, false, null, 25, 0) ->> 'total'), '4', 'filter by status');
select is((public.admin_jobs_list(null, 6::smallint, null, false, null, 25, 0) ->> 'total'), '9', 'filter by phase');
select is((public.admin_jobs_list(null, 7::smallint, null, false, null, 25, 0) ->> 'total'), '0', 'a phase with no jobs');
select is((public.admin_jobs_list(null, null, 1::smallint, false, null, 25, 0) ->> 'total'), '9', 'filter by category');
select is((public.admin_jobs_list(null, null, null, true, null, 25, 0) ->> 'total'), '9', 'filter by today');
select is((public.admin_jobs_list(null, null, null, false, 'Ali Raza', 25, 0) ->> 'total'), '6', 'search by the worker name');
select is((public.admin_jobs_list(null, null, null, false, 'Sara', 25, 0) ->> 'total'), '1', 'search by the resident name');
select is((select r ->> 'open_reports' from jsonb_array_elements(public.admin_jobs_list(null, null, null, false, 'Progress job', 25, 0) -> 'rows') r), '0', 'the resolved report is not counted as open');
select is((select r ->> 'open_reports' from jsonb_array_elements(public.admin_jobs_list(null, null, null, false, 'Cash job', 25, 0) -> 'rows') r), '1', 'the open cash report is flagged on its job');
select is((select r ->> 'quote_total' from jsonb_array_elements(public.admin_jobs_list(null, null, null, false, 'Progress job', 25, 0) -> 'rows') r), '3200', 'the quote total is shown');

create temp table jd as select public.admin_job_detail((select j_cash from t)) as j;
grant select on jd to authenticated;
select is((select j -> 'quote' ->> 'labour' from jd), '1300', 'quote breakdown: labour');
select is((select j -> 'quote' ->> 'materials' from jd), '500', 'quote breakdown: materials');
select is((select j -> 'cash' ->> 'worker_amount' from jd), '1800', 'cash recorded by the worker');
select is((select j -> 'cash' ->> 'matched' from jd), 'true', 'and matched');
select is((select j -> 'resident' ->> 'name' from jd), 'Rida Resident', 'resident shown');
select is((select j -> 'worker' ->> 'category' from jd), 'Plumbing', 'worker trade shown');
select is((select jsonb_array_length(j -> 'reports') from jd), 1, 'the report on the job is listed');
select ok((select position('42101' in j::text) = 0 from jd), 'no CNIC in the job detail');
select throws_ok($$select public.admin_job_detail(gen_random_uuid())$$, 'P0001', 'no such job', 'an unknown job is refused');

-- cancel
select throws_ok(format($$select public.admin_cancel_job(%L, 'x')$$, (select j_prog from t)), 'P0001', 'write a reason (3 to 500 characters)', 'cancelling needs a reason');
select throws_ok(format($$select public.admin_cancel_job(%L, 'Paid already, cannot cancel')$$, (select j_cash from t)),
                 'P0001', 'a job that is cash collected cannot be cancelled', 'a paid job cannot be cancelled');
select public.admin_cancel_job((select j_prog from t), 'Both parties agreed by phone');
select is((select status::text from public.jobs where id = (select j_prog from t)), 'cancelled', 'staff can cancel a live job');
select is((select cancel_reason from public.jobs where id = (select j_prog from t)), 'Both parties agreed by phone', 'the reason is kept on the job');
select is((select cancelled_by from public.jobs where id = (select j_prog from t)), '00000000-0000-0000-0000-0000000000a1'::uuid, 'and who cancelled it');
select is(tests.scalar(format($$select count(*) from public.notifications where job_id = %L and type = 'job_cancelled'$$, (select j_prog from t))), '2', 'both people are told');
select is((select count(*) from public.job_events where job_id = (select j_prog from t) and event_type = 'cancelled_by_staff'), 1::bigint, 'the timeline has the event');
select is((select reason from public.audit_log where action = 'job_cancelled_by_staff'), 'Both parties agreed by phone', 'the audit log has the reason');
select throws_ok(format($$select public.admin_cancel_job(%L, 'Again please')$$, (select j_prog from t)),
                 'P0001', 'a job that is cancelled cannot be cancelled', 'a cancelled job cannot be cancelled again');

-- cancellation requests
select tests.back();
insert into public.cancellation_requests (job_id, requester_id, requester_role, reason_code, details) values
  ((select j_decl from t), '00000000-0000-0000-0000-0000000000c1', 'resident', 'schedule_conflict', 'Away that day'),
  ((select j_appr from t), '00000000-0000-0000-0000-0000000000b1', 'worker', 'worker_unavailable', 'Ill');
update public.cancellation_requests set created_at = now() - interval '1 hour' where job_id = (select j_decl from t);
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is((public.admin_jobs_counts() ->> 'cancellations_pending'), '2', 'two requests are waiting');
select is((public.admin_cancellations_list('pending', 25, 0) ->> 'total'), '2', 'the list shows both');
select is((public.admin_cancellations_list('pending', 25, 0) -> 'rows' -> 0 ->> 'requester_name'), 'Rida Resident', 'oldest first, with the requester');
select throws_ok(format($$select public.admin_decide_cancellation(%L, false, null)$$, (select id from public.cancellation_requests where job_id = (select j_decl from t))),
                 'P0001', 'write a note the requester will see (3 to 500 characters)', 'declining needs a note');
select public.admin_decide_cancellation((select id from public.cancellation_requests where job_id = (select j_decl from t)), false, 'The worker is already on the way.');
select is((select status::text from public.cancellation_requests where job_id = (select j_decl from t)), 'declined', 'declined');
select is((select status::text from public.jobs where id = (select j_decl from t)), 'scheduled', 'the job carries on');
select is(tests.scalar($$select count(*) from public.notifications where type = 'cancellation_declined' and user_id = '00000000-0000-0000-0000-0000000000c1'$$), '1', 'the requester is told');
select throws_ok(format($$select public.admin_decide_cancellation(%L, true, null)$$, (select id from public.cancellation_requests where job_id = (select j_decl from t))),
                 'P0001', 'this request is not waiting for a decision', 'a decided request cannot be decided again');
select public.admin_decide_cancellation((select id from public.cancellation_requests where job_id = (select j_appr from t)), true, null);
select is((select status::text from public.cancellation_requests where job_id = (select j_appr from t)), 'approved', 'approved');
select is((select status::text from public.jobs where id = (select j_appr from t)), 'cancelled', 'approving cancels the job');
select ok((select cancel_reason like 'Cancellation requested by the worker%' from public.jobs where id = (select j_appr from t)), 'with a default reason naming who asked');

-- resume and replace
select tests.back();
update public.profiles set account_status = 'suspended', suspended_at = now(), suspension_reason = 'test' where id = '00000000-0000-0000-0000-0000000000b2';
update public.jobs set under_review_reason = 'worker_suspended' where id = (select j_susp from t);
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select throws_ok(format($$select public.admin_job_resume(%L, 'Looks fine')$$, (select j_susp from t)), 'P0001',
                 'the worker is suspended: reactivate the worker first, or replace the worker, or cancel the job', 'a job cannot resume with a suspended worker');
select throws_ok(format($$select public.admin_job_resume(%L, 'Looks fine')$$, (select j_open from t)), 'P0001', 'this job is not under review', 'a job that is not flagged is refused');
select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b2', false, 'Cleared');
select public.admin_job_resume((select j_susp from t), 'Worker cleared, carry on');
select is((select under_review_reason from public.jobs where id = (select j_susp from t)), null, 'the flag is cleared once the worker is active again');

select throws_ok(format($$select public.admin_job_replace_worker(%L, 'Worker unavailable')$$, (select j_susp from t)), 'P0001',
                 'the worker can only be replaced before the work starts', 'only a scheduled job can change worker');
select public.admin_job_replace_worker((select j_repl from t), 'Worker suspended after a complaint');
select is((select status::text from public.jobs where id = (select j_repl from t)), 'open', 'the job is open again');
select is((select accepted_worker_id from public.jobs where id = (select j_repl from t)), null, 'with no worker');
select is((select count(*) from public.quotes where job_id = (select j_repl from t) and status = 'rejected'), 1::bigint, 'the old quote is closed');
select is(tests.scalar(format($$select count(*) from public.notifications where job_id = %L and type in ('quote_rejected', 'worker_replaced_by_staff')$$, (select j_repl from t))), '2', 'the worker and the resident are told');
select throws_ok(format($$select public.admin_job_replace_worker(%L, 'Again')$$, (select j_repl from t)), 'P0001',
                 'the worker can only be replaced before the work starts', 'an open job has no worker to replace');

-- 4. Helpline ----------------------------------------------------------------------------------------------------------
select throws_ok($$select public.admin_log_call('A', '03001234567', 'worker', 'question', 'answered', null, null)$$, 'P0001', 'enter the caller''s name', 'a name is required');
select throws_ok($$select public.admin_log_call('Caller', 'abc', 'worker', 'question', 'answered', null, null)$$, 'P0001', 'enter the caller''s phone number (digits, 5 to 20 characters)', 'a phone number is required');
select throws_ok($$select public.admin_log_call('Caller', '03001234567', 'robot', 'question', 'answered', null, null)$$, 'P0001', 'choose who is calling', 'a caller type is required');
select throws_ok($$select public.admin_log_call('Caller', '03001234567', 'worker', 'rumour', 'answered', null, null)$$, 'P0001', 'choose the reason for the call', 'a reason is required');
select throws_ok($$select public.admin_log_call('Caller', '03001234567', 'worker', 'question', 'maybe', null, null)$$, 'P0001', 'choose the outcome', 'an outcome is required');
select throws_ok($$select public.admin_log_call('Caller', '03001234567', 'worker', 'unsafe', 'answered', null, 'RP-9999')$$, 'P0001', 'there is no case with that number', 'a linked case must exist');
select public.admin_log_call('Imran Caller', '0321 456 7890', 'worker', 'question', 'answered', 'Asked about the documents', null);
select public.admin_log_call('Maryam Caller', '03330001111', 'resident', 'cash_price', 'callback_pending', 'Will call back', (select lower(code) from public.reports where kind = 'cash_price'));
select is((public.admin_helpline_summary() ->> 'calls_today'), '2', 'two calls today');
select is((public.admin_helpline_summary() ->> 'answered_today'), '1', 'one answered');
select is((public.admin_helpline_summary() ->> 'callbacks_pending'), '1', 'one callback pending');
select is((public.admin_helpline_summary() ->> 'cases_month'), '1', 'one call linked to a case');
select is((public.admin_helpline_list('today', true, null, 25, 0) ->> 'total'), '1', 'the callback-only list');
select is((public.admin_helpline_list('today', false, 'maryam', 25, 0) -> 'rows' -> 0 ->> 'report_code'), (select code from public.reports where kind = 'cash_price'), 'the linked case code is shown');
select is((public.admin_helpline_list('week', false, null, 25, 0) ->> 'total'), '2', 'this week');
select throws_ok($$select public.admin_helpline_list('year', false, null, 25, 0)$$, 'P0001', 'range must be today, week or all', 'a bad range is refused');
select throws_ok(format($$select public.admin_helpline_callback_done(%L)$$, tests.scalar($$select id from public.helpline_calls where outcome = 'answered'$$)::uuid), 'P0001', 'no callback is waiting for this call', 'only a pending callback can be marked done');
select public.admin_helpline_callback_done(tests.scalar($$select id from public.helpline_calls where outcome = 'callback_pending'$$)::uuid);
select is((public.admin_helpline_summary() ->> 'callbacks_pending'), '0', 'the callback is done');

-- 5. Users ----------------------------------------------------------------------------------------------------------------
select is((public.admin_users_counts() ->> 'workers'), '2', 'two approved workers');
select is((public.admin_users_counts() ->> 'residents'), '2', 'two approved residents');
select is((public.admin_users_list('worker', 'all', null, null, 25, 0) ->> 'total'), '2', 'the worker list');
select is((public.admin_users_list('worker', 'all', null, null, 25, 0) -> 'rows' -> 0 ->> 'categories'), 'Plumbing', 'with the trade');
select is((public.admin_users_list('worker', 'all', 6::smallint, null, 25, 0) ->> 'total'), '1', 'filter by phase');
select is((public.admin_users_list('worker', 'all', null, '0321333', 25, 0) ->> 'total'), '1', 'search by phone');
select is((public.admin_users_list('worker', 'all', null, '42101-3333333', 25, 0) ->> 'total'), '1', 'search by CNIC');
select is((public.admin_users_list('worker', 'open_reports', null, null, 25, 0) ->> 'total'), '1', 'workers with an open report');
select is((public.admin_users_list('worker', 'suspended', null, null, 25, 0) ->> 'total'), '0', 'no suspended workers');
select is((public.admin_users_list('resident', 'all', 6::smallint, null, 25, 0) ->> 'total'), '2', 'residents by phase (their jobs used a phase 6 address)');
select ok((select position('42101' in (public.admin_users_list('worker', 'all', null, null, 25, 0))::text) = 0), 'the list never contains a CNIC');
select throws_ok($$select public.admin_users_list('admin', 'all', null, null, 25, 0)$$, 'P0001', 'role must be worker or resident', 'admins are not in the user list');
select throws_ok($$select public.admin_users_list('worker', 'banned', null, null, 25, 0)$$, 'P0001', 'state must be all, active, suspended or open_reports', 'a bad state is refused');

create temp table ud as select public.admin_user_detail('00000000-0000-0000-0000-0000000000b1') as j;
grant select on ud to authenticated;
select is((select j ->> 'cnic_masked' from ud), '42101-*******-3', 'the CNIC is masked');
select is((select j -> 'worker' ->> 'experience_years' from ud), '8', 'worker details');
select is((select j ->> 'open_reports' from ud), '1', 'open reports counted');
select is((select jsonb_array_length(j -> 'recent_jobs') from ud), 5, 'five recent jobs');
select is((select count(*) from public.audit_log where action = 'user_viewed'), 1::bigint, 'opening a person is audited');
select throws_ok($$select public.admin_user_detail('00000000-0000-0000-0000-0000000000a1')$$, 'P0001', 'no such user', 'an admin is not a user');
select throws_ok($$select public.admin_user_detail(gen_random_uuid())$$, 'P0001', 'no such user', 'an unknown user is refused');
select is((public.admin_user_detail('00000000-0000-0000-0000-0000000000c1') ->> 'jobs_count'), '8', 'a resident page shows the job count');
select public.admin_add_staff_note('00000000-0000-0000-0000-0000000000b1', 'Documents checked, police certificate valid');
select is((public.admin_user_detail('00000000-0000-0000-0000-0000000000b1') -> 'notes' -> 0 ->> 'note'), 'Documents checked, police certificate valid', 'staff notes are kept');
select throws_ok($$select public.admin_add_staff_note('00000000-0000-0000-0000-0000000000a2', 'hi')$$, 'P0001', 'no such user', 'notes are only for workers and residents');
select public.admin_send_message('00000000-0000-0000-0000-0000000000b1', 'Please upload a new police certificate.');
select is(tests.scalar($$select payload ->> 'text' from public.notifications where type = 'staff_message'$$), 'Please upload a new police certificate.', 'the message is delivered as a notification');
select throws_ok($$select public.admin_send_message('00000000-0000-0000-0000-0000000000b1', 'x')$$, 'P0001', 'write a message (3 to 300 characters)', 'a message needs words');
select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b2', true, 'Repeated no-shows');
select throws_ok($$select public.admin_send_message('00000000-0000-0000-0000-0000000000b2', 'hello there')$$, 'P0001', 'that person cannot receive a message', 'a suspended person gets no message');
select is((public.admin_user_detail('00000000-0000-0000-0000-0000000000b2') ->> 'past_suspensions'), '1', 'past suspensions are counted from the audit log');
select is((public.admin_users_list('worker', 'suspended', null, null, 25, 0) ->> 'total'), '1', 'the suspended filter finds them');
select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b2', false, 'Cleared again');

-- 6. Reviews ----------------------------------------------------------------------------------------------------------
select tests.back();
insert into public.reviews (job_id, resident_id, worker_id, behaviour, completeness, quality, hire_again, comment) values
  ((select j_cash from t), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 5, 5, 5, true, 'Great and tidy'),
  ((select j_sched from t), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 2, 2, 2, false, 'Asked for more money'),
  ((select j_decl from t), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 4, 4, 4, true, 'Good');
select is((select rating_count from public.worker_details where profile_id = '00000000-0000-0000-0000-0000000000b1'), 3, 'the trigger counts new reviews');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is((public.admin_reviews_list('all', null, null, null, 25, 0) ->> 'total'), '3', 'three reviews');
select is((public.admin_reviews_list('5', null, null, null, 25, 0) ->> 'total'), '1', 'one five-star review');
select is((public.admin_reviews_list('4', null, null, null, 25, 0) ->> 'total'), '1', 'one four-star review');
select is((public.admin_reviews_list('low', null, null, null, 25, 0) ->> 'total'), '1', 'one review of two stars or less');
select is((public.admin_reviews_list('all', 1::smallint, null, null, 25, 0) ->> 'total'), '3', 'filter by the worker category');
select is((public.admin_reviews_list('all', 2::smallint, null, null, 25, 0) ->> 'total'), '0', 'another category has none');
select is((public.admin_reviews_list('all', null, null, 'more money', 25, 0) ->> 'total'), '1', 'search in the comment');
select is((public.admin_reviews_list('all', null, '00000000-0000-0000-0000-0000000000b2', null, 25, 0) ->> 'total'), '0', 'filter by worker');
select throws_ok(format($$select public.admin_set_review_hidden(%L, true, 'x')$$, (select id from public.reviews limit 1)), 'P0001', 'write a reason (3 to 500 characters)', 'hiding needs a reason');
select public.admin_set_review_hidden((select id from public.reviews where comment = 'Asked for more money'), true, 'Abusive language');
select is((select rating_count from public.worker_details where profile_id = '00000000-0000-0000-0000-0000000000b1'), 2, 'a hidden review leaves the worker average');
select is((select rating_avg from public.worker_details where profile_id = '00000000-0000-0000-0000-0000000000b1'), 4.50::numeric, 'average of the other two');
select is((public.admin_reviews_list('hidden', null, null, null, 25, 0) ->> 'total'), '1', 'the hidden filter lists it');
select throws_ok(format($$select public.admin_set_review_hidden(%L, true, 'again')$$, (select id from public.reviews where hidden_at is not null)), 'P0001', 'this review is already hidden', 'it cannot be hidden twice');
select public.admin_set_review_hidden((select id from public.reviews where hidden_at is not null), false, 'Reviewed again, it is fair');
select is((select rating_count from public.worker_details where profile_id = '00000000-0000-0000-0000-0000000000b1'), 3, 'showing it again restores the average');
select is((select count(*) from public.audit_log where action in ('review_hidden', 'review_shown')), 2::bigint, 'both changes are audited');

-- 7. Settings and staff --------------------------------------------------------------------------------------------------
create temp table sg as select public.admin_settings_get() as j;
grant select on sg to authenticated;
select is((select jsonb_array_length(j -> 'categories') from sg), 8, 'eight categories');
select is((select jsonb_array_length(j -> 'phases') from sg), 8, 'eight phases');
select is((select j ->> 'report_window_days' from sg), '7', 'report window');
select throws_ok($$select public.admin_save_settings('1092', true, 0, 7)$$, 'P0001', 'the report window must be 1 to 30 days', 'a bad window is refused');
select throws_ok($$select public.admin_save_settings('abc', true, 7, 7)$$, 'P0001', 'the helpline number can only have digits, spaces, + and - (3 to 20 characters)', 'a bad number is refused');
select throws_ok($$select public.admin_save_settings('', true, 7, 7)$$, 'P0001', 'enter the helpline number before showing it in the apps', 'the helpline cannot be shown without a number');
select public.admin_save_settings('1092', true, 10, 14);
select is((public.admin_settings_get() ->> 'helpline_number'), '1092', 'the helpline number is saved');
select is((public.admin_settings_get() ->> 'helpline_enabled'), 'true', 'and shown');
select is((public.admin_settings_get() ->> 'report_window_days'), '10', 'the report window is saved');
select is((public.admin_settings_get() ->> 'review_window_days'), '14', 'the review window is saved');
select is((select value from public.app_settings where key = 'helpline_number'), '"1092"'::jsonb, 'stored as text in the setting');
select is((select count(*) from public.audit_log where action = 'settings_saved'), 1::bigint, 'saving is audited');

select throws_ok($$select public.admin_add_category('Plumbing', null)$$, 'P0001', 'a category with that name already exists', 'duplicate category names are refused');
select throws_ok($$select public.admin_add_category('!', null)$$, 'P0001', 'the category name must be 2 to 40 characters', 'a short name is refused');
select ok((select public.admin_add_category('Garden care', 'Lawns and trees') is not null), 'a category is added');
select is((select slug from public.categories where name = 'Garden care'), 'garden-care', 'with a slug');
select is((select sort from public.categories where name = 'Garden care'), 9::smallint, 'at the end of the list');
select public.admin_update_category((select id from public.categories where name = 'Garden care'), 'Gardening', 'Lawns, trees and plants', false);
select is((select active from public.categories where name = 'Gardening'), false, 'a category can be switched off and renamed');
-- switch everything off except one: the last one refuses
do $$ declare c record; begin
  for c in select id, name, subtitle from public.categories where id <> 1 and active loop
    perform public.admin_update_category(c.id, c.name, c.subtitle, false);
  end loop;
end $$;
select throws_ok($$select public.admin_update_category(1::smallint, 'Plumbing', 'x', false)$$, 'P0001', 'at least one category must stay on', 'the last category cannot be switched off');
select public.admin_set_phase_active(8::smallint, false);
select is((select active from public.service_areas where phase = 8), false, 'a phase can be switched off');
do $$ declare p record; begin
  for p in select phase from public.service_areas where phase <> 1 and active loop
    perform public.admin_set_phase_active(p.phase, false);
  end loop;
end $$;
select throws_ok($$select public.admin_set_phase_active(1::smallint, false)$$, 'P0001', 'at least one phase must stay on', 'the last phase cannot be switched off');
select throws_ok($$select public.admin_set_phase_active(9::smallint, true)$$, 'P0001', 'no such phase', 'an unknown phase is refused');

select is((select jsonb_array_length(public.admin_staff_list() -> 'admins')), 2, 'two admins');
select is((select e ->> 'is_me' from jsonb_array_elements(public.admin_staff_list() -> 'admins') e where e ->> 'name' = 'Staff A'), 'true', 'the list marks the signed-in admin');
select ok((select public.invite_staff('new.staff@test.dev') is not null), 'an invite is created');
select is((select jsonb_array_length(public.admin_staff_list() -> 'invites')), 1, 'and listed');
select ok((select position('token' in (public.admin_staff_list() -> 'invites')::text) = 0), 'the invite list never shows the token');
select throws_ok($$select public.admin_remove_staff('00000000-0000-0000-0000-0000000000a1', 'testing')$$, 'P0001', 'you cannot remove your own account', 'nobody removes themselves');
select throws_ok($$select public.admin_remove_staff('00000000-0000-0000-0000-0000000000c1', 'testing')$$, 'P0001', 'no such admin', 'only admins can be removed here');
select public.admin_remove_staff('00000000-0000-0000-0000-0000000000a2', 'Left the organisation');
select is((select account_status::text from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'), 'suspended', 'a removed admin is suspended');
select is(tests.scalar($$select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000a2'$$), '0', 'and signed out everywhere');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000a201');
select is(public.is_admin(), false, 'a removed admin is no longer an admin');
select tests.back();

select * from finish();
rollback;
