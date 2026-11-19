-- Migration 0067: worker requests (support, document update, change alerts), staff answers, my phones.
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
create function tests.rid(p text) returns uuid language sql security definer as $$ select id from public.worker_requests where subject = p or kind = p order by created_at limit 1 $$;
grant execute on function tests.rid(text) to authenticated;

insert into auth.users (id, aud, role, email, phone) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin-a@test.dev', null),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'res@test.dev', null),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', null, '923213334444'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', null, '923213335555');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin-a@test.dev', '+923009990001', 'approved'),
  ('00000000-0000-0000-0000-0000000000c1', 'resident', 'Rida Resident', 'res@test.dev', '+923001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Ali Raza', null, '+923213334444', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Pending Pat', null, '+923213335555', 'pending');
insert into public.worker_details (profile_id) values ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000b102', '00000000-0000-0000-0000-0000000000b1');
insert into public.admin_verified_sessions (session_id, user_id) values ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1');
insert into public.verification_documents (profile_id, doc_type, storage_path) values
  ('00000000-0000-0000-0000-0000000000b1', 'police_cert', '00000000-0000-0000-0000-0000000000b1/police_cert-1.pdf');
insert into public.device_tokens (user_id, push_token, platform) values
  ('00000000-0000-0000-0000-0000000000b1', 'phone-this', 'android'), ('00000000-0000-0000-0000-0000000000b1', 'phone-old', 'android');

-- 1. wrong callers on the staff functions --------------------------------------------------------------------------
create temp table calls (sql text);
insert into calls values
  ('select public.admin_requests_list(null, ''open'', 25, 0)'),
  ('select public.admin_requests_counts()'),
  ('select public.admin_request_reply(gen_random_uuid(), ''hello there'')'),
  ('select public.admin_request_decide(gen_random_uuid(), ''approve'', null)'),
  ('select public.admin_request_ack(gen_random_uuid())');
grant select on calls to authenticated;
create function tests.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when sqlstate '42501' then
  return true;
end $$;
grant execute on function tests.refused(text) to authenticated;
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');
select is((select count(*) from calls c where not tests.refused(c.sql)), 0::bigint, 'a password-only admin session is refused by every staff function');
select tests.act('00000000-0000-0000-0000-0000000000c1');
select is((select count(*) from calls c where not tests.refused(c.sql)), 0::bigint, 'a resident is refused by every staff function');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from calls c where not tests.refused(c.sql)), 0::bigint, 'a worker is refused by every staff function');
select tests.back();
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('admin_requests_list','admin_requests_counts','admin_request_reply','admin_request_decide','admin_request_ack','submit_support_request','submit_document_update','my_requests','my_sessions','sign_out_other_sessions')
              and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'signed-out callers can call none of the new functions');
select is(has_table_privilege('authenticated', 'public.worker_requests', 'select'), false, 'the table is closed to the apps');

-- 2. support -------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.submit_support_request('hi', 'short body ok') $$, null, 'write a short title of 3 to 80 characters', 'a tiny title is refused');
select throws_ok($$ select public.submit_support_request('Title ok', 'x') $$, null, 'describe the problem in 5 to 1000 characters', 'a tiny body is refused');
select lives_ok($$ select public.submit_support_request('Wrong phase listed', 'My areas show phase 5 but I work in phase 6.') $$, 'a worker sends a message');
select lives_ok($$ select public.submit_support_request('Second', 'Another question here.') $$, 'a second');
select lives_ok($$ select public.submit_support_request('Third', 'Another question here.') $$, 'a third');
select throws_ok($$ select public.submit_support_request('Fourth', 'Another question here.') $$, null, 'you already have 3 open messages; wait for DHA to answer', 'only 3 open at a time');
select is((select count(*) from public.my_requests()), 3::bigint, 'the worker sees their own messages');
select tests.act('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.submit_support_request('Customer', 'A customer message.') $$, null, 'a customer cannot send a worker message');
select throws_ok($$ select * from public.my_requests() $$, null, 'a customer cannot read worker requests');
select tests.back();

-- 3. staff answer (a verified admin session) -----------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is((select (public.admin_requests_counts() ->> 'support')::int), 3, 'staff see 3 open messages');
select is((select jsonb_array_length(public.admin_requests_list('support', 'open', 25, 0) -> 'rows')), 3, 'listed');
select throws_ok($$ select public.admin_request_reply(tests.rid('Wrong phase listed'), 'x') $$, null, 'write an answer of 2 to 1000 characters', 'an empty answer is refused');
select lives_ok($$ select public.admin_request_reply(tests.rid('Wrong phase listed'), 'Fixed, please check My areas.') $$, 'staff answer');
select throws_ok($$ select public.admin_request_reply(tests.rid('Wrong phase listed'), 'Again') $$, null, 'this message was already answered', 'only once');
select tests.back();
select is((select status from public.worker_requests where subject = 'Wrong phase listed'), 'done', 'the message is closed');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'staff_message'), 1::bigint, 'the worker got a notice with the answer');
select is((select count(*) from public.audit_log where action = 'support_answered'), 1::bigint, 'the answer is audited');

-- 4. document update -----------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.submit_document_update('police_cert', '00000000-0000-0000-0000-0000000000b2/update-police_cert-1-a.pdf') $$, null, 'use the application screens until DHA staff approve you', 'a worker who is not approved uses the application');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.submit_document_update('police_cert', '00000000-0000-0000-0000-0000000000b2/update-police_cert-1-a.pdf') $$, null, 'invalid file path', 'another worker folder is refused');
select throws_ok($$ select public.submit_document_update('police_cert', '00000000-0000-0000-0000-0000000000b1/police_cert-9.pdf') $$, null, 'invalid file path', 'only update files are accepted');
select lives_ok($$ select public.submit_document_update('police_cert', '00000000-0000-0000-0000-0000000000b1/update-police_cert-1-a.pdf') $$, 'an approved worker sends a new certificate');
select lives_ok($$ select public.submit_document_update('police_cert', '00000000-0000-0000-0000-0000000000b1/update-police_cert-2-b.pdf') $$, 'a newer file replaces the waiting one');
select lives_ok($$ select public.submit_document_update('profile_photo', '00000000-0000-0000-0000-0000000000b1/update-profile_photo-1-c.jpg') $$, 'and a photo');
select tests.back();
select is((select count(*) from public.worker_requests where kind = 'document' and status = 'open'), 2::bigint, 'two documents wait for staff');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select throws_ok($$ select public.admin_request_decide(tests.rid('police_cert'), 'reject', '') $$, null, 'write the reason for the worker (at least 3 characters)', 'a rejection needs a reason');
select lives_ok($$ select public.admin_request_decide(tests.rid('police_cert'), 'approve', null) $$, 'staff approve the certificate');
select lives_ok($$ select public.admin_request_decide(tests.rid('profile_photo'), 'reject', 'The face is not clear.') $$, 'and reject the photo');
select throws_ok($$ select public.admin_request_decide(tests.rid('police_cert'), 'approve', null) $$, null, 'this request was already decided', 'a decision is final');
select tests.back();
select is((select storage_path from public.verification_documents where profile_id = '00000000-0000-0000-0000-0000000000b1' and doc_type = 'police_cert'), '00000000-0000-0000-0000-0000000000b1/update-police_cert-2-b.pdf', 'approval swapped the verification file');
select is((select avatar_path from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), null, 'a rejected photo did not become the picture');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'staff_message'), 3::bigint, 'the worker was told about both decisions');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.my_requests() where kind = 'document' and status in ('approved', 'rejected')), 2::bigint, 'the worker sees both decisions');
select is((select staff_reply from public.my_requests() where doc_type = 'profile_photo'), 'The face is not clear.', 'with the reason');
select tests.back();

-- 5. name and number changes leave an alert ------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select public.change_my_name('Ali Raza Khan');
select tests.back();
select is((select count(*) from public.worker_requests where kind = 'name_change' and old_value = 'Ali Raza' and new_value = 'Ali Raza Khan'), 1::bigint, 'a name change makes a staff alert');
update auth.users set phone_change = '923007770001', phone_change_token = 'x' where id = '00000000-0000-0000-0000-0000000000b1';
update auth.users set phone = '923007770001', phone_change = '', phone_change_token = '' where id = '00000000-0000-0000-0000-0000000000b1';
select is((select new_value from public.worker_requests where kind = 'phone_change'), '+923007770001', 'a number change makes a staff alert');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is((select (public.admin_requests_counts() ->> 'changes')::int), 2, 'staff see the two alerts');
select is((select jsonb_array_length(public.admin_requests_list('changes', 'open', 25, 0) -> 'rows')), 2, 'the changes tab lists both kinds');
select lives_ok($$ select public.admin_request_ack(tests.rid('name_change')) $$, 'staff mark one reviewed');
select throws_ok($$ select public.admin_request_ack(tests.rid('name_change')) $$, null, 'request not found', 'only once');
select tests.back();

-- 6. my phones ------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000b101');
select is((select count(*) from public.my_sessions()), 2::bigint, 'the worker sees two phones');
select is((select is_current from public.my_sessions() order by is_current desc limit 1), true, 'this one is marked and listed first');
select is(public.sign_out_other_sessions('phone-this')::bigint, 1::bigint, 'one other phone is signed out');
select is((select count(*) from public.my_sessions()), 1::bigint, 'only this phone is left');
select tests.back();
select is((select count(*) from public.device_tokens where user_id = '00000000-0000-0000-0000-0000000000b1'), 1::bigint, 'the other phone stops receiving pushes');
select is((select push_token from public.device_tokens where user_id = '00000000-0000-0000-0000-0000000000b1'), 'phone-this', 'only this phone keeps its registration');
select tests.act('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.sign_out_other_sessions(null) $$, null, 'a customer cannot use it');
select tests.back();
select is((select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000a1'), 2::bigint, 'nobody else lost a session');

select * from finish();
rollback;
