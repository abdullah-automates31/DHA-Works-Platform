-- Migration 0048: a verified admin session is not enough for destructive actions; a code typed in the last 15 minutes is.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
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
create table tests.codes (k text primary key, v text);
grant all on tests.codes to authenticated;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin@test.dev'),
  ('00000000-0000-0000-0000-0000000000a9', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status, account_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin@test.dev', '03009990001', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000a9', 'resident', 'Rida', 'res@test.dev', '03001110009', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman', 'w@test.dev', '03003334444', 'approved', 'active');
-- s1: verified 1 hour ago, last code 1 hour ago (stale). s2: verified and fresh. s3: password only. s4: verified 5 hours ago.
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a103', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a104', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a901', '00000000-0000-0000-0000-0000000000a9'),
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-0000000000b1');
insert into public.admin_verified_sessions (session_id, user_id, verified_at, fresh_at) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1', now() - interval '1 hour', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1', now(), now()),
  ('00000000-0000-0000-0000-00000000a104', '00000000-0000-0000-0000-0000000000a1', now() - interval '5 hours', now() - interval '5 hours');

-- 1. A stale (verified but not fresh) session is refused by every sensitive function ----------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.is_admin(), true, 'the stale session is still a verified admin session');
select is(public.admin_step_up_status(), 'needs_code', 'but the portal is told to ask for a code');
select throws_ok($$select public.invite_staff('new@test.dev')$$, 'P0001', 'confirm with a new code', 'invite_staff needs a fresh code');
select throws_ok($$select public.revoke_staff_invite('00000000-0000-0000-0000-000000000001')$$, 'P0001', 'confirm with a new code', 'revoke_staff_invite needs a fresh code');
select throws_ok($$select public.admin_remove_staff('00000000-0000-0000-0000-000000000001', 'because')$$, 'P0001', 'confirm with a new code', 'admin_remove_staff needs a fresh code');
select throws_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b1', true, 'because')$$, 'P0001', 'confirm with a new code', 'admin_set_account_status needs a fresh code');
select throws_ok($$select public.admin_cancel_job('00000000-0000-0000-0000-000000000001', 'because')$$, 'P0001', 'confirm with a new code', 'admin_cancel_job needs a fresh code');
select throws_ok($$select public.admin_decide_cancellation('00000000-0000-0000-0000-000000000001', true, 'ok')$$, 'P0001', 'confirm with a new code', 'admin_decide_cancellation needs a fresh code');
select throws_ok($$select public.admin_job_replace_worker('00000000-0000-0000-0000-000000000001', 'because')$$, 'P0001', 'confirm with a new code', 'admin_job_replace_worker needs a fresh code');
select throws_ok($$select public.admin_save_settings('1092', true, 7, 7)$$, 'P0001', 'confirm with a new code', 'admin_save_settings needs a fresh code');
select throws_ok($$select public.admin_add_category('Painting', 'Walls')$$, 'P0001', 'confirm with a new code', 'admin_add_category needs a fresh code');
select throws_ok($$select public.admin_update_category(1::smallint, 'Plumbing', 'Pipes', true)$$, 'P0001', 'confirm with a new code', 'admin_update_category needs a fresh code');
select throws_ok($$select public.admin_set_phase_active(5::smallint, true)$$, 'P0001', 'confirm with a new code', 'admin_set_phase_active needs a fresh code');
select tests.back();

-- 2. A fresh session works -------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');
select is(public.admin_step_up_status(), 'fresh', 'a fresh session is reported fresh');
select lives_ok($$select public.admin_save_settings('1092', true, 7, 7)$$, 'a fresh session can save settings');
select lives_ok($$select public.invite_staff('new@test.dev')$$, 'and invite staff');
select lives_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b1', true, 'because')$$, 'and suspend a worker');
select tests.back();

-- 3. A new code makes the stale session fresh ------------------------------------------------------------------
insert into tests.codes values ('a101', public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101'));
select matches((select v from tests.codes where k = 'a101'), '^[0-9]{6}$', 'a verified session can ask for a step-up code');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.admin_verify_code('000000'), 'wrong', 'a wrong code does not freshen the session');
select is(public.admin_step_up_status(), 'needs_code', 'still stale');
select is(public.admin_verify_code((select v from tests.codes where k = 'a101')), 'ok', 'the right code is accepted');
select is(public.admin_step_up_status(), 'fresh', 'now fresh');
select lives_ok($$select public.admin_add_category('Tile Cleaning', 'Floors and grout')$$, 'the sensitive action now works');
select tests.back();
select is((select count(*)::int from public.audit_log where action = 'admin_step_up'), 1, 'the step-up is audited (not as a sign-in)');
select is((select count(*)::int from public.audit_log where action = 'admin_signed_in'), 0, 'and no extra sign-in is recorded');

-- 4. The code limits still apply to step-up --------------------------------------------------------------------
select throws_ok($$select public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101')$$, 'P0001', 'wait a minute before asking for another code', 'one code a minute');

-- 5. A session whose 4 hours are over is verified again by a code (and is fresh) -----------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104');
select is(public.is_admin(), false, 'a verification 5 hours old no longer counts');
select tests.back();
delete from public.admin_factor_challenges where created_at > now() - interval '5 minutes';
insert into tests.codes values ('a104', public.admin_issue_challenge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104'));
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104');
select is(public.admin_verify_code((select v from tests.codes where k = 'a104')), 'ok', 'the code renews it');
select is(public.is_admin(), true, 'it is a verified session again');
select is(public.admin_step_up_status(), 'fresh', 'and fresh');
select tests.back();
select is((select count(*)::int from public.audit_log where action = 'admin_signed_in'), 1, 'recorded as a sign-in (the old verification had run out)');

-- 6. Everyone else still gets "not available" (the admin check comes first) -----------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a103');
select throws_ok($$select public.admin_save_settings('1092', true, 7, 7)$$, '42501', 'not available', 'a password-only admin session: not available');
select is(public.admin_step_up_status(), 'not_admin', 'and not reported as an admin');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000a901');
select throws_ok($$select public.admin_cancel_job('00000000-0000-0000-0000-000000000001', 'because')$$, '42501', 'not available', 'a resident: not available');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000b101');
select throws_ok($$select public.invite_staff('x@test.dev')$$, '42501', 'not available', 'a worker: not available');
select tests.back();
select is(has_function_privilege('anon', 'public.admin_step_up_status()', 'execute'), false, 'anon cannot call admin_step_up_status');
select is(has_function_privilege('authenticated', 'private.admin_fresh(integer)', 'execute'), false, 'the freshness helper is not callable by app roles');

select * from finish();
rollback;
