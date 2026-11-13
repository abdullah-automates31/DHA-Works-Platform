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
create function tests.act_totp(p_uid uuid, p_session uuid, p_ts bigint) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_session, 'aal', 'aal2',
      'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', p_ts), json_build_object('method', 'password', 'timestamp', p_ts - 5)))::text, true);
  execute 'set local role authenticated';
end $$;
grant execute on function tests.act(uuid, uuid), tests.act_totp(uuid, uuid, bigint), tests.back() to authenticated;
create function tests.msg(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlerrm;
end $$;
grant execute on function tests.msg(text) to authenticated;
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

-- The admin has a registered authenticator; sessions a101 and a104 are aal2 sessions that used it (0052).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'test', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP');
insert into public.admin_totp_factors (factor_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1');
update auth.sessions set aal = 'aal2', factor_id = '00000000-0000-0000-0000-0000000000f1' where id in ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000a104');

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
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-000000000001', 'approve', 'ok', '{}'::jsonb)$$, 'P0001', 'confirm with a new code', 'admin_decide_verification needs a fresh code');
select throws_ok($$select public.admin_report_decide('00000000-0000-0000-0000-000000000001', 'close', 'because')$$, 'P0001', 'confirm with a new code', 'admin_report_decide needs a fresh code');
select throws_ok($$select public.admin_set_review_hidden('00000000-0000-0000-0000-000000000001', true, 'because')$$, 'P0001', 'confirm with a new code', 'admin_set_review_hidden needs a fresh code');
select throws_ok($$select public.admin_job_resume('00000000-0000-0000-0000-000000000001', 'because')$$, 'P0001', 'confirm with a new code', 'admin_job_resume needs a fresh code');
select throws_ok($$select public.admin_send_message('00000000-0000-0000-0000-000000000001', 'hello')$$, 'P0001', 'confirm with a new code', 'admin_send_message needs a fresh code');
select tests.back();

-- 2. A fresh session works -------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');
select is(public.admin_step_up_status(), 'fresh', 'a fresh session is reported fresh');
select lives_ok($$select public.admin_save_settings('1092', true, 7, 7)$$, 'a fresh session can save settings');
select lives_ok($$select public.invite_staff('new@test.dev')$$, 'and invite staff');
select lives_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b1', true, 'because')$$, 'and suspend a worker');
select isnt(tests.msg($$select public.admin_decide_verification('00000000-0000-0000-0000-000000000001', 'approve', 'ok', '{}'::jsonb)$$), 'confirm with a new code', 'a fresh session is not asked for a code by admin_decide_verification');
select isnt(tests.msg($$select public.admin_report_decide('00000000-0000-0000-0000-000000000001', 'close', 'because')$$), 'confirm with a new code', 'a fresh session is not asked for a code by admin_report_decide');
select isnt(tests.msg($$select public.admin_set_review_hidden('00000000-0000-0000-0000-000000000001', true, 'because')$$), 'confirm with a new code', 'a fresh session is not asked for a code by admin_set_review_hidden');
select isnt(tests.msg($$select public.admin_job_resume('00000000-0000-0000-0000-000000000001', 'because')$$), 'confirm with a new code', 'a fresh session is not asked for a code by admin_job_resume');
select isnt(tests.msg($$select public.admin_send_message('00000000-0000-0000-0000-000000000001', 'hello')$$), 'confirm with a new code', 'a fresh session is not asked for a code by admin_send_message');
select tests.back();

-- 3. A fresh authenticator code makes the stale session fresh (0052) -----------------------------------------------
select tests.act_totp('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101', extract(epoch from now())::bigint - 600);
select is(public.admin_mark_session_verified(), 'not_ready', 'a code typed 10 minutes ago does not freshen the session');
select is(public.admin_step_up_status(), 'needs_code', 'still stale');
select tests.back();
select tests.act_totp('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101', extract(epoch from now())::bigint);
select is(public.admin_mark_session_verified(), 'ok', 'a code typed just now is accepted');
select is(public.admin_step_up_status(), 'fresh', 'now fresh');
select lives_ok($$select public.admin_add_category('Tile Cleaning', 'Floors and grout')$$, 'the sensitive action now works');
select tests.back();
select is((select count(*)::int from public.audit_log where action = 'admin_step_up'), 1, 'the step-up is audited (not as a sign-in)');
select is((select count(*)::int from public.audit_log where action = 'admin_signed_in'), 0, 'and no extra sign-in is recorded');

-- 4. A step-up never works for a session that is not aal2 with the registered authenticator ------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.admin_mark_session_verified(), 'not_ready', 'a token without the aal2 claim cannot be marked');
select tests.back();

-- 5. An old verification still counts (no expiry), and a new code renews freshness -----------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104');
select is(public.is_admin(), true, 'a verification 5 hours old still counts (no expiry since the 14 Nov session migration)');
select is(public.admin_step_up_status(), 'needs_code', 'but it is not fresh');
select tests.back();
select tests.act_totp('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104', extract(epoch from now())::bigint);
select is(public.admin_mark_session_verified(), 'ok', 'a new authenticator code renews it');
select is(public.admin_step_up_status(), 'fresh', 'and it is fresh');
select tests.back();
select is((select count(*)::int from public.audit_log where action = 'admin_step_up'), 2, 'recorded as a second step-up');

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
