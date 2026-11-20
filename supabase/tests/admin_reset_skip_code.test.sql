-- Migration 0069: after a password reset the first password sign-in does not ask for the emailed code again.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act(p_uid uuid, p_session uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_session)::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
grant execute on function tests.act(uuid, uuid), tests.back() to authenticated;
create temp table codes (k text, code text);
grant select on codes to authenticated;

insert into auth.users (id, aud, role, email, encrypted_password) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin-a@test.dev', extensions.crypt('old password 123', extensions.gen_salt('bf', 4))),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'admin-b@test.dev', extensions.crypt('other admin pass', extensions.gen_salt('bf', 4))),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'res@test.dev', extensions.crypt('resident pass 12', extensions.gen_salt('bf', 4)));
insert into public.profiles (id, role, full_name, email, phone, verification_status, account_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin-a@test.dev', '03009990001', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'Staff B', 'admin-b@test.dev', '03009990002', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000c1', 'resident', 'Rida Resident', 'res@test.dev', '03001110001', 'approved', 'active');

-- 1. Grants ------------------------------------------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.admin_verify_after_reset()', 'execute'), false, 'anon cannot use the marker');
select is(has_function_privilege('authenticated', 'public.admin_verify_after_reset()', 'execute'), true, 'a signed-in user can call it (it checks everything itself)');
select is(has_table_privilege('authenticated', 'public.admin_reset_signins', 'select'), false, 'the marker table cannot be read through the API');
select is((select relrowsecurity from pg_class where oid = 'public.admin_reset_signins'::regclass), true, 'row level security is on for the marker table');

-- 2. Before any reset there is nothing to use ----------------------------------------------------------------------------
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1');
insert into auth.mfa_amr_claims (session_id, created_at, updated_at, authentication_method, id) values ('00000000-0000-0000-0000-00000000a101', now(), now(), 'password', gen_random_uuid());
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.admin_verify_after_reset(), 'none', 'with no reset, a password session gets none (it needs the emailed code)');
select tests.back();
select is((select count(*) from public.admin_verified_sessions), 0::bigint, 'and nothing was verified');

-- 3. A reset leaves one marker for that admin only -------------------------------------------------------------------------
insert into codes select 'a', public.admin_reset_issue('admin-a@test.dev') ->> 'code';
select is(public.admin_reset_confirm('admin-a@test.dev', (select code from codes where k = 'a'), 'a brand new password'), 'ok', 'the reset works as before');
select is((select count(*) from public.admin_reset_signins), 1::bigint, 'a reset leaves one marker');
select is((select user_id from public.admin_reset_signins), '00000000-0000-0000-0000-0000000000a1'::uuid, 'for that admin');
select is((select expires_at <= now() + interval '10 minutes 5 seconds' and expires_at > now() + interval '9 minutes' from public.admin_reset_signins), true, 'valid for about 10 minutes');
select is((select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000a1'), 0::bigint, 'the reset ended the old sessions');

-- 4. Who can use it ------------------------------------------------------------------------------------------------------------
-- another admin, a resident, and a session that did not start with the password
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-00000000c101', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-00000000a111', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a112', '00000000-0000-0000-0000-0000000000a1');
insert into auth.mfa_amr_claims (session_id, created_at, updated_at, authentication_method, id) values
  ('00000000-0000-0000-0000-00000000a201', now(), now(), 'password', gen_random_uuid()),
  ('00000000-0000-0000-0000-00000000c101', now(), now(), 'password', gen_random_uuid()),
  ('00000000-0000-0000-0000-00000000a111', now(), now(), 'otp', gen_random_uuid()),
  ('00000000-0000-0000-0000-00000000a112', now(), now(), 'password', gen_random_uuid());
select tests.act('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000a201');
select is(public.admin_verify_after_reset(), 'none', 'another admin cannot use it');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c101');
select throws_ok($$select public.admin_verify_after_reset()$$, '42501', 'not available', 'a resident is refused');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a111');
select is(public.admin_verify_after_reset(), 'none', 'a session made by an emailed one-time code (not the password) cannot use it');
select tests.back();
select is((select count(*) from public.admin_reset_signins), 1::bigint, 'none of those used the marker up');
select is((select count(*) from public.admin_verified_sessions), 0::bigint, 'and none was verified');
-- the right session
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a112');
select is(public.admin_verify_after_reset(), 'ok', 'the admin password session right after the reset is verified without a code');
select tests.back();
select is((select count(*) from public.admin_verified_sessions where session_id = '00000000-0000-0000-0000-00000000a112'), 1::bigint, 'and is marked verified');
select is((select count(*) from public.admin_reset_signins), 0::bigint, 'the marker is used up');
select is((select count(*) from public.audit_log where action = 'admin_signed_in_after_reset'), 1::bigint, 'it is audited');
-- a second use
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-00000000a113', '00000000-0000-0000-0000-0000000000a1');
insert into auth.mfa_amr_claims (session_id, created_at, updated_at, authentication_method, id) values ('00000000-0000-0000-0000-00000000a113', now(), now(), 'password', gen_random_uuid());
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a113');
select is(public.admin_verify_after_reset(), 'none', 'it works only once: the next session needs the code');
select tests.back();

-- 5. Expiry, a new reset clears it, a verified session, a suspended admin --------------------------------------------------------
update public.admin_reset_signins set expires_at = now() where false; -- (table is empty now)
insert into public.admin_reset_signins (user_id, expires_at) values ('00000000-0000-0000-0000-0000000000a1', now() - interval '1 second');
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-00000000a114', '00000000-0000-0000-0000-0000000000a1');
insert into auth.mfa_amr_claims (session_id, created_at, updated_at, authentication_method, id) values ('00000000-0000-0000-0000-00000000a114', now(), now(), 'password', gen_random_uuid());
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a114');
select is(public.admin_verify_after_reset(), 'none', 'an expired marker gives none');
select tests.back();
delete from public.admin_reset_signins;
insert into public.admin_reset_signins (user_id, expires_at) values ('00000000-0000-0000-0000-0000000000a1', now() + interval '5 minutes');
update public.admin_reset_challenges set created_at = now() - interval '2 minutes' where user_id = '00000000-0000-0000-0000-0000000000a1';
select is(public.admin_reset_issue('admin-a@test.dev') ->> 'status', 'sent', 'a new reset request is accepted');
select is((select count(*) from public.admin_reset_signins), 0::bigint, 'and clears an old marker');
-- a session that is already verified does not use the marker
insert into public.admin_reset_signins (user_id, expires_at) values ('00000000-0000-0000-0000-0000000000a1', now() + interval '5 minutes');
insert into public.admin_verified_sessions (session_id, user_id) values ('00000000-0000-0000-0000-00000000a114', '00000000-0000-0000-0000-0000000000a1');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a114');
select is(public.admin_verify_after_reset(), 'none', 'an already verified session gets none');
select tests.back();
select is((select count(*) from public.admin_reset_signins), 1::bigint, 'and leaves the marker alone');
-- a suspended admin
update public.profiles set account_status = 'suspended' where id = '00000000-0000-0000-0000-0000000000a1';
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-00000000a115', '00000000-0000-0000-0000-0000000000a1');
insert into auth.mfa_amr_claims (session_id, created_at, updated_at, authentication_method, id) values ('00000000-0000-0000-0000-00000000a115', now(), now(), 'password', gen_random_uuid());
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a115');
select throws_ok($$select public.admin_verify_after_reset()$$, '42501', 'not available', 'a suspended admin is refused');
select tests.back();
select is((select count(*) from public.admin_reset_signins), 1::bigint, 'and the marker is untouched');

select * from finish();
rollback;
