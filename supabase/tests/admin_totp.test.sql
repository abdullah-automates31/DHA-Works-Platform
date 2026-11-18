-- Migration 0052 added an authenticator-app (TOTP) second factor; 0055 went back to the emailed code and the portal
-- stopped using it. Since 0061 (audit, 18 Nov 2026) its six functions are closed to every app role, so a signed-in
-- account (even a verified admin, even with an aal2 token from an authenticator it enrolled itself) cannot use them
-- to mark a session verified. Their tables stay unreadable.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act(p_uid uuid, p_session uuid, p_aal text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_session, 'aal', p_aal,
      'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint))))::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
grant execute on function tests.act(uuid, uuid, text), tests.back() to authenticated;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin@test.dev'),
  ('00000000-0000-0000-0000-0000000000a9', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status, account_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin@test.dev', '03009990001', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000a9', 'resident', 'Rida', 'res@test.dev', '03001110009', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman', 'w@test.dev', '03003334444', 'approved', 'active');
-- a101: verified admin session that used an authenticator. a102: password-only admin session whose holder enrolled
-- an authenticator of their own (the attacker case). Plus a resident and a worker session.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'real', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', 'attacker', 'totp', 'verified', now(), now(), 'KRSXG5CTMVRXEZLU');
insert into auth.sessions (id, user_id, aal, factor_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1', 'aal2', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1', 'aal2', '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-00000000a901', '00000000-0000-0000-0000-0000000000a9', 'aal1', null),
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-0000000000b1', 'aal1', null);
insert into public.admin_totp_factors (factor_id, user_id) values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1');
insert into public.admin_enroll_proofs (session_id, user_id) values ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1');
insert into public.admin_verified_sessions (session_id, user_id) values ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1');

-- 1. No app role may call any of the six functions --------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.admin_mark_session_verified()', 'execute'), false, 'authenticated cannot call admin_mark_session_verified');
select is(has_function_privilege('authenticated', 'public.admin_register_totp(uuid)', 'execute'), false, 'authenticated cannot call admin_register_totp');
select is(has_function_privilege('authenticated', 'public.admin_reset_totp()', 'execute'), false, 'authenticated cannot call admin_reset_totp');
select is(has_function_privilege('authenticated', 'public.admin_totp_status()', 'execute'), false, 'authenticated cannot call admin_totp_status');
select is(has_function_privilege('authenticated', 'public.admin_totp_factor()', 'execute'), false, 'authenticated cannot call admin_totp_factor');
select is(has_function_privilege('authenticated', 'public.admin_enroll_proof_status()', 'execute'), false, 'authenticated cannot call admin_enroll_proof_status');
select is(has_function_privilege('anon', 'public.admin_mark_session_verified()', 'execute'), false, 'anon cannot call admin_mark_session_verified');
select is(has_function_privilege('anon', 'public.admin_register_totp(uuid)', 'execute'), false, 'anon cannot call admin_register_totp');
select is(has_function_privilege('anon', 'public.admin_reset_totp()', 'execute'), false, 'anon cannot call admin_reset_totp');

-- 2. The attacker case: password only, an authenticator they enrolled, a registered factor and a proof row --------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102', 'aal2');
select is(public.is_admin(), false, 'a password-only session is not an admin session');
select throws_ok($$select public.admin_mark_session_verified()$$, '42501', null, 'it cannot mark itself verified with its own authenticator');
select throws_ok($$select public.admin_register_totp('00000000-0000-0000-0000-0000000000f2')$$, '42501', null, 'or register that authenticator');
select throws_ok($$select public.admin_reset_totp()$$, '42501', null, 'or reset the real one');
select is(public.is_admin(), false, 'and is still not an admin session afterwards');
select tests.back();
select is((select count(*)::int from public.admin_verified_sessions where session_id = '00000000-0000-0000-0000-00000000a102'), 0, 'no verification row was written for it');

-- 3. Even a verified admin cannot use them --------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101', 'aal2');
select is(public.is_admin(), true, 'the verified session is an admin session');
select throws_ok($$select public.admin_mark_session_verified()$$, '42501', null, 'a verified admin cannot call admin_mark_session_verified');
select throws_ok($$select public.admin_totp_status()$$, '42501', null, 'or admin_totp_status');
select throws_ok($$select count(*) from public.admin_totp_factors$$, '42501', null, 'the registered-factor table is not readable');
select throws_ok($$select count(*) from public.admin_enroll_proofs$$, '42501', null, 'the proof table is not readable');
select throws_ok($$insert into public.admin_totp_factors (factor_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', auth.uid())$$, '42501', null, 'a factor cannot be registered by hand');
select tests.back();

-- 4. Residents and workers ---------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000a901');
select throws_ok($$select public.admin_mark_session_verified()$$, '42501', null, 'a resident cannot call it');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000b101');
select throws_ok($$select public.admin_register_totp('00000000-0000-0000-0000-0000000000f1')$$, '42501', null, 'a worker cannot call it');
select tests.back();

select * from finish();
rollback;
