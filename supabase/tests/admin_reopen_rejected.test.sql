-- Migration 0054: staff can let a rejected applicant apply again (rejected -> needs_changes, with a reason).
-- The wrong people are tried first, then a stale session, then a fresh verified admin.
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
  ('00000000-0000-0000-0000-0000000000b4', 'authenticated', 'authenticated', 'w4@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status, verification_reason, account_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin@test.dev', '03009990001', 'approved', null, 'active'),
  ('00000000-0000-0000-0000-0000000000c1', 'resident', 'Rida', 'res@test.dev', '03001110001', 'approved', null, 'active'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Rejected One', 'w1@test.dev', '03213334444', 'rejected', 'CNIC does not match', 'active'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Rejected Suspended', 'w2@test.dev', '03005556666', 'rejected', 'Bad documents', 'suspended'),
  ('00000000-0000-0000-0000-0000000000b3', 'worker', 'Still Pending', 'w3@test.dev', '03007778888', 'pending', null, 'active'),
  ('00000000-0000-0000-0000-0000000000b4', 'worker', 'Approved', 'w4@test.dev', '03009990004', 'approved', null, 'active');

-- s1: verified and fresh. s2: verified but the last code was 1 hour ago. s3: password only.
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a103', '00000000-0000-0000-0000-0000000000a1');
insert into public.admin_verified_sessions (session_id, user_id, verified_at, fresh_at) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1', now(), now()),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1', now() - interval '1 hour', now() - interval '1 hour');

-- 1. The wrong people ------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103');   -- password only
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b1', 'Please fix your CNIC photo')$$, '42501', 'not available', 'password-only admin: refused');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b1', 'Please fix your CNIC photo')$$, '42501', 'not available', 'resident: refused');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b1', 'Let me back in please')$$, '42501', 'not available', 'the rejected worker cannot reopen their own application');
select tests.back();
select is(has_function_privilege('anon', 'public.admin_reopen_rejected(uuid, text)', 'execute'), false, 'anon cannot reopen');

-- 2. A stale session needs a new code --------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b1', 'Please fix your CNIC photo')$$, 'P0001', 'confirm with a new code', 'a stale session is asked for a code');
select tests.back();

-- 3. A fresh verified admin -------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b1', null)$$, 'P0001', 'write a reason the applicant will see', 'a reason is required');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b1', '  ')$$, 'P0001', 'write a reason the applicant will see', 'a blank reason does not count');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b1', repeat('x', 501))$$, 'P0001', 'the reason is too long (500 characters at most)', 'a 501-character reason is refused');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b3', 'Please fix your CNIC photo')$$, 'P0001', 'only a rejected application can be opened again', 'a pending application is not reopened');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b4', 'Please fix your CNIC photo')$$, 'P0001', 'only a rejected application can be opened again', 'an approved worker is not reopened');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b2', 'Please fix your documents')$$, 'P0001', 'this account is suspended', 'a suspended account is not reopened');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000a1', 'Please fix your documents')$$, 'P0001', 'you cannot decide on your own account', 'staff cannot reopen themselves');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-000000000099', 'Please fix your documents')$$, 'P0001', 'no such application', 'unknown profile');
select lives_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b1', '  Upload a clear CNIC photo and apply again.  ')$$, 'a rejected worker can be opened again');
select throws_ok($$select public.admin_reopen_rejected('00000000-0000-0000-0000-0000000000b1', 'Upload a clear CNIC photo and apply again.')$$, 'P0001', 'only a rejected application can be opened again', 'a second reopen is refused');
select tests.back();

select is((select verification_status::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'needs_changes', 'the worker is back to needs changes');
select is((select verification_reason from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'Upload a clear CNIC photo and apply again.', 'the trimmed reason is stored for the worker to read');
select is((select count(*)::int from public.verification_decisions where profile_id = '00000000-0000-0000-0000-0000000000b1' and decision = 'ask_for_changes'), 1, 'the decision is recorded');
select is((select count(*)::int from public.audit_log where action = 'verification_reopened' and record_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'and audited');
select is((select count(*)::int from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'verification_decided'
            and payload->>'decision' = 'ask_for_changes' and payload->>'reason' = 'Upload a clear CNIC photo and apply again.'), 1, 'the worker is told, with the reason');

-- 4. The worker can fix things and send the application again ------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.update_my_profile(p_gender => 'male')$$, 'the reopened worker can edit their profile again');
select tests.back();

select * from finish();
rollback;
