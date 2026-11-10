-- Migration 0046: 4-hour admin verification, account-wide wrong-code cap, invitation check before sign-up.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.act(p_uid uuid, p_session uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_session)::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
grant execute on function tests.act(uuid, uuid), tests.back() to authenticated;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status, account_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin@test.dev', '03009990001', 'approved', 'active');
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a103', '00000000-0000-0000-0000-0000000000a1');

-- 1. Verification lasts 4 hours ---------------------------------------------------------------------------------
insert into public.admin_verified_sessions (session_id, user_id, verified_at) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1', now() - interval '3 hours'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1', now() - interval '5 hours');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.is_admin(), true, 'a verification 3 hours old still counts');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');
select is(public.is_admin(), false, 'a verification 5 hours old no longer counts');
select is(public.admin_session_status(), 'needs_code', 'the portal asks for a new code');
select tests.back();

-- 2. Wrong guesses are capped per account, across codes ---------------------------------------------------------
-- Two earlier codes of this hour used up 5 wrong tries each; a fresh code on a new session is refused at once.
insert into public.admin_factor_challenges (user_id, session_id, code_hash, tries, consumed, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101', 'x', 5, true, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102', 'x', 5, true, now() - interval '10 minutes');
select public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103');
select is(public.admin_verify_code('000000'), 'locked', 'ten wrong guesses in an hour lock the account, even for a fresh code');
select tests.back();
select is((select tries from public.admin_factor_challenges where session_id = '00000000-0000-0000-0000-00000000a103'), 0::smallint,
          'and the locked answer is returned before any guess is counted');

-- 3. A wrong guess is written to the audit log (never the guess) -------------------------------------------------
delete from public.admin_factor_challenges where created_at > now() - interval '1 hour';
select public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103');
select is(public.admin_verify_code('000000'), 'wrong', 'a wrong code is wrong');
select tests.back();
select is((select count(*)::int from public.audit_log where action = 'admin_code_wrong'), 1, 'the wrong guess is audited');
select is((select count(*)::int from public.audit_log where action = 'admin_code_wrong' and (new_data::text like '%000000%' or record_id like '%000000%')), 0, 'without the guess');

-- 4. check_staff_invite -----------------------------------------------------------------------------------------
insert into public.staff_invites (id, email, invited_by, token_hash, status) values
  ('00000000-0000-0000-0000-0000000000c1', 'new@test.dev', '00000000-0000-0000-0000-0000000000a1',
   encode(extensions.digest(convert_to('goodtoken', 'utf8'), 'sha256'), 'hex'), 'pending'),
  ('00000000-0000-0000-0000-0000000000c2', 'old@test.dev', '00000000-0000-0000-0000-0000000000a1',
   encode(extensions.digest(convert_to('oldtoken', 'utf8'), 'sha256'), 'hex'), 'revoked');
set local role anon;
select is(public.check_staff_invite('new@test.dev', 'goodtoken'), true, 'a valid invitation is recognised before sign-up');
select is(public.check_staff_invite('NEW@test.dev', 'goodtoken'), true, 'the email is case-insensitive');
select is(public.check_staff_invite('new@test.dev', 'wrongtoken'), false, 'a wrong token is refused');
select is(public.check_staff_invite('other@test.dev', 'goodtoken'), false, 'the token only fits its own email');
select is(public.check_staff_invite('old@test.dev', 'oldtoken'), false, 'a revoked invitation is refused');
select is(public.check_staff_invite(null, null), false, 'nulls are refused');
reset role;

select * from finish();
rollback;
