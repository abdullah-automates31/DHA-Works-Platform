-- Migration 0065: worker push switches (set_notification_preference + the BEFORE INSERT trigger).
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
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida One', 'res1@test.dev', '03001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman One', 'w1@test.dev', '03003334444', 'approved');
insert into public.worker_details (profile_id) values ('00000000-0000-0000-0000-0000000000b1');

-- defaults: everything on
select is((select notify_new_jobs and notify_job_updates and notify_report_updates and notify_announcements from public.worker_details), true, 'all four switches start on');

-- the worker switches things off
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.set_notification_preference('new_jobs', false) $$, 'new jobs off');
select lives_ok($$ select public.set_notification_preference('job_updates', false) $$, 'job updates off');
select lives_ok($$ select public.set_notification_preference('report_updates', false) $$, 'report updates off');
select lives_ok($$ select public.set_notification_preference('announcements', false) $$, 'announcements off');
select is((select notify_new_jobs or notify_job_updates or notify_report_updates or notify_announcements from public.worker_details), false, 'stored');
select throws_ok($$ select public.set_notification_preference('new_jobs', null) $$, 'choose on or off', 'null refused');
select throws_ok($$ select public.set_notification_preference('verification_decided', false) $$, 'unknown notification setting', 'a critical kind cannot be switched');
select throws_ok($$ select public.set_notification_preference('job_updates; drop table x', false) $$, 'unknown notification setting', 'unknown keys refused');
select throws_ok($$ update public.worker_details set notify_new_jobs = true $$, '42501', 'permission denied for table worker_details', 'the table cannot be written directly');
select tests.back();

-- inserts: switched-off kinds are marked handled (no push); critical ones and job_reminder are not
insert into public.notifications (user_id, type) values
  ('00000000-0000-0000-0000-0000000000b1', 'new_job'),
  ('00000000-0000-0000-0000-0000000000b1', 'quote_accepted'),
  ('00000000-0000-0000-0000-0000000000b1', 'report_resolved'),
  ('00000000-0000-0000-0000-0000000000b1', 'staff_message'),
  ('00000000-0000-0000-0000-0000000000b1', 'verification_decided'),
  ('00000000-0000-0000-0000-0000000000b1', 'report_warning'),
  ('00000000-0000-0000-0000-0000000000b1', 'busy_eta_needed'),
  ('00000000-0000-0000-0000-0000000000b1', 'account_suspended'),
  ('00000000-0000-0000-0000-0000000000b1', 'job_reminder');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1'), 9::bigint, 'every notice is still stored for the in-app list');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type in ('new_job', 'quote_accepted', 'report_resolved', 'staff_message') and push_sent_at is not null), 4::bigint, 'the four switched-off kinds get no push');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type in ('verification_decided', 'report_warning', 'busy_eta_needed', 'account_suspended', 'job_reminder') and push_sent_at is null), 5::bigint, 'critical kinds and reminders still go out');

-- switching back on restores delivery
select tests.act('00000000-0000-0000-0000-0000000000b1');
select public.set_notification_preference('new_jobs', true);
select tests.back();
insert into public.notifications (user_id, type) values ('00000000-0000-0000-0000-0000000000b1', 'new_job');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'new_job' and push_sent_at is null), 1::bigint, 'switched back on: pushed again');

-- residents are never filtered, and cannot use the worker switch
insert into public.notifications (user_id, type) values ('00000000-0000-0000-0000-0000000000a1', 'quote_received');
select is((select push_sent_at from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1'), null::timestamptz, 'a customer notice is untouched');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.set_notification_preference('new_jobs', false) $$, null, 'a customer cannot call it');
select tests.back();
select is(has_function_privilege('anon', 'public.set_notification_preference(text, boolean)', 'execute'), false, 'signed-out callers cannot call it');
select is(has_function_privilege('authenticated', 'private.apply_push_preferences()', 'execute'), false, 'the trigger function is not callable by apps');

-- get_my_document_summary: dates and counts only, for the caller only, after submission too
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.get_my_document_summary() where doc_type is not null), 0::bigint, 'no documents yet: one empty row only');
select is((select reference_count from public.get_my_document_summary() limit 1), 0, 'and no references');
select tests.back();
insert into public.verification_documents (profile_id, doc_type, storage_path, uploaded_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'cnic_front', '00000000-0000-0000-0000-0000000000b1/cnic_front-1.jpg', '2026-11-01 10:00+00'),
  ('00000000-0000-0000-0000-0000000000b1', 'profile_photo', '00000000-0000-0000-0000-0000000000b1/profile_photo-1.jpg', '2026-11-02 10:00+00');
insert into public.worker_references (worker_id, name, phone) values ('00000000-0000-0000-0000-0000000000b1', 'Ref One', '03001234567');
select tests.act('00000000-0000-0000-0000-0000000000b1');
-- the worker is approved, so the table itself stays closed to them (no read-back) ...
select is((select count(*) from public.verification_documents), 0::bigint, 'an approved worker still cannot read the document rows');
-- ... but the summary shows type and date
select is((select count(*) from public.get_my_document_summary() where doc_type is not null), 2::bigint, 'the summary lists the two documents');
select is((select uploaded_at from public.get_my_document_summary() where doc_type = 'cnic_front'), '2026-11-01 10:00+00'::timestamptz, 'with their upload time');
select is((select max(reference_count) from public.get_my_document_summary()), 1, 'and the number of references');
select is((select count(*) from (select to_jsonb(s) as j from public.get_my_document_summary() s) x where j::text like '%storage%' or j::text like '%.jpg%'), 0::bigint, 'never a file path');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select * from public.get_my_document_summary() $$, null, 'a customer cannot call it');
select tests.back();
select is(has_function_privilege('anon', 'public.get_my_document_summary()', 'execute'), false, 'signed-out callers cannot call it');

select * from finish();
rollback;
