-- Migration 0037: admin second factor (email code) and staff invites. Written as an attack list.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
-- Acts as a signed-in user with a given session (and email) in the JWT, like a real GoTrue token.
create function tests.act(p_uid uuid, p_session uuid default null, p_email text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', coalesce(p_session, p_uid), 'email', p_email)::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
grant execute on function tests.act(uuid, uuid, text), tests.back() to authenticated;
create table tests.codes (k text primary key, v text);
grant all on tests.codes to authenticated;

-- People: admin A (two sessions), suspended admin S, resident R, invitee I (signed up, no profile yet).
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin@test.dev'),
  ('00000000-0000-0000-0000-0000000000a5', 'authenticated', 'authenticated', 'susp@test.dev'),
  ('00000000-0000-0000-0000-0000000000a9', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'new.staff@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'other@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status, account_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin@test.dev', '03009990001', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000a5', 'admin', 'Staff S', 'susp@test.dev', '03009990005', 'approved', 'suspended'),
  ('00000000-0000-0000-0000-0000000000a9', 'resident', 'Rida', 'res@test.dev', '03001110009', 'approved', 'active');
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a501', '00000000-0000-0000-0000-0000000000a5'),
  ('00000000-0000-0000-0000-00000000a901', '00000000-0000-0000-0000-0000000000a9'),
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-0000000000b2');

-- 1. A password-only admin session opens nothing ---------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.is_admin(), false, 'a password-only admin session is not an admin session');
select is(public.admin_session_status(), 'needs_code', 'the portal is told to ask for the code');
select is((select count(*) from public.audit_log), 0::bigint, 'and the audit log is unreadable');
select throws_ok($$select public.invite_staff('x@test.dev')$$, '42501', 'not available', 'an unverified admin cannot invite staff');
select is(public.admin_verify_code('123456'), 'none', 'there is no open code yet');
select tests.back();

-- 2. Who may ask for a code (service role only, active admin, own session) --------------------------------------
select is(has_function_privilege('authenticated', 'public.admin_issue_challenge(uuid,uuid)', 'execute'), false, 'a signed-in user cannot issue codes');
select is(has_function_privilege('anon', 'public.admin_issue_challenge(uuid,uuid)', 'execute'), false, 'anon cannot issue codes');
select is(has_function_privilege('service_role', 'public.admin_issue_challenge(uuid,uuid)', 'execute'), true, 'the Edge Function (service role) can');
select throws_ok($$select public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000a901')$$, '42501', 'not an active admin', 'no code for a resident');
select throws_ok($$select public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-00000000a501')$$, '42501', 'not an active admin', 'no code for a suspended admin');
select throws_ok($$select public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a901')$$, '42501', 'no such session', 'no code for someone else''s session');

insert into tests.codes values ('a101', public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101'));
select matches((select v from tests.codes where k = 'a101'), '^[0-9]{6}$', 'the code is six digits');
select is((select count(*) from public.admin_factor_challenges where code_hash = (select v from tests.codes where k = 'a101')), 0::bigint, 'the code itself is not stored');
select is((select count(*) from public.audit_log where action = 'admin_code_issued'), 1::bigint, 'issuing a code is audited');
select is((select count(*) from public.audit_log where coalesce(new_data::text, '') || coalesce(record_id, '') like '%' || (select v from tests.codes where k = 'a101') || '%'), 0::bigint, 'the audit log never holds the code');
select throws_ok($$select public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101')$$, 'P0001', 'wait a minute before asking for another code', 'a second code within a minute is refused');

-- 3. Guessing: wrong codes are counted, five lock the code, even the right one is then refused -------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.admin_verify_code('000000'), 'wrong', 'a wrong code is refused');
select is(public.admin_verify_code(null), 'wrong', 'an empty code is refused');
select is(public.admin_verify_code('111111'), 'wrong', 'wrong again');
select is(public.admin_verify_code('222222'), 'wrong', 'and again');
select is(public.admin_verify_code('333333'), 'locked', 'the fifth wrong code locks it');
select is(public.admin_verify_code((select v from tests.codes where k = 'a101')), 'locked', 'the right code no longer works once locked');
select is(public.is_admin(), false, 'still not an admin session');
select tests.back();
select is((select tries::int from public.admin_factor_challenges where session_id = '00000000-0000-0000-0000-00000000a101'), 5, 'the wrong tries were kept (not rolled back)');
select is((select count(*) from public.audit_log where action = 'admin_code_locked'), 1::bigint, 'the lock is audited');

-- 4. A new code (after the wait) proves the mailbox, but no longer opens the session (0052) -------------------------
update public.admin_factor_challenges set created_at = created_at - interval '2 minutes';
insert into tests.codes values ('a101b', public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101'));
select tests.act('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000a901');
select throws_ok($$select public.admin_verify_code('123456')$$, '42501', 'not available', 'a resident cannot use the code endpoint');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');
select is(public.admin_verify_code((select v from tests.codes where k = 'a101b')), 'none', 'a code issued for one session does not open another session');
select is(public.is_admin(), false, 'the other session stays unverified');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.admin_enroll_proof_status(), false, 'before the code there is no mailbox proof');
select is(public.admin_verify_code((select v from tests.codes where k = 'a101b')), 'ok', 'the right emailed code is accepted');
select is(public.admin_enroll_proof_status(), true, 'and counts as a mailbox proof');
select is(public.is_admin(), false, 'but the emailed code alone does not make an admin session');
select is(public.admin_session_status(), 'needs_code', 'the portal is still told to ask for the authenticator');
select is((select count(*) from public.audit_log), 0::bigint, 'and the audit log stays unreadable');
select is(public.admin_verify_code((select v from tests.codes where k = 'a101b')), 'none', 'a code cannot be used twice');
select tests.back();
select is((select count(*) from public.audit_log where action = 'admin_mailbox_proved'), 1::bigint, 'the mailbox proof is audited');
select is((select count(*) from public.audit_log where action = 'admin_signed_in'), 0::bigint, 'and it is not recorded as a sign-in');
-- From here on session a101 is a verified admin session. The authenticator path that creates it is tested in admin_totp.test.sql.
insert into public.admin_verified_sessions (session_id, user_id) values ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1');

-- 5. The verification ends with the session (it has no time limit of its own) --------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');
select is(public.is_admin(), false, 'the second session of the same admin is still not verified');
select tests.back();
update public.admin_verified_sessions set verified_at = now() - interval '13 hours';
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.is_admin(), true, 'a verification does not run out with time (no expiry, 14 Nov decision)');
select tests.back();
update public.admin_verified_sessions set verified_at = now();
delete from auth.sessions where id = '00000000-0000-0000-0000-00000000a101';
select is((select count(*) from public.admin_verified_sessions), 0::bigint, 'ending the session removes its verification');
-- Suspending an admin ends their sessions (0036), so the verification goes too.
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-00000000a103', '00000000-0000-0000-0000-0000000000a1');
insert into public.admin_verified_sessions (session_id, user_id) values ('00000000-0000-0000-0000-00000000a103', '00000000-0000-0000-0000-0000000000a1');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103');
select is(public.is_admin(), true, 'verified again');
select tests.back();
update public.profiles set account_status = 'suspended' where id = '00000000-0000-0000-0000-0000000000a1';
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103');
select is(public.is_admin(), false, 'a suspended admin is not an admin even with a verified-looking session');
select tests.back();
update public.profiles set account_status = 'active' where id = '00000000-0000-0000-0000-0000000000a1';

-- 6. Expiry and the hourly cap -----------------------------------------------------------------------------------
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-00000000a104', '00000000-0000-0000-0000-0000000000a1');
delete from public.admin_factor_challenges;
insert into tests.codes values ('a104', public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104'));
update public.admin_factor_challenges set expires_at = now() - interval '1 second';
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104');
select is(public.admin_verify_code((select v from tests.codes where k = 'a104')), 'expired', 'a code older than 10 minutes is refused');
select tests.back();
do $$
begin
  for i in 1..4 loop
    update public.admin_factor_challenges set created_at = created_at - interval '2 minutes';
    perform public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104');
  end loop;
  update public.admin_factor_challenges set created_at = created_at - interval '2 minutes';
end $$;
select throws_ok($$select public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104')$$, 'P0001', 'too many codes requested; try again later', 'more than five codes an hour is refused');

-- 7. Staff invites ------------------------------------------------------------------------------------------------
insert into public.admin_verified_sessions (session_id, user_id) values ('00000000-0000-0000-0000-00000000a104', '00000000-0000-0000-0000-0000000000a1');
select tests.act('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000a901');
select throws_ok($$select public.invite_staff('x@test.dev')$$, '42501', 'not available', 'a resident cannot invite staff');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104');
insert into tests.codes values ('invite', public.invite_staff('  New.Staff@Test.dev '));
select matches((select v from tests.codes where k = 'invite'), '^[0-9a-f]{48}$', 'an invite returns a one-time token');
select throws_ok($$select public.invite_staff('not an email')$$, 'P0001', 'enter a valid email address', 'a bad email is refused');
select throws_ok($$select public.invite_staff('admin@test.dev')$$, 'P0001', 'that person is already an admin', 'inviting an existing admin is refused');
select tests.back();
select is((select count(*) from public.staff_invites where token_hash is not null and token_hash <> (select v from tests.codes where k = 'invite')), 1::bigint, 'only the hash of the token is stored');
select is((select email from public.staff_invites where status = 'pending'), 'new.staff@test.dev', 'the email is stored lower case');
select is((select count(*) from public.audit_log where action = 'staff_invited'), 1::bigint, 'the invite is audited');

-- The invited person (signed up with email + password; no profile yet):
select tests.act('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000b101', 'new.staff@test.dev');
select throws_ok($$select public.accept_staff_invite('new.staff@test.dev', 'wrong-token', 'New Staff')$$, 'P0001', 'this invitation is not valid', 'a wrong token fails');
select throws_ok($$select public.accept_staff_invite('new.staff@test.dev', null, 'New Staff')$$, 'P0001', 'this invitation is not valid', 'no token fails');
select throws_ok(format($$select public.accept_staff_invite('new.staff@test.dev', %L, 'X')$$, (select v from tests.codes where k = 'invite')), 'P0001', 'this invitation is not valid', 'a one-letter name fails');
select tests.back();
-- Someone else, signed in as a different email, holding a leaked token and typing the invited email:
select tests.act('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000b201', 'other@test.dev');
select throws_ok(format($$select public.accept_staff_invite('new.staff@test.dev', %L, 'Thief')$$, (select v from tests.codes where k = 'invite')), 'P0001', 'this invitation is not valid', 'a leaked token does not work for another email address');
select tests.back();
-- A resident cannot turn themselves into an admin with a valid token:
select tests.act('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000a901', 'new.staff@test.dev');
select throws_ok(format($$select public.accept_staff_invite('new.staff@test.dev', %L, 'Rida')$$, (select v from tests.codes where k = 'invite')), 'P0001', 'this invitation is not valid', 'an account that already has a profile cannot accept');
select tests.back();
-- The right person, the right token:
select tests.act('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000b101', 'new.staff@test.dev');
select lives_ok(format($$select public.accept_staff_invite('new.staff@test.dev', %L, 'New Staff')$$, (select v from tests.codes where k = 'invite')), 'the invited person accepts');
select is(public.is_admin(), false, 'a new admin still has to pass the second step');
select is(public.admin_session_status(), 'needs_code', 'and is asked for a code');
select throws_ok(format($$select public.accept_staff_invite('new.staff@test.dev', %L, 'Again')$$, (select v from tests.codes where k = 'invite')), 'P0001', 'this invitation is not valid', 'the token works only once');
select tests.back();
select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'admin', 'the new account is an admin account');
select is((select status from public.staff_invites where lower(email) = 'new.staff@test.dev'), 'accepted', 'the invite is marked accepted');
select is((select count(*) from public.audit_log where action = 'staff_invite_accepted'), 1::bigint, 'the acceptance is audited');

-- Expiry and revoking ----------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104');
insert into tests.codes values ('invite2', public.invite_staff('other@test.dev'));
select lives_ok($$select public.revoke_staff_invite((select id from public.staff_invites where email = 'other@test.dev' and status = 'pending'))$$, 'an admin can revoke a pending invite');
select throws_ok($$select public.revoke_staff_invite(gen_random_uuid())$$, 'P0001', 'no pending invite', 'revoking something that does not exist fails');
insert into tests.codes values ('invite3', public.invite_staff('other@test.dev'));
select tests.back();
update public.staff_invites set expires_at = now() - interval '1 minute' where status = 'pending';
select tests.act('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000b201', 'other@test.dev');
select throws_ok(format($$select public.accept_staff_invite('other@test.dev', %L, 'Other')$$, (select v from tests.codes where k = 'invite3')), 'P0001', 'this invitation is not valid', 'an expired invite cannot be accepted');
select throws_ok(format($$select public.accept_staff_invite('other@test.dev', %L, 'Other')$$, (select v from tests.codes where k = 'invite2')), 'P0001', 'this invitation is not valid', 'a revoked invite cannot be accepted');
select tests.back();

-- The two new tables are not reachable from the app at all ----------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104');
select throws_ok($$select count(*) from public.admin_factor_challenges$$, '42501', null, 'the challenge table is not readable, not even by a verified admin');
select throws_ok($$select count(*) from public.admin_verified_sessions$$, '42501', null, 'the verified-sessions table is not readable either');
select throws_ok($$insert into public.admin_verified_sessions (session_id, user_id) values (gen_random_uuid(), auth.uid())$$, '42501', null, 'an admin cannot mark a session verified by hand');
select tests.back();

select * from finish();
rollback;
