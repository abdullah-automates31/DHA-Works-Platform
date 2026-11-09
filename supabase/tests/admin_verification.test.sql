-- Migrations 0038 and 0039: verification queue, decisions, suspend / reactivate. Every call is tried by the
-- wrong people first (password-only admin, resident, worker, anon) and only then by a verified admin.
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

-- People ------------------------------------------------------------------------------------------------------
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'admin@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'admin2@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'res2@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev'),
  ('00000000-0000-0000-0000-0000000000b3', 'authenticated', 'authenticated', 'w3@test.dev'),
  ('00000000-0000-0000-0000-0000000000b4', 'authenticated', 'authenticated', 'w4@test.dev'),
  ('00000000-0000-0000-0000-0000000000b5', 'authenticated', 'authenticated', 'w5@test.dev');
insert into public.profiles (id, role, full_name, email, phone, cnic, verification_status, verification_updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Staff A', 'admin@test.dev', '03009990001', null, 'approved', null),
  ('00000000-0000-0000-0000-0000000000a2', 'admin', 'Staff B', 'admin2@test.dev', '03009990002', null, 'approved', null),
  ('00000000-0000-0000-0000-0000000000c1', 'resident', 'Rida Resident', 'res@test.dev', '03001110001', '42101-1234567-1', 'approved', null),
  ('00000000-0000-0000-0000-0000000000c2', 'resident', 'Maryam Pending', 'res2@test.dev', '03001110002', '42201-7654321-3', 'pending', now() - interval '9 hours'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Ali Raza', 'w1@test.dev', '03213334444', '42101-5550114-7', 'pending', now() - interval '20 hours'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Imran Qureshi', 'w2@test.dev', '03005556666', '42101-5550171-9', 'pending', now() - interval '14 hours'),
  ('00000000-0000-0000-0000-0000000000b3', 'worker', 'Not Submitted', 'w3@test.dev', '03007778888', null, 'incomplete', null),
  ('00000000-0000-0000-0000-0000000000b4', 'worker', 'Kamran Approved', 'w4@test.dev', '03009990004', '42101-5550149-2', 'approved', now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000000b5', 'worker', 'Zubair Visit', 'w5@test.dev', '03339990005', '42101-5550192-5', 'visit_hq', now() - interval '5 hours');
insert into public.worker_details (profile_id, voice_intro_path) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1/voice.m4a'),
  ('00000000-0000-0000-0000-0000000000b2', null),
  ('00000000-0000-0000-0000-0000000000b3', null),
  ('00000000-0000-0000-0000-0000000000b4', null),
  ('00000000-0000-0000-0000-0000000000b5', null);
insert into public.worker_categories (worker_id, category_id) values
  ('00000000-0000-0000-0000-0000000000b1', 1), ('00000000-0000-0000-0000-0000000000b2', 2),
  ('00000000-0000-0000-0000-0000000000b4', 1), ('00000000-0000-0000-0000-0000000000b5', 1);
insert into public.worker_areas (worker_id, phase) values
  ('00000000-0000-0000-0000-0000000000b1', 5), ('00000000-0000-0000-0000-0000000000b1', 6),
  ('00000000-0000-0000-0000-0000000000b2', 6), ('00000000-0000-0000-0000-0000000000b4', 6),
  ('00000000-0000-0000-0000-0000000000b5', 6);
insert into public.verification_documents (profile_id, doc_type, storage_path) values
  ('00000000-0000-0000-0000-0000000000b1', 'cnic_front', '00000000-0000-0000-0000-0000000000b1/cnic_front.jpg'),
  ('00000000-0000-0000-0000-0000000000b1', 'cnic_back', '00000000-0000-0000-0000-0000000000b1/cnic_back.jpg'),
  ('00000000-0000-0000-0000-0000000000b1', 'police_cert', '00000000-0000-0000-0000-0000000000b1/police.jpg'),
  ('00000000-0000-0000-0000-0000000000b2', 'cnic_front', '00000000-0000-0000-0000-0000000000b2/cnic_front.jpg');
insert into public.addresses (id, resident_id, phase, lane, plot_no, is_default) values
  ('00000000-0000-0000-0000-00000000ad02', '00000000-0000-0000-0000-0000000000c2', 7, 'Lane 3', '45-A', true);

-- Sessions: admin A has a verified one (s1) and a password-only one (s2); admin B is verified too (for second opinions).
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-0000000000b1');
insert into public.admin_verified_sessions (session_id, user_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000a201', '00000000-0000-0000-0000-0000000000a2');

-- 1. The wrong people ----------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a102');   -- admin, password only
select throws_ok($$select public.admin_verification_counts('worker')$$, '42501', 'not available', 'password-only admin: counts refused');
select throws_ok($$select public.admin_verification_queue('worker', 'pending')$$, '42501', 'not available', 'password-only admin: queue refused');
select throws_ok($$select public.admin_verification_detail('00000000-0000-0000-0000-0000000000b1')$$, '42501', 'not available', 'password-only admin: detail refused');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b1', 'approve', null, '{"a":true}')$$, '42501', 'not available', 'password-only admin: decision refused');
select throws_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b1', true, 'because')$$, '42501', 'not available', 'password-only admin: suspend refused');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000c1');                                       -- resident
select throws_ok($$select public.admin_verification_queue('worker', 'pending')$$, '42501', 'not available', 'resident: queue refused');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b1', 'approve', null, '{"a":true}')$$, '42501', 'not available', 'resident: cannot approve a worker');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000c1', 'approve', null, '{"a":true}')$$, '42501', 'not available', 'resident: cannot approve themselves');
select throws_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b1', true, 'because')$$, '42501', 'not available', 'resident: cannot suspend a worker');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000b101'); -- worker
select throws_ok($$select public.admin_verification_detail('00000000-0000-0000-0000-0000000000b2')$$, '42501', 'not available', 'worker: cannot open another applicant');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b1', 'approve', null, '{"a":true}')$$, '42501', 'not available', 'worker: cannot approve themselves');
select tests.back();
select is(has_function_privilege('anon', 'public.admin_verification_queue(public.user_role, public.verification_status, text, smallint, integer, integer)', 'execute'), false, 'anon cannot run the queue');
select is(has_function_privilege('anon', 'public.admin_decide_verification(uuid, public.verification_decision, text, jsonb)', 'execute'), false, 'anon cannot decide');
select is(has_function_privilege('anon', 'public.admin_set_account_status(uuid, boolean, text)', 'execute'), false, 'anon cannot suspend');

-- 2. The queue ------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is(public.admin_verification_counts('worker'), '{"pending":2,"approved":1,"visit_hq":1}'::jsonb, 'worker counts (incomplete applications are not counted)');
select is(public.admin_verification_counts('resident'), '{"pending":1,"approved":1}'::jsonb, 'resident counts');
select throws_ok($$select public.admin_verification_counts('admin')$$, 'P0001', 'role must be worker or resident', 'admins are not in the queue');
select is((public.admin_verification_queue('worker', 'pending') ->> 'total')::int, 2, 'two pending workers');
select is(public.admin_verification_queue('worker', 'pending') -> 'rows' -> 0 ->> 'full_name', 'Ali Raza', 'the longest-waiting worker is first');
select is(public.admin_verification_queue('worker', 'pending') -> 'rows' -> 1 ->> 'full_name', 'Imran Qureshi', 'then the next');
select is(public.admin_verification_queue('worker', 'pending') -> 'rows' -> 0 -> 'extra' -> 'has_voice', 'true'::jsonb, 'the voice flag is shown');
select is(public.admin_verification_queue('worker', 'pending') -> 'rows' -> 0 -> 'documents', '["cnic_front","cnic_back","police_cert"]'::jsonb, 'the documents present are listed');
select is(public.admin_verification_queue('worker', 'pending') -> 'rows' -> 0 -> 'extra' -> 'phases', '[5,6]'::jsonb, 'areas are listed');
select is(public.admin_verification_queue('worker', 'visit_hq') -> 'rows' -> 0 ->> 'full_name', 'Zubair Visit', 'the Visit HQ tab');
select is((public.admin_verification_queue('worker', 'pending', null, 2::smallint) ->> 'total')::int, 1, 'filter by category');
select is((public.admin_verification_queue('worker', 'pending', 'imran') ->> 'total')::int, 1, 'search by name, any case');
select is((public.admin_verification_queue('worker', 'pending', '5550114') ->> 'total')::int, 1, 'search by part of the CNIC');
select is((public.admin_verification_queue('worker', 'pending', '%') ->> 'total')::int, 0, 'a % in the search is a literal, not a wildcard');
select is((public.admin_verification_queue('worker', 'pending', '_') ->> 'total')::int, 0, 'and so is an underscore');
select throws_ok($$select public.admin_verification_queue('worker', 'pending', repeat('x', 81))$$, 'P0001', 'search is too long', 'a very long search is refused');
select is(jsonb_array_length(public.admin_verification_queue('worker', 'pending', null, null, 1, 0) -> 'rows'), 1, 'paging: one row per page');
select is(public.admin_verification_queue('worker', 'pending', null, null, 1, 1) -> 'rows' -> 0 ->> 'full_name', 'Imran Qureshi', 'paging: the second page');
select is(jsonb_array_length(public.admin_verification_queue('worker', 'pending', null, null, 100000, 0) -> 'rows'), 2, 'a huge limit is clamped, not an error');
select ok(position('5550114' in public.admin_verification_queue('worker', 'pending')::text) = 0, 'the queue never carries a CNIC number');
select is(public.admin_verification_queue('resident', 'pending') -> 'rows' -> 0 -> 'extra' -> 'address' ->> 'plot_no', '45-A', 'a resident row shows the address');
select is((public.admin_verification_queue('resident', 'pending', null, 7::smallint) ->> 'total')::int, 1, 'filter residents by phase');
select is((public.admin_verification_queue('resident', 'pending', null, 5::smallint) ->> 'total')::int, 0, 'another phase is empty');
select is((public.admin_verification_queue('resident', 'pending', '45-A') ->> 'total')::int, 1, 'search by plot');

-- 3. The detail screen -----------------------------------------------------------------------------------------------
select is(public.admin_verification_detail('00000000-0000-0000-0000-0000000000b1') ->> 'cnic_masked', '42101-*******-7', 'the CNIC is masked');
select ok(position('5550114' in public.admin_verification_detail('00000000-0000-0000-0000-0000000000b1')::text) = 0, 'the full CNIC is not in the detail');
select is(jsonb_array_length(public.admin_verification_detail('00000000-0000-0000-0000-0000000000b1') -> 'documents'), 3, 'document paths are returned');
select is(public.admin_verification_detail('00000000-0000-0000-0000-0000000000b1') -> 'categories', '["Plumbing"]'::jsonb, 'worker trades are returned') ;
select throws_ok($$select public.admin_verification_detail('00000000-0000-0000-0000-0000000000b3')$$, 'P0001', 'no such application', 'an incomplete profile has nothing to review');
select throws_ok($$select public.admin_verification_detail('00000000-0000-0000-0000-0000000000a2')$$, 'P0001', 'no such application', 'an admin account cannot be opened here');
select tests.back();
select ok((select count(*) from public.audit_log where action = 'verification_viewed' and record_id = '00000000-0000-0000-0000-0000000000b1') >= 1, 'opening an applicant is audited');

-- 4. Decisions ------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b1', 'approve', null, '{"cnic":true,"photo":false}')$$, 'P0001', 'tick every checklist item before approving', 'approve with an unticked item is refused');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b1', 'approve', null, '{}')$$, 'P0001', 'tick every checklist item before approving', 'approve with an empty checklist is refused');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b1', 'approve', null, null)$$, 'P0001', 'the checklist is required', 'approve with no checklist is refused');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b2', 'reject', null, '{"cnic":false}')$$, 'P0001', 'write a reason the applicant will see', 'reject without a reason is refused');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b2', 'visit_hq', '  ', '{"cnic":false}')$$, 'P0001', 'write a reason the applicant will see', 'a blank reason does not count');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b2', 'reject', repeat('x', 501), '{"cnic":false}')$$, 'P0001', 'the reason is too long (500 characters at most)', 'a 501-character reason is refused');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000a1', 'approve', null, '{"a":true}')$$, 'P0001', 'you cannot decide on your own account', 'staff cannot decide on themselves');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000a2', 'approve', null, '{"a":true}')$$, 'P0001', 'no such application', 'staff cannot decide on another admin');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b3', 'approve', null, '{"a":true}')$$, 'P0001', 'this application is not waiting for a decision', 'an incomplete application cannot be approved');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b4', 'reject', 'changed my mind', '{"a":false}')$$, 'P0001', 'this application is not waiting for a decision', 'an approved worker cannot be rejected here');
select is((select count(*) from public.verification_decisions), 0::bigint, 'none of the refused calls left a decision behind');

select lives_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b1', 'approve', null, '{"cnic":true,"photo":true,"police":true,"voice":true}')$$, 'approve with everything ticked');
select is((select verification_status::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'approved', 'the worker is approved');
select is((select count(*) from public.verification_decisions where profile_id = '00000000-0000-0000-0000-0000000000b1' and decision = 'approve'), 1::bigint, 'the decision and its checklist are kept');
select tests.back();
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'verification_decided' and payload = '{"decision":"approve"}'::jsonb), 1::bigint, 'the worker is told, without any reason text in the notice');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select is((select count(*) from public.audit_log where action = 'verification_approve' and actor_id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint, 'the approval is audited');
select throws_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b1', 'reject', 'too late', '{"a":false}')$$, 'P0001', 'this application is not waiting for a decision', 'a second decision on the same application is refused');
select lives_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b2', 'reject', 'CNIC photo is unreadable. Upload a clear one.', '{"cnic":false}')$$, 'reject with a reason');
select is((select verification_reason from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'CNIC photo is unreadable. Upload a clear one.', 'the applicant can see the reason');
select lives_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000c2', 'ask_for_changes', 'Utility bill is blurry.', '{"bill":false}')$$, 'ask a resident for changes');
select is((select verification_status::text from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'), 'needs_changes', 'the resident is sent back to fix it');
select lives_ok($$select public.admin_decide_verification('00000000-0000-0000-0000-0000000000b5', 'approve', null, '{"cnic":true}')$$, 'a worker who visited HQ can be approved afterwards');
select tests.back();

-- 5. Suspend and reactivate (0039) ------------------------------------------------------------------------------------
-- A scheduled job for worker b1 (the worker claims an open job with a price, the customer accepts it; 0043).
create function tests.make_job(p_title text) returns uuid language plpgsql as $$
declare v_job uuid; v_addr uuid;
begin
  perform tests.act('00000000-0000-0000-0000-0000000000c1');
  v_addr := public.upsert_address(null, 'Home', 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing today', 'asap', null, null, null, null,
                                 array['00000000-0000-0000-0000-0000000000c1/p1.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;
create temp table t as select tests.make_job('Fix a pipe') as job;
grant select on t to authenticated;
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.accept_job((select job from t), 3000, 500, 'pipes')$$, 'worker accepts the job (set-up)');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select public.accept_quote((select id from public.resident_quotes where job_id = (select job from t)))$$, 'the customer accepts the quote (set-up)');
select tests.back();
insert into public.device_tokens (user_id, push_token, platform) values ('00000000-0000-0000-0000-0000000000b1', 'ExponentPushToken[abcdefghijklmnopqrstuv]', 'android');

select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select throws_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b1', true, '')$$, 'P0001', 'write a reason (3 to 500 characters)', 'suspending needs a reason');
select throws_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000a1', true, 'because')$$, 'P0001', 'you cannot change your own account', 'staff cannot suspend themselves');
select throws_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000a2', true, 'because')$$, 'P0001', 'no such user', 'staff cannot suspend another admin');
select throws_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b4', false, 'because')$$, 'P0001', 'this account is not suspended', 'reactivating an active account is refused');
select lives_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b1', true, 'Unsafe report confirmed')$$, 'suspend a worker');
select is((select account_status::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'suspended', 'the worker is suspended');
select is((select suspension_reason from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'Unsafe report confirmed', 'with the reason');
select throws_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b1', true, 'again')$$, 'P0001', 'this account is already suspended', 'suspending twice is refused');
select is((select under_review_reason from public.jobs where id = (select job from t)), 'worker_suspended', 'the worker''s live job is flagged for staff');
select tests.back();
select is((select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b1'), 0::bigint, 'the worker''s sessions ended');
select is((select count(*) from public.device_tokens where user_id = '00000000-0000-0000-0000-0000000000b1'), 0::bigint, 'and the push tokens are gone');
select is((select count(*) from public.audit_log where action = 'account_suspended'), 1::bigint, 'the suspension is audited with the reason');
select tests.act('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a101');
select lives_ok($$select public.admin_set_account_status('00000000-0000-0000-0000-0000000000b1', false, 'Cleared after the visit')$$, 'reactivate');
select is((select account_status::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'active', 'active again');
select is((select suspension_reason from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), null, 'the suspension reason is cleared');
select tests.back();
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'account_reactivated'), 1::bigint, 'the worker is told');

select * from finish();
rollback;
