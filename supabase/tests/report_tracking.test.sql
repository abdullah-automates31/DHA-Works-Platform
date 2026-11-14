-- Migration 0053: report tracking (notices to the reporter, my_reports), suspension notices with an end date and
-- automatic expiry, and the privacy of the staff-only report columns.
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
create function tests.scalar(p_sql text) returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin execute p_sql into v; return v; end $$;
create function tests.msg(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlerrm;
end $$;
grant execute on function tests.act(uuid, uuid), tests.back(), tests.scalar(text), tests.msg(text) to authenticated;
-- how many notices of a type a person has (read as the owner, so the test does not depend on who is signed in)
create function tests.notices(p_user uuid, p_type text) returns bigint language sql security definer set search_path = public as $$
  select count(*) from public.notifications where user_id = p_user and type = p_type;
$$;
grant execute on function tests.notices(uuid, text) to authenticated;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev');
insert into public.profiles (id, role, full_name, email, phone, cnic, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin@test.dev', '03009990001', null, 'approved'),
  ('00000000-0000-0000-0000-0000000000c1', 'resident', 'Rida Resident', 'res@test.dev', '03001110001', '42101-1111111-1', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Ali Raza', 'w1@test.dev', '03213334444', '42101-3333333-3', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Bilal Khan', 'w2@test.dev', '03215556666', '42101-4444444-4', 'approved');
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1');
insert into public.admin_verified_sessions (session_id, user_id) values ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1');

create function tests.make_job(p_title text, p_n text) returns uuid language plpgsql as $$
declare v_job uuid; v_addr uuid; v_res uuid := '00000000-0000-0000-0000-0000000000c1';
begin
  perform tests.act(v_res);
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing today', 'asap', null, null, null, null,
                                 array[v_res::text || '/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;
create temp table t as select tests.make_job('Tap job', '1') as j1, tests.make_job('Second job', '2') as j2, tests.make_job('Third job', '3') as j3;
grant select on t to authenticated;

-- 1. Filing a report tells the reporter once; the person reported hears nothing ---------------------------------------
insert into public.reports (id, job_id, reporter_id, against_id, reporter_role, kind, reason_text) values
  ('00000000-0000-0000-0000-00000000d001', (select j1 from t), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'worker', 'rude_damage', 'Customer was rude to me');
select is(tests.notices('00000000-0000-0000-0000-0000000000b1', 'report_received'), 1::bigint, 'the reporter is told the report was received');
select is(tests.scalar($$select payload::text from public.notifications where type = 'report_received'$$), format('{"code": "%s"}', (select code from public.reports where id = '00000000-0000-0000-0000-00000000d001')), 'and the notice holds only the case code');
select is(tests.notices('00000000-0000-0000-0000-0000000000c1', 'report_received'), 0::bigint, 'the person reported is not told');
insert into public.reports (job_id, reporter_id, against_id, reporter_role, kind, reason_text, system_generated) values
  ((select j2 from t), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'worker', 'cash_price', 'automatic', true);
select is(tests.notices('00000000-0000-0000-0000-0000000000b1', 'report_received'), 1::bigint, 'a system-generated report sends no notice');

-- 2. Staff open the case: one notice, however many times the same step repeats ----------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select lives_ok($$select public.admin_report_decide('00000000-0000-0000-0000-00000000d001', 'keep_open', null)$$, 'staff open the case');
select lives_ok($$select public.admin_report_decide('00000000-0000-0000-0000-00000000d001', 'keep_open', null)$$, 'and press it again');
select tests.back();
select is(tests.notices('00000000-0000-0000-0000-0000000000b1', 'report_in_review'), 1::bigint, 'the reporter is told once that DHA is reviewing');
select is(tests.notices('00000000-0000-0000-0000-0000000000c1', 'report_in_review'), 0::bigint, 'and the person reported is not');
update public.reports set status = 'in_review' where id = '00000000-0000-0000-0000-00000000d001';
select is(tests.notices('00000000-0000-0000-0000-0000000000b1', 'report_in_review'), 1::bigint, 'a repeated status change adds nothing');

-- 3. Resolved: a generic outcome only ----------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select lives_ok($$select public.admin_report_decide('00000000-0000-0000-0000-00000000d001', 'warning', 'Do not shout at workers again')$$, 'staff resolve the case with a warning');
select tests.back();
select is(tests.notices('00000000-0000-0000-0000-0000000000b1', 'report_resolved'), 1::bigint, 'the reporter is told it is resolved');
select is(tests.scalar($$select payload ->> 'outcome' from public.notifications where type = 'report_resolved'$$), 'action_taken', 'with the generic outcome "action taken"');
select is(tests.scalar($$select count(*) from jsonb_object_keys((select payload from public.notifications where type = 'report_resolved'))$$), '2', 'and nothing but the code and the outcome');
select is(tests.scalar($$select (payload::text ~* '(warning|suspend|shout|Ali|Rida)') from public.notifications where type = 'report_resolved'$$), 'false', 'no punishment, staff reason or name leaks into the notice');
select is(tests.notices('00000000-0000-0000-0000-0000000000c1', 'report_warning'), 1::bigint, 'the person warned gets the warning');
select is(tests.notices('00000000-0000-0000-0000-0000000000c1', 'report_resolved'), 0::bigint, 'but not the reporter notice');
update public.reports set status = 'in_review' where id = '00000000-0000-0000-0000-00000000d001';
update public.reports set status = 'resolved' where id = '00000000-0000-0000-0000-00000000d001';
select is(tests.notices('00000000-0000-0000-0000-0000000000b1', 'report_resolved'), 1::bigint, 'reopening and resolving again does not repeat the notice');

-- 4. Closing a new case with no action: one notice, no "in review" step in between ------------------------------------------
insert into public.reports (id, job_id, reporter_id, against_id, reporter_role, kind, reason_text) values
  ('00000000-0000-0000-0000-00000000d002', (select j3 from t), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'worker', 'no_show', 'Nobody opened the door');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select lives_ok($$select public.admin_report_decide('00000000-0000-0000-0000-00000000d002', 'close', 'Resident was in hospital')$$, 'staff close a new case with no action');
select tests.back();
select is(tests.scalar($$select payload ->> 'outcome' from public.notifications where type = 'report_resolved' and payload ->> 'code' = (select code from public.reports where id = '00000000-0000-0000-0000-00000000d002')$$), 'no_action', 'the reporter is told no action was taken');
select is(tests.notices('00000000-0000-0000-0000-0000000000b1', 'report_in_review'), 1::bigint, 'closing straight from "new" sends no "in review" notice');
select ok((select updated_at > created_at - interval '1 second' from public.reports where id = '00000000-0000-0000-0000-00000000d002'), 'the report keeps a last-updated time');

-- 5. Privacy: staff-only columns are not readable by app users --------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select action from public.reports$$, '42501', null, 'a reporter cannot read the staff decision');
select throws_ok($$select action_reason from public.reports$$, '42501', null, 'nor the staff reason');
select throws_ok($$select against_id from public.reports$$, '42501', null, 'nor who the report is against');
select throws_ok($$select assigned_to from public.reports$$, '42501', null, 'nor which staff member has it');
select throws_ok($$select * from public.reports$$, '42501', null, 'select * is refused too');
select is((select count(*) from public.reports), 3::bigint, 'the reporter still sees their own rows (RLS) on the columns that are theirs');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.reports), 0::bigint, 'another worker sees none of them');
select tests.back();
select is(has_column_privilege('authenticated', 'public.reports', 'action_reason', 'select'), false, 'the column privilege is gone');
select is(has_column_privilege('anon', 'public.reports', 'code', 'select'), false, 'and anon never had it');

update public.reports set created_at = now() - interval '1 day' where id = '00000000-0000-0000-0000-00000000d001';
-- 6. my_reports ----------------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
create temp table mr as select public.my_reports(20, 0) as j;
grant select on mr to authenticated;
select is((select j ->> 'total' from mr), '2', 'my_reports counts my own reports (not the system one)');
select is((select jsonb_array_length(j -> 'rows') from mr), 2, 'and lists them');
select is((select j -> 'rows' -> 0 ->> 'code' from mr), (select code from public.reports where id = '00000000-0000-0000-0000-00000000d002'), 'newest first');
select is((select j -> 'rows' -> 0 ->> 'status' from mr), 'resolved', 'the closed case reads "resolved"');
select is((select j -> 'rows' -> 0 ->> 'outcome' from mr), 'no_action', 'with the generic outcome');
select is((select j -> 'rows' -> 1 ->> 'outcome' from mr), 'action_taken', 'the warned case reads "action taken" and no more');
select is((select j -> 'rows' -> 1 ->> 'job_title' from mr), 'Tap job', 'each report shows its job');
select ok((select (j -> 'rows' -> 1) ?& array['created_at', 'updated_at', 'resolved_at', 'details'] from mr), 'with the dates and the reporter''s own words');
select is((select (j -> 'rows' -> 1) ?| array['against_id', 'action', 'action_reason', 'assigned_to', 'against'] from mr), false, 'and none of the staff-only fields');
select is((select jsonb_array_length(public.my_reports(1, 0) -> 'rows')), 1, 'paging: a page of one');
select is((select public.my_reports(1, 1) -> 'rows' -> 0 ->> 'code'), (select j -> 'rows' -> 1 ->> 'code' from mr), 'paging: the second page');
select is((select jsonb_array_length(public.my_reports(1000, -5) -> 'rows')), 2, 'a huge limit and a negative offset are clamped, not an error');
select tests.back();
update public.reports set status = 'in_review', action = null, resolved_at = null where id = '00000000-0000-0000-0000-00000000d002';
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select public.my_reports(20, 0) -> 'rows' -> 0 ->> 'status'), 'under_review', 'an open case reads "under review"');
select is((select public.my_reports(20, 0) -> 'rows' -> 0 ->> 'outcome'), null, 'and has no outcome yet');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select public.my_reports(20, 0) ->> 'total'), '0', 'another worker sees none of them');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000c1');
select is((select public.my_reports(20, 0) ->> 'total'), '0', 'the person reported sees none of them');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(tests.msg($$select public.my_reports(20, 0)$$), 'not available', 'staff use the admin screens, not my_reports');
select tests.back();
select is(has_function_privilege('anon', 'public.my_reports(integer, integer)', 'execute'), false, 'anon cannot call my_reports');

-- 7. Suspension notices and end dates --------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(tests.msg($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b2', true, 'Rude behaviour', 0)$$), 'a suspension lasts 1 to 365 days (leave it empty to suspend until staff lift it)', 'zero days is refused');
select is(tests.msg($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b2', true, 'Rude behaviour', 400)$$), 'a suspension lasts 1 to 365 days (leave it empty to suspend until staff lift it)', 'so is more than a year');
select is(tests.msg($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b2', false, 'Cleared', 3)$$), 'a suspension lasts 1 to 365 days (leave it empty to suspend until staff lift it)', 'and a number of days on a reactivation');
select lives_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b2', true, 'Rude behaviour at the door', 7)$$, 'staff suspend a worker for 7 days');
select tests.back();
select is(tests.notices('00000000-0000-0000-0000-0000000000b2', 'account_suspended'), 1::bigint, 'the worker gets one suspension notice');
select is(tests.scalar($$select payload ->> 'message' from public.notifications where type = 'account_suspended'$$), 'Rude behaviour at the door', 'with the reason');
select ok((select (payload ->> 'until')::timestamptz between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour' from public.notifications where type = 'account_suspended'), 'and the end date, 7 days away');
select is((select account_status::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'suspended', 'the account is suspended');
select ok((select suspended_until is not null from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'with an end date');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select ok((public.admin_user_detail('00000000-0000-0000-0000-0000000000b2') ->> 'suspended_until') is not null, 'the staff user screen gets the end date');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.notifications where type = 'account_suspended'), 1::bigint, 'the suspended worker can still read the notice');
select is((select public.my_reports(20, 0) ->> 'total'), '0', 'and still open My Reports');
select tests.back();
select is(tests.msg($$select private.lift_expired_suspensions()$$), '', 'the sweep runs');
select is((select account_status::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'suspended', 'and does not lift a suspension that has not ended');

-- the end date passes: the sweep lifts it and tells the worker, once
update public.profiles set suspended_until = now() - interval '1 minute' where id = '00000000-0000-0000-0000-0000000000b2';
select is(private.lift_expired_suspensions(), 1, 'the sweep lifts one expired suspension');
select is((select account_status::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'active', 'the account is active again');
select is(tests.notices('00000000-0000-0000-0000-0000000000b2', 'account_reactivated'), 1::bigint, 'the worker is told');
select is(tests.scalar($$select payload ->> 'expired' from public.notifications where type = 'account_reactivated'$$), 'true', 'and that it ended by itself');
select is(private.lift_expired_suspensions(), 0, 'a second sweep does nothing');
select is(tests.notices('00000000-0000-0000-0000-0000000000b2', 'account_reactivated'), 1::bigint, 'and sends nothing more');
select is((select count(*)::int from public.audit_log where action = 'account_reactivated' and record_id = '00000000-0000-0000-0000-0000000000b2' and actor_id is null), 1, 'the automatic lift is audited');
select ok((select suspended_until is null and suspension_reason is null from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'the end date and reason are cleared');

-- an open-ended suspension, lifted by staff: one notice, not two
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select lives_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b2', true, 'Second incident')$$, 'staff suspend again with no end date');
select tests.back();
select ok((select (payload ->> 'until') is null from public.notifications where type = 'account_suspended' and payload ->> 'message' = 'Second incident'), 'the notice has no end date');
update public.profiles set suspended_at = now() - interval '30 days' where id = '00000000-0000-0000-0000-0000000000b2';
select is(private.lift_expired_suspensions(), 0, 'the sweep never lifts an open-ended suspension');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select lives_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b2', false, 'Cleared after a talk')$$, 'staff lift it');
select tests.back();
select is(tests.notices('00000000-0000-0000-0000-0000000000b2', 'account_reactivated'), 2::bigint, 'one more "active again" notice, not two');
select is(tests.scalar($$select count(*) from public.notifications where type = 'account_reactivated' and payload ->> 'expired' = 'false'$$), '1', 'and that one does not say it expired (the other one does)');
select is(tests.notices('00000000-0000-0000-0000-0000000000b2', 'account_suspended'), 2::bigint, 'each suspension is announced once');

-- a suspension made by a report decision is announced too
insert into public.reports (id, job_id, reporter_id, against_id, reporter_role, kind, reason_text) values
  ('00000000-0000-0000-0000-00000000d003', (select j1 from t), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'resident', 'unsafe', 'I felt unsafe');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select lives_ok($$select public.admin_report_decide('00000000-0000-0000-0000-00000000d003', 'suspend', 'Threatened the resident')$$, 'staff suspend through a report decision');
select tests.back();
select is(tests.scalar($$select payload ->> 'message' from public.notifications where type = 'account_suspended' and user_id = '00000000-0000-0000-0000-0000000000b1'$$), 'Threatened the resident', 'the worker is told, with the reason');
select is(tests.notices('00000000-0000-0000-0000-0000000000c1', 'report_resolved'), 1::bigint, 'and the resident who reported is told it is resolved');
select is(tests.scalar($$select payload ->> 'outcome' from public.notifications where type = 'report_resolved' and user_id = '00000000-0000-0000-0000-0000000000c1'$$), 'action_taken', 'with "action taken" and no mention of a suspension');

-- 8. A staff warning always reaches the worker, even for a job whose quote was rejected --------------------------------------
insert into public.quotes (job_id, worker_id, labour, materials, visit_start, visit_end, status, decided_at)
  values ((select j2 from t), '00000000-0000-0000-0000-0000000000b1', 2000, 500, now() + interval '1 day', now() + interval '1 day 2 hours', 'rejected', now());
select private.notify('00000000-0000-0000-0000-0000000000b1', 'job_started', (select j2 from t), '{}'::jsonb);
select is(tests.notices('00000000-0000-0000-0000-0000000000b1', 'job_started'), 0::bigint, '(control) a job notice for a job the worker was rejected on is still dropped');
select private.notify('00000000-0000-0000-0000-0000000000b1', 'report_warning', (select j2 from t), '{"message": "Please be on time"}'::jsonb);
select is(tests.notices('00000000-0000-0000-0000-0000000000b1', 'report_warning'), 1::bigint, 'but a staff warning is delivered');

-- 9. The in-app notice is stored whatever happens to the push ---------------------------------------------------------------
select is((select count(*) from public.notifications where type in ('report_received', 'report_in_review', 'report_resolved', 'account_suspended', 'account_reactivated') and push_sent_at is not null), 0::bigint, 'notices are saved first; the push is sent afterwards by the retrying function and never blocks them');

select * from finish();
rollback;
