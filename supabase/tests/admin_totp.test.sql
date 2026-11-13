-- Migration 0052: the authenticator-app (TOTP) second factor for admin staff.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act(p_uid uuid, p_session uuid, p_ts bigint default null, p_aal text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_session, 'aal', p_aal,
      'amr', case when p_ts is null then null else json_build_array(json_build_object('method', 'totp', 'timestamp', p_ts), json_build_object('method', 'password', 'timestamp', p_ts - 5)) end))::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function tests.msg(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlerrm;
end $$;
grant execute on function tests.act(uuid, uuid, bigint, text), tests.back(), tests.msg(text) to authenticated;

-- Admin A (the real one), a resident, a worker.
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'admin2@test.dev'),
  ('00000000-0000-0000-0000-0000000000a9', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status, account_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin@test.dev', '03009990001', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'Staff B', 'admin2@test.dev', '03009990002', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000a9', 'resident', 'Rida', 'res@test.dev', '03001110009', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman', 'w@test.dev', '03003334444', 'approved', 'active');

-- Factors: f1 = admin A's real authenticator, f2 = an authenticator an attacker enrolled with the password only,
-- f3 = admin B's, f4 = a factor that was started but never verified.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'real', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', 'attacker', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2', 'other admin', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000a1', 'unverified', 'totp', 'unverified', now(), now(), 'JBSWY3DPEHPK3PXP');

-- Sessions: s1 password only (aal1); s2 aal2 with the real factor; s3 aal2 with the attacker's factor; s4 aal2 with admin B's factor
-- (used by admin A's token: a mismatch); s5 aal2 with the unverified factor; s6 a second aal2 session of admin A; r and w for the others.
insert into auth.sessions (id, user_id, aal, factor_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1', 'aal1', null),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1', 'aal2', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000a103', '00000000-0000-0000-0000-0000000000a1', 'aal2', '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-00000000a104', '00000000-0000-0000-0000-0000000000a1', 'aal2', '00000000-0000-0000-0000-0000000000f3'),
  ('00000000-0000-0000-0000-00000000a105', '00000000-0000-0000-0000-0000000000a1', 'aal2', '00000000-0000-0000-0000-0000000000f4'),
  ('00000000-0000-0000-0000-00000000a106', '00000000-0000-0000-0000-0000000000a1', 'aal2', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000a901', '00000000-0000-0000-0000-0000000000a9', 'aal1', null),
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-0000000000b1', 'aal1', null);

-- 1. Before anything is registered ---------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.admin_totp_status(), 'none', 'an admin with no registered authenticator is told so');
select is(public.admin_totp_factor(), null, 'and has no factor to ask a code for');
select is(public.admin_enroll_proof_status(), false, 'there is no mailbox proof yet');
select is(public.admin_mark_session_verified(), 'not_ready', 'a password-only session cannot be marked verified');
select is(public.is_admin(), false, 'and is not an admin session');
select tests.back();

-- 2. The attacker case: password only, enrols their own authenticator through the Auth API ------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103', extract(epoch from now())::bigint, 'aal2');
select is(public.admin_register_totp('00000000-0000-0000-0000-0000000000f2'), 'proof', 'registering needs the emailed code first');
select is(public.admin_mark_session_verified(), 'not_ready', 'an unregistered authenticator does not open the session');
select is(public.is_admin(), false, 'the attacker is not an admin');
select is(tests.msg($$select public.admin_save_settings('1092', true, 7, 7)$$), 'not available', 'and every admin function is refused');
select tests.back();
select is((select count(*)::int from public.admin_verified_sessions), 0, 'nothing was marked verified');

-- 3. The real admin proves the mailbox, then registers the authenticator -----------------------------------------
insert into public.admin_enroll_proofs (session_id, user_id) values ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102', extract(epoch from now())::bigint, 'aal2');
select is(public.admin_enroll_proof_status(), true, 'the session has a mailbox proof');
select is(public.admin_register_totp('00000000-0000-0000-0000-0000000000f2'), 'invalid', 'a factor this session did not verify cannot be registered');
select is(public.admin_register_totp('00000000-0000-0000-0000-0000000000f3'), 'invalid', 'nor can another person''s factor');
select is(public.admin_register_totp('00000000-0000-0000-0000-0000000000f4'), 'invalid', 'nor one that was never verified');
select is(public.admin_register_totp(null), 'invalid', 'nor nothing');
select is(public.admin_register_totp('00000000-0000-0000-0000-0000000000f1'), 'ok', 'the verified factor of this session is registered');
select is(public.admin_totp_status(), 'enrolled', 'the admin is now enrolled');
select is(public.admin_totp_factor(), '00000000-0000-0000-0000-0000000000f1'::uuid, 'with that factor');
select is(public.admin_register_totp('00000000-0000-0000-0000-0000000000f1'), 'proof', 'the mailbox proof works once');
select tests.back();
select is((select count(*)::int from public.audit_log where action = 'admin_totp_registered'), 1, 'the registration is audited');

-- 4. Signing in with the registered authenticator ---------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102', extract(epoch from now())::bigint - 300, 'aal2');
select is(public.admin_mark_session_verified(), 'not_ready', 'a code typed 5 minutes ago is too old');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102', extract(epoch from now())::bigint);
select is(public.admin_mark_session_verified(), 'not_ready', 'a token without the aal2 claim is refused');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101', extract(epoch from now())::bigint, 'aal2');
select is(public.admin_mark_session_verified(), 'not_ready', 'a session that is not aal2 in the database is refused');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103', extract(epoch from now())::bigint, 'aal2');
select is(public.admin_mark_session_verified(), 'not_ready', 'the attacker''s session (other factor) is still refused after the real one is registered');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102', extract(epoch from now())::bigint, 'aal2');
select is(public.admin_mark_session_verified(), 'ok', 'a fresh code with the registered authenticator marks the session verified');
select is(public.is_admin(), true, 'it is an admin session');
select is(public.admin_session_status(), 'verified', 'the portal is told so');
select is(public.admin_step_up_status(), 'fresh', 'and it is fresh');
select is(public.admin_mark_session_verified(), 'ok', 'asking again (step-up) is fine');
select tests.back();
select is((select count(*)::int from public.audit_log where action = 'admin_signed_in'), 1, 'one sign-in is audited');
select is((select count(*)::int from public.audit_log where action = 'admin_step_up'), 1, 'and the second call is a step-up');

-- 5. Guessing: ten failed attempts lock the factor, even for the right code ----------------------------------------
insert into auth.mfa_challenges (id, factor_id, created_at, verified_at, ip_address)
  select gen_random_uuid(), '00000000-0000-0000-0000-0000000000f1', now() - (n || ' minutes')::interval, null, '127.0.0.1'
  from generate_series(1, 9) n;
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102', extract(epoch from now())::bigint, 'aal2');
select is(public.admin_mark_session_verified(), 'ok', 'nine failed attempts do not lock it');
select tests.back();
insert into auth.mfa_challenges (id, factor_id, created_at, verified_at, ip_address)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f1', now(), null, '127.0.0.1');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102', extract(epoch from now())::bigint, 'aal2');
select is(public.admin_mark_session_verified(), 'locked', 'the tenth failed attempt locks it, even with the right code');
select tests.back();
update auth.mfa_challenges set created_at = now() - interval '20 minutes';
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102', extract(epoch from now())::bigint, 'aal2');
select is(public.admin_mark_session_verified(), 'ok', 'after 15 minutes the lock is gone');
select tests.back();
insert into auth.mfa_challenges (id, factor_id, created_at, verified_at, ip_address)
  select gen_random_uuid(), '00000000-0000-0000-0000-0000000000f1', now(), now(), '127.0.0.1' from generate_series(1, 20);
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102', extract(epoch from now())::bigint, 'aal2');
select is(public.admin_mark_session_verified(), 'ok', 'successful attempts never count towards the lock');
select tests.back();

-- 6. A new registration (lost phone) ends the verification of the account's other sessions ---------------------
insert into public.admin_verified_sessions (session_id, user_id) values ('00000000-0000-0000-0000-00000000a106', '00000000-0000-0000-0000-0000000000a1');
update auth.sessions set factor_id = '00000000-0000-0000-0000-0000000000f2' where id = '00000000-0000-0000-0000-00000000a103';
insert into public.admin_enroll_proofs (session_id, user_id) values ('00000000-0000-0000-0000-00000000a103', '00000000-0000-0000-0000-0000000000a1');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103', extract(epoch from now())::bigint, 'aal2');
select is(public.admin_register_totp('00000000-0000-0000-0000-0000000000f2'), 'ok', 'a new authenticator can be registered after a mailbox proof');
select tests.back();
select is((select factor_id from public.admin_totp_factors where user_id = '00000000-0000-0000-0000-0000000000a1'), '00000000-0000-0000-0000-0000000000f2'::uuid, 'it replaces the old registration');
select is((select count(*)::int from public.admin_verified_sessions where user_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'and every other session of the account is no longer verified');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');
select is(public.is_admin(), false, 'the old authenticator''s session is not an admin session any more');
select tests.back();

-- 7. Everyone else, and the tables -------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000a901');
select throws_ok($$select public.admin_mark_session_verified()$$, '42501', 'not available', 'a resident cannot mark a session verified');
select throws_ok($$select public.admin_totp_status()$$, '42501', 'not available', 'a resident cannot ask for the authenticator status');
select throws_ok($$select public.admin_register_totp('00000000-0000-0000-0000-0000000000f1')$$, '42501', 'not available', 'a resident cannot register an authenticator');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000b101');
select throws_ok($$select public.admin_enroll_proof_status()$$, '42501', 'not available', 'a worker cannot ask for the mailbox proof');
select throws_ok($$select public.admin_totp_factor()$$, '42501', 'not available', 'a worker cannot read the registered factor');
select tests.back();
select is(has_function_privilege('anon', 'public.admin_mark_session_verified()', 'execute'), false, 'anon cannot mark a session verified');
select is(has_function_privilege('anon', 'public.admin_register_totp(uuid)', 'execute'), false, 'anon cannot register an authenticator');
select is(has_function_privilege('anon', 'public.admin_totp_status()', 'execute'), false, 'anon cannot read the status');
select is(has_function_privilege('authenticated', 'public.admin_mark_session_verified()', 'execute'), true, 'a signed-in person can call it (the function decides)');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103', extract(epoch from now())::bigint, 'aal2');
select throws_ok($$select count(*) from public.admin_totp_factors$$, '42501', null, 'the registered-factor table is not readable by an admin');
select throws_ok($$select count(*) from public.admin_enroll_proofs$$, '42501', null, 'the proof table is not readable by an admin');
select throws_ok($$insert into public.admin_totp_factors (factor_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', auth.uid())$$, '42501', null, 'an admin cannot register a factor by hand');
select throws_ok($$insert into public.admin_enroll_proofs (session_id, user_id) values ('00000000-0000-0000-0000-00000000a103', auth.uid())$$, '42501', null, 'an admin cannot write a mailbox proof by hand');
select tests.back();

-- 8. Reset: every authenticator of the account goes, after a mailbox proof (lost phone, or a stranger pre-enrolled) ----
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a105');
select throws_ok($$select public.admin_reset_totp()$$, 'P0001', 'confirm your email first', 'a reset needs the mailbox proof');
select tests.back();
insert into auth.sessions (id, user_id, aal, factor_id) values ('00000000-0000-0000-0000-00000000a107', '00000000-0000-0000-0000-0000000000a1', 'aal1', null);
insert into public.admin_enroll_proofs (session_id, user_id) values ('00000000-0000-0000-0000-00000000a107', '00000000-0000-0000-0000-0000000000a1');
insert into public.admin_verified_sessions (session_id, user_id) values ('00000000-0000-0000-0000-00000000a105', '00000000-0000-0000-0000-0000000000a1');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a107');
select lives_ok($$select public.admin_reset_totp()$$, 'with the mailbox proof the reset works');
select is(public.admin_totp_status(), 'none', 'the account has no registered authenticator afterwards');
select tests.back();
select is((select count(*)::int from auth.mfa_factors where user_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'and no authenticator of any kind, including ones registered by a stranger');
select is((select count(*)::int from public.admin_verified_sessions where user_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'every verified session of the account has ended');
select is((select count(*)::int from public.audit_log where action = 'admin_totp_reset'), 1, 'the reset is audited');
select tests.act('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000a901');
select throws_ok($$select public.admin_reset_totp()$$, '42501', 'not available', 'a resident cannot reset an authenticator');
select tests.back();
select is(has_function_privilege('anon', 'public.admin_reset_totp()', 'execute'), false, 'anon cannot reset an authenticator');
select * from finish();
rollback;
