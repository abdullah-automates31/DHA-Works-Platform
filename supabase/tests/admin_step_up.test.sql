-- Migration 0048 asked for a code typed in the last 15 minutes before destructive actions. Since 0060 (18 Nov 2026) the
-- code is asked only at sign-in: any verified admin session may do them; password-only sessions and non-admins still may not.
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
  ('00000000-0000-0000-0000-00000000a105', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a901', '00000000-0000-0000-0000-0000000000a9'),
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-0000000000b1');
insert into public.admin_verified_sessions (session_id, user_id, verified_at, fresh_at) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1', now() - interval '1 hour', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1', now(), now()),
  ('00000000-0000-0000-0000-00000000a104', '00000000-0000-0000-0000-0000000000a1', now() - interval '5 hours', now() - interval '5 hours'),
  ('00000000-0000-0000-0000-00000000a105', '00000000-0000-0000-0000-0000000000a1', now() - interval '2 hours', now() - interval '2 hours');

-- The admin has a registered authenticator; sessions a101 and a104 are aal2 sessions that used it (0052).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'test', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP');
insert into public.admin_totp_factors (factor_id, user_id) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1');
update auth.sessions set aal = 'aal2', factor_id = '00000000-0000-0000-0000-0000000000f1' where id in ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000a104');

-- 1. Since 0060 the code is asked only at sign-in: an old verified session counts as fresh ------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.is_admin(), true, 'a session verified an hour ago is still a verified admin session');
select is(public.admin_step_up_status(), 'fresh', 'and the portal is not asked to send a new code (0060)');
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

-- 3. Since 0061 the old authenticator functions cannot be called, even by a verified admin with an aal2 token ------
select tests.act_totp('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101', extract(epoch from now())::bigint);
select throws_ok($$select public.admin_mark_session_verified()$$, '42501', null, 'admin_mark_session_verified is closed (0061)');
select throws_ok($$select public.admin_register_totp('00000000-0000-0000-0000-0000000000f1')$$, '42501', null, 'admin_register_totp is closed (0061)');
select throws_ok($$select public.admin_reset_totp()$$, '42501', null, 'admin_reset_totp is closed (0061)');
select throws_ok($$select public.admin_totp_status()$$, '42501', null, 'admin_totp_status is closed (0061)');
select throws_ok($$select public.admin_totp_factor()$$, '42501', null, 'admin_totp_factor is closed (0061)');
select throws_ok($$select public.admin_enroll_proof_status()$$, '42501', null, 'admin_enroll_proof_status is closed (0061)');
select tests.back();

-- 4. A verification never runs out (owner, 18 Nov 2026: an admin sign-in lasts until sign-out) ----------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104');
select is(public.is_admin(), true, 'a verification 5 hours old still counts');
select is(public.admin_step_up_status(), 'fresh', 'and it counts as fresh (0060)');
select tests.back();
update public.admin_verified_sessions set verified_at = now() - interval '400 days', fresh_at = now() - interval '400 days'
  where session_id = '00000000-0000-0000-0000-00000000a104';
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a104');
select is(public.is_admin(), true, 'a verification 400 days old still counts');
select lives_ok($$select public.admin_save_settings('1092', true, 7, 7)$$, 'and can still save settings');

-- 5. A verified session cannot touch its own verification row, and a guessed code changes nothing ----------------
select throws_ok($$insert into public.admin_verified_sessions (session_id, user_id) values (gen_random_uuid(), auth.uid())$$, '42501', null, 'cannot write a verification row');
select throws_ok($$update public.admin_verified_sessions set verified_at = now()$$, '42501', null, 'or change one');
select is(public.admin_verify_code('123456') = 'ok', false, 'a guessed code is not accepted');
select tests.back();

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

-- 7. A session verified two hours ago (no code since) is not asked for a new code by any sensitive function (0060) ---
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a105');
select isnt(tests.msg($$select public.invite_staff('new@test.dev')$$), 'confirm with a new code', 'invite_staff: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.revoke_staff_invite('00000000-0000-0000-0000-000000000001')$$), 'confirm with a new code', 'revoke_staff_invite: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_remove_staff('00000000-0000-0000-0000-000000000001', 'because')$$), 'confirm with a new code', 'admin_remove_staff: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b1', true, 'because')$$), 'confirm with a new code', 'admin_set_account_status: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_cancel_job('00000000-0000-0000-0000-000000000001', 'because')$$), 'confirm with a new code', 'admin_cancel_job: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_decide_cancellation('00000000-0000-0000-0000-000000000001', true, 'ok')$$), 'confirm with a new code', 'admin_decide_cancellation: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_job_replace_worker('00000000-0000-0000-0000-000000000001', 'because')$$), 'confirm with a new code', 'admin_job_replace_worker: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_save_settings('1092', true, 7, 7)$$), 'confirm with a new code', 'admin_save_settings: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_add_category('Painting', 'Walls')$$), 'confirm with a new code', 'admin_add_category: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_update_category(1::smallint, 'Plumbing', 'Pipes', true)$$), 'confirm with a new code', 'admin_update_category: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_set_phase_active(5::smallint, true)$$), 'confirm with a new code', 'admin_set_phase_active: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_decide_verification('00000000-0000-0000-0000-000000000001', 'approve', 'ok', '{}'::jsonb)$$), 'confirm with a new code', 'admin_decide_verification: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_reopen_rejected('00000000-0000-0000-0000-000000000001', 'because')$$), 'confirm with a new code', 'admin_reopen_rejected: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_report_decide('00000000-0000-0000-0000-000000000001', 'close', 'because')$$), 'confirm with a new code', 'admin_report_decide: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_set_review_hidden('00000000-0000-0000-0000-000000000001', true, 'because')$$), 'confirm with a new code', 'admin_set_review_hidden: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_job_resume('00000000-0000-0000-0000-000000000001', 'because')$$), 'confirm with a new code', 'admin_job_resume: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_send_message('00000000-0000-0000-0000-000000000001', 'hello')$$), 'confirm with a new code', 'admin_send_message: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_dues_payment_decide('00000000-0000-0000-0000-000000000001', true, null, null)$$), 'confirm with a new code', 'admin_dues_payment_decide: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_dues_record_payment('00000000-0000-0000-0000-0000000000b1', 100, 'office_cash', null, null)$$), 'confirm with a new code', 'admin_dues_record_payment: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_dues_waive('00000000-0000-0000-0000-000000000001', 'because')$$), 'confirm with a new code', 'admin_dues_waive: no new code needed after sign-in (0060)');
select isnt(tests.msg($$select public.admin_dues_warn('00000000-0000-0000-0000-0000000000b1', 'please pay')$$), 'confirm with a new code', 'admin_dues_warn: no new code needed after sign-in (0060)');
select tests.back();

select * from finish();
rollback;
