-- Migration 0068: admin "Forgot password?". Callers and grants first, then issuing a code, checking it, the password rules,
-- what a successful reset ends, the lock on other password changes, and the password-session rule for admin codes.
begin;
select no_plan();

create schema tests;
create temp table codes (k text, code text);

insert into auth.users (id, aud, role, email, encrypted_password) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'Admin-A@test.dev', extensions.crypt('old password 123', extensions.gen_salt('bf', 4))),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'admin-b@test.dev', extensions.crypt('other admin pass', extensions.gen_salt('bf', 4))),
  ('00000000-0000-0000-0000-0000000000a5', 'authenticated', 'authenticated', 'admin-suspended@test.dev', extensions.crypt('suspended pass 1', extensions.gen_salt('bf', 4))),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'res@test.dev', extensions.crypt('resident pass 12', extensions.gen_salt('bf', 4))),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev', extensions.crypt('worker pass 123', extensions.gen_salt('bf', 4)));
insert into public.profiles (id, role, full_name, email, phone, verification_status, account_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin-a@test.dev', '03009990001', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'Staff B', 'admin-b@test.dev', '03009990002', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000a5', 'admin', 'Staff Suspended', 'admin-suspended@test.dev', '03009990005', 'approved', 'suspended'),
  ('00000000-0000-0000-0000-0000000000c1', 'resident', 'Rida Resident', 'res@test.dev', '03001110001', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Ali Raza', 'w1@test.dev', '03213334444', 'approved', 'active');
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2');
insert into public.admin_verified_sessions (session_id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2');

-- 1. Who may call --------------------------------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.admin_reset_issue(text)', 'execute'), false, 'anon cannot issue a reset code');
select is(has_function_privilege('authenticated', 'public.admin_reset_issue(text)', 'execute'), false, 'a signed-in user cannot issue a reset code');
select is(has_function_privilege('service_role', 'public.admin_reset_issue(text)', 'execute'), true, 'the Edge Function (service role) can');
select is(has_function_privilege('anon', 'public.admin_reset_confirm(text,text,text)', 'execute'), false, 'anon cannot confirm a reset');
select is(has_function_privilege('authenticated', 'public.admin_reset_confirm(text,text,text)', 'execute'), false, 'a signed-in user cannot confirm a reset');
select is(has_function_privilege('service_role', 'public.admin_reset_confirm(text,text,text)', 'execute'), true, 'the Edge Function (service role) can confirm');
select is(has_table_privilege('anon', 'public.admin_reset_challenges', 'select'), false, 'anon cannot read reset codes');
select is(has_table_privilege('authenticated', 'public.admin_reset_challenges', 'select'), false, 'a signed-in user cannot read reset codes');
select is((select relrowsecurity from pg_class where oid = 'public.admin_reset_challenges'::regclass), true, 'row level security is on for reset codes');

-- 2. Issuing a code ---------------------------------------------------------------------------------------------------
select is(public.admin_reset_issue('nobody@test.dev') ->> 'status', 'not_admin', 'an unknown email gets not_admin');
select is(public.admin_reset_issue('') ->> 'status', 'not_admin', 'an empty email gets not_admin');
select is(public.admin_reset_issue(null) ->> 'status', 'not_admin', 'a null email gets not_admin');
select is(public.admin_reset_issue('res@test.dev') ->> 'status', 'not_admin', 'a resident gets not_admin');
select is(public.admin_reset_issue('w1@test.dev') ->> 'status', 'not_admin', 'a worker gets not_admin');
select is(public.admin_reset_issue('admin-suspended@test.dev') ->> 'status', 'not_admin', 'a suspended admin gets not_admin');
select is(public.admin_reset_issue('admin-a@test.dev%') ->> 'status', 'not_admin', 'a wildcard is not a match');
select is((select count(*) from public.admin_reset_challenges), 0::bigint, 'nothing was stored for any of those');

insert into codes select 'a1', (public.admin_reset_issue('  ADMIN-a@TEST.dev ') ->> 'code');
select is((select code ~ '^[0-9]{6}$' from codes where k = 'a1'), true, 'an active admin gets a six-digit code (email matched ignoring case and spaces)');
select is(public.admin_reset_issue('admin-a@test.dev') ->> 'status', 'wait', 'a second code within a minute is refused');
select is((select count(*) from public.admin_reset_challenges where user_id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint, 'only one code exists');
select is((select code_hash <> (select code from codes where k = 'a1') from public.admin_reset_challenges limit 1), true, 'the code is stored only as a hash');
select is((select count(*) from public.audit_log where action = 'admin_reset_requested' and actor_id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint, 'the request is audited');
select is((select count(*) from public.audit_log where new_data::text like '%' || (select code from codes where k = 'a1') || '%' or reason like '%' || (select code from codes where k = 'a1') || '%'), 0::bigint, 'the audit log never holds the code');
select is((public.admin_reset_issue('admin-b@test.dev') ->> 'email'), 'admin-b@test.dev', 'the answer carries the address on the account (the one to mail)');
delete from public.admin_reset_challenges where user_id = '00000000-0000-0000-0000-0000000000a2';

update public.admin_reset_challenges set created_at = now() - interval '2 minutes' where user_id = '00000000-0000-0000-0000-0000000000a1';
insert into codes select 'a1b', (public.admin_reset_issue('admin-a@test.dev') ->> 'code');
select is((select consumed from public.admin_reset_challenges where user_id = '00000000-0000-0000-0000-0000000000a1' order by created_at asc limit 1), true, 'a new code invalidates the older one');
-- more than five an hour
do $$
declare i int;
begin
  for i in 1..4 loop
    update public.admin_reset_challenges set created_at = now() - interval '5 minutes' where user_id = '00000000-0000-0000-0000-0000000000a1';
    perform public.admin_reset_issue('admin-a@test.dev');
  end loop;
end $$;
update public.admin_reset_challenges set created_at = now() - interval '2 minutes' where user_id = '00000000-0000-0000-0000-0000000000a1' and created_at > now() - interval '1 minute';
select is(public.admin_reset_issue('admin-a@test.dev') ->> 'status', 'limit', 'more than five codes an hour is refused');
delete from public.admin_reset_challenges;

-- 3. Checking the code ---------------------------------------------------------------------------------------------------
select is(public.admin_reset_confirm('admin-a@test.dev', '123456', 'a brand new password') , 'none', 'no open code gives none');
insert into codes select 'c1', (public.admin_reset_issue('admin-a@test.dev') ->> 'code');
select is(public.admin_reset_confirm('nobody@test.dev', (select code from codes where k = 'c1'), 'a brand new password'), 'none', 'a code cannot be used with another email');
select is(public.admin_reset_confirm('admin-b@test.dev', (select code from codes where k = 'c1'), 'a brand new password'), 'none', 'a code for one admin does not work for another admin');
select is(public.admin_reset_confirm('res@test.dev', (select code from codes where k = 'c1'), 'a brand new password'), 'none', 'a resident email gives none');
select is(public.admin_reset_confirm('admin-a@test.dev', null, 'a brand new password'), 'wrong', 'a null code is wrong');
select is(public.admin_reset_confirm('admin-a@test.dev', 'abcdef', 'a brand new password'), 'wrong', 'letters are wrong');
select is(public.admin_reset_confirm('admin-a@test.dev', '12345', 'a brand new password'), 'wrong', 'five digits are wrong');
select is(public.admin_reset_confirm('admin-a@test.dev', '1234567', 'a brand new password'), 'wrong', 'seven digits are wrong');
select is((select tries from public.admin_reset_challenges where not consumed), 4::smallint, 'each wrong guess is counted and kept');
select is(public.admin_reset_confirm('admin-a@test.dev', case when (select code from codes where k = 'c1') = '000000' then '000001' else '000000' end, 'a brand new password'), 'locked', 'the fifth wrong guess locks the code');
select is(public.admin_reset_confirm('admin-a@test.dev', (select code from codes where k = 'c1'), 'a brand new password'), 'locked', 'a locked code stays locked even with the right code');
select is((select encrypted_password = extensions.crypt('old password 123', encrypted_password) from auth.users where id = '00000000-0000-0000-0000-0000000000a1'), true, 'the password did not change');
select is((select count(*) from public.audit_log where action = 'admin_reset_locked'), 1::bigint, 'the lock is audited');
select is((select count(*) from public.audit_log where action = 'admin_reset_code_wrong'), 5::bigint, 'each wrong guess is audited');
delete from public.admin_reset_challenges;

-- the hourly lock across codes
insert into public.admin_reset_challenges (user_id, code_hash, tries, consumed, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'x', 5, true, now() - interval '30 minutes'),
  ('00000000-0000-0000-0000-0000000000a1', 'x', 5, true, now() - interval '20 minutes');
insert into codes select 'c2', (public.admin_reset_issue('admin-a@test.dev') ->> 'code');
select is(public.admin_reset_confirm('admin-a@test.dev', (select code from codes where k = 'c2'), 'a brand new password'), 'locked', 'ten wrong tries in an hour lock the reset even with the right code');
delete from public.admin_reset_challenges;

-- an expired code
insert into codes select 'c3', (public.admin_reset_issue('admin-a@test.dev') ->> 'code');
update public.admin_reset_challenges set expires_at = now() - interval '1 second';
select is(public.admin_reset_confirm('admin-a@test.dev', (select code from codes where k = 'c3'), 'a brand new password'), 'expired', 'an expired code is refused');
select is(public.admin_reset_confirm('admin-a@test.dev', (select code from codes where k = 'c3'), 'a brand new password'), 'none', 'and it is used up');
delete from public.admin_reset_challenges;

-- 4. Password rules ---------------------------------------------------------------------------------------------------
insert into codes select 'c4', (public.admin_reset_issue('admin-a@test.dev') ->> 'code');
select is(public.admin_reset_confirm('admin-a@test.dev', (select code from codes where k = 'c4'), 'short pass'), 'weak', 'ten characters are too short');
select is(public.admin_reset_confirm('admin-a@test.dev', (select code from codes where k = 'c4'), null), 'weak', 'a null password is refused');
select is(public.admin_reset_confirm('admin-a@test.dev', (select code from codes where k = 'c4'), repeat('x', 73)), 'weak', '73 bytes are too long for bcrypt');
select is(public.admin_reset_confirm('admin-a@test.dev', (select code from codes where k = 'c4'), repeat('é', 37)), 'weak', '74 bytes of two-byte letters are too long');
select is(public.admin_reset_confirm('admin-a@test.dev', (select code from codes where k = 'c4'), 'Admin-A@test.dev'), 'weak', 'the email address is not a password');
select is((select tries from public.admin_reset_challenges where not consumed), 0::smallint, 'a weak password does not use up tries');
select is((select consumed from public.admin_reset_challenges limit 1), false, 'and the code stays valid');
select is((select encrypted_password = extensions.crypt('old password 123', encrypted_password) from auth.users where id = '00000000-0000-0000-0000-0000000000a1'), true, 'the old password still works after weak attempts');

-- 5. A good reset ---------------------------------------------------------------------------------------------------------
select is(public.admin_reset_confirm('Admin-A@test.dev', (select code from codes where k = 'c4'), 'a brand new password'), 'ok', 'the right code and a good password reset it');
select is((select encrypted_password = extensions.crypt('a brand new password', encrypted_password) from auth.users where id = '00000000-0000-0000-0000-0000000000a1'), true, 'the new password works (bcrypt hash)');
select is((select encrypted_password = extensions.crypt('old password 123', encrypted_password) from auth.users where id = '00000000-0000-0000-0000-0000000000a1'), false, 'the old password no longer works');
select is((select left(encrypted_password, 4) from auth.users where id = '00000000-0000-0000-0000-0000000000a1'), '$2a$', 'the hash has the format the auth service reads');
select is((select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000a1'), 0::bigint, 'every session of that admin ended');
select is((select count(*) from public.admin_verified_sessions where user_id = '00000000-0000-0000-0000-0000000000a1'), 0::bigint, 'and so did the verified-session marks');
select is((select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000a2'), 1::bigint, 'another admin keeps their session');
select is((select encrypted_password = extensions.crypt('other admin pass', encrypted_password) from auth.users where id = '00000000-0000-0000-0000-0000000000a2'), true, 'and their password');
select is((select count(*) from public.audit_log where action = 'admin_password_reset' and actor_id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint, 'the reset is audited');
select is(public.admin_reset_confirm('admin-a@test.dev', (select code from codes where k = 'c4'), 'another password 12'), 'none', 'the code works only once');
select is((select count(*) from public.admin_factor_challenges where user_id = '00000000-0000-0000-0000-0000000000a1' and not consumed), 0::bigint, 'no sign-in code stays open');

-- 6. The lock on other password changes. The real refusal (the auth service runs as supabase_auth_admin and cannot reach
-- the flag) is exercised by scripts/challenge-admin-reset-local.cjs; this test user cannot switch to that role.
select is((select tgenabled from pg_trigger where tgname = 'block_admin_password_change'), 'O', 'the password-change lock is installed and enabled');
select is((select tgrelid::regclass::text from pg_trigger where tgname = 'block_admin_password_change'), 'auth.users', 'on auth.users');
select lives_ok($$update auth.users set encrypted_password = extensions.crypt('owner break-glass 1', extensions.gen_salt('bf', 4)) where id = '00000000-0000-0000-0000-0000000000a2'$$, 'the database owner (session user postgres) can still reset an admin password in the SQL editor');
select lives_ok($$update auth.users set encrypted_password = extensions.crypt('resident new pass', extensions.gen_salt('bf', 4)) where id = '00000000-0000-0000-0000-0000000000c1'$$, 'a resident password can be changed');
select is(current_setting('dha.admin_password_reset', true), '', 'the reset flag does not stay on');

-- 7. A session must start with the password before it can ask for an admin code --------------------------------------------
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a211', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-00000000a212', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-00000000a213', '00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000a211')$$, '42501', 'this session did not start with the password', 'a session with no sign-in record cannot ask for a code');
insert into auth.mfa_amr_claims (session_id, created_at, updated_at, authentication_method, id) values
  ('00000000-0000-0000-0000-00000000a212', now(), now(), 'recovery', gen_random_uuid()),
  ('00000000-0000-0000-0000-00000000a212', now(), now(), 'otp', gen_random_uuid()),
  ('00000000-0000-0000-0000-00000000a213', now(), now(), 'password', gen_random_uuid());
select throws_ok($$select public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000a212')$$, '42501', 'this session did not start with the password', 'a session made by a recovery link or an emailed one-time code cannot ask for a code');
select is((select length(public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000a213'))), 6, 'a password session still gets its code');

select * from finish();
rollback;
