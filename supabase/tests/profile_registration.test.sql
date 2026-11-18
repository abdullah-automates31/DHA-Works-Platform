-- register_profile and update_my_profile (worker app W02): creation, repeats, validation, privacy, locks.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', p_uid)::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.signed_out() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
grant execute on function tests.act(uuid), tests.signed_out(), tests.back() to authenticated;

-- Auth users only: no profile rows exist until register_profile runs. Users 01-09 signed in by phone OTP (phone
-- proven) and also have an email; user 10 is an email-only account (0062: it may not register).
insert into auth.users (id, aud, role, email, phone, phone_confirmed_at)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'u' || n || '@test.dev', '9230011000' || n, now()
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09']) n;
insert into auth.users (id, aud, role, email) values ('00000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'u10@test.dev');

-- ---------------------------------------------------------------- signed out and bad roles
select tests.signed_out();
select throws_ok($$select public.register_profile('worker', 'No One', '+923001112222')$$, '28000', null,
  'registering without a signed-in user is refused');

select tests.act('00000000-0000-0000-0000-000000000001');
select throws_ok($$select public.register_profile('admin', 'Sneaky', '+923001112222')$$, null,
  'only resident and worker accounts can be registered here', 'nobody can register themselves as admin');
select is((select count(*) from public.profiles), 0::bigint, 'a refused registration leaves no row');

-- ---------------------------------------------------------------- worker registration
select lives_ok($$
  select public.register_profile('worker', '  Usman   Khan ', ' +923214567890 ', 'male', date '1994-03-14', '42101-5678901-3')
$$, 'a new worker registers');
select tests.back();

select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 'worker', 'role is worker');
select is((select verification_status::text from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 'incomplete',
  'a new worker starts as incomplete');
select is((select account_status::text from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 'active', 'and active');
select is((select email from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 'u01@test.dev',
  'the email comes from the auth user, not from the app');
select is((select full_name from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 'Usman   Khan',
  'the name is trimmed at the ends (inner spacing is the app''s job)');
select is((select phone from public.profiles where id = '00000000-0000-0000-0000-000000000001'), '+923001100001', 'the phone is the number that signed in (the typed one is ignored)');
select is((select date_of_birth from public.profiles where id = '00000000-0000-0000-0000-000000000001'), date '1994-03-14', 'date of birth is stored');
select is((select cnic from public.profiles where id = '00000000-0000-0000-0000-000000000001'), '42101-5678901-3', 'CNIC is stored');
select is((select count(*) from public.worker_details where profile_id = '00000000-0000-0000-0000-000000000001'), 1::bigint,
  'a worker_details row is created for a worker');
select is((select count(*) from public.audit_log where action = 'register_profile'
           and actor_id = '00000000-0000-0000-0000-000000000001'), 1::bigint, 'registration is audited');

-- ---------------------------------------------------------------- repeats
select tests.act('00000000-0000-0000-0000-000000000001');
select throws_ok($$select public.register_profile('worker', 'Usman Khan', '+923214567890')$$, null, 'profile already exists',
  'a repeat registration is refused with the known message');
select throws_ok($$select public.register_profile('resident', 'Usman Khan', '+923214567890')$$, null, 'profile already exists',
  'a different role does not create a second profile');
select tests.back();
select is((select count(*) from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 1::bigint, 'still exactly one profile');
select is((select count(*) from public.worker_details where profile_id = '00000000-0000-0000-0000-000000000001'), 1::bigint,
  'still exactly one worker_details row');

-- ---------------------------------------------------------------- blanks and validation
select tests.act('00000000-0000-0000-0000-000000000003');
select lives_ok($$select public.register_profile('worker', '   ', '', null, null, '')$$, 'blank fields are accepted at registration');
select tests.back();
select ok((select full_name is null and cnic is null and phone = '+923001100003' from public.profiles
           where id = '00000000-0000-0000-0000-000000000003'), 'blank text is stored as null (submit_for_review checks completeness); the phone is the signed-in number');

select tests.act('00000000-0000-0000-0000-000000000004');
select throws_ok($$select public.register_profile('worker', 'Bad Cnic', '+923001112222', 'male', date '1990-01-01', '12345')$$,
  '23514', null, 'a malformed CNIC is refused');
select throws_ok($$select public.register_profile('worker', 'Bad Cnic', '+923001112222', 'male', date '1990-01-01', '4210156789013')$$,
  '23514', null, 'a CNIC without dashes is refused');
select tests.back();
select tests.act('00000000-0000-0000-0000-000000000010');
select throws_ok($$select public.register_profile('worker', 'Email Only', '+923001112222')$$, 'P0001', 'sign in with your phone number first',
  'an email-only account cannot register, whatever phone it types (0062)');
select throws_ok($$select public.register_profile('resident', 'Email Only', '+923001112222')$$, 'P0001', 'sign in with your phone number first',
  'not as a resident either');
select tests.back();
select is((select count(*) from public.profiles where id = '00000000-0000-0000-0000-000000000010'), 0::bigint, 'the email-only account has no profile');
select is((select count(*) from public.profiles where id = '00000000-0000-0000-0000-000000000004'), 0::bigint,
  'refused registrations leave no profile behind');

-- ---------------------------------------------------------------- one CNIC per role
select tests.act('00000000-0000-0000-0000-000000000005');
select throws_ok($$select public.register_profile('worker', 'Copycat', '+923001112222', 'male', date '1990-01-01', '42101-5678901-3')$$,
  '23505', null, 'the same CNIC cannot register a second worker account');
select lives_ok($$select public.register_profile('resident', 'Same Person', '+923001112222', 'male', date '1990-01-01', '42101-5678901-3')$$,
  'the same CNIC may hold one resident account as well');
select tests.back();

-- ---------------------------------------------------------------- update_my_profile
select tests.act('00000000-0000-0000-0000-000000000006');
select throws_ok($$select public.update_my_profile('Nobody')$$, null, 'no profile', 'update without a profile is refused');

select tests.act('00000000-0000-0000-0000-000000000001');
select lives_ok($$select public.update_my_profile()$$, 'an update with no values changes nothing');
select is((select cnic from public.profiles where id = '00000000-0000-0000-0000-000000000001'), '42101-5678901-3', 'null leaves values unchanged');
select lives_ok($$select public.update_my_profile('  Usman Ali Khan ')$$, 'name can be corrected before approval');
select throws_ok($$select public.update_my_profile(p_cnic => '42101-5678901')$$, '23514', null, 'a malformed CNIC is refused on update');
select lives_ok($$select public.update_my_profile(p_phone => '12')$$, 'a typed phone on update is ignored for a phone account');
select tests.back();
select is((select phone from public.profiles where id = '00000000-0000-0000-0000-000000000001'), '+923001100001', 'the phone stays the signed-in number');
select is((select full_name from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 'Usman Ali Khan', 'the corrected name is stored');
select is((select cnic from public.profiles where id = '00000000-0000-0000-0000-000000000001'), '42101-5678901-3', 'a refused update changed nothing');

-- A second worker cannot take the first one's CNIC by updating.
select tests.act('00000000-0000-0000-0000-000000000003');
select throws_ok($$select public.update_my_profile(p_cnic => '42101-5678901-3')$$, '23505', null,
  'updating to another worker''s CNIC is refused');
select throws_ok($$select public.update_my_profile(p_avatar_path => '00000000-0000-0000-0000-000000000001/x.jpg')$$, null, 'invalid file path',
  'an avatar path in someone else''s folder is refused');
select tests.back();

-- After approval identity is locked but contact details can change.
update public.profiles set verification_status = 'approved' where id = '00000000-0000-0000-0000-000000000001';
select tests.act('00000000-0000-0000-0000-000000000001');
select throws_ok($$select public.update_my_profile('New Name')$$, null,
  'name, gender, date of birth and CNIC are locked after approval; contact DHA staff', 'name is locked after approval');
select throws_ok($$select public.update_my_profile(p_cnic => '42101-1111111-1')$$, null,
  'name, gender, date of birth and CNIC are locked after approval; contact DHA staff', 'CNIC is locked after approval');
select lives_ok($$select public.update_my_profile(p_phone => '+923331234567')$$, 'phone can still change after approval');
select tests.back();

-- ---------------------------------------------------------------- privacy: who can read a profile
insert into public.profiles (id, role, full_name, email, verification_status)
values ('00000000-0000-0000-0000-000000000007', 'admin', 'Staff', 'u07@test.dev', 'approved');
-- The test admin has passed the second step (migration 0037: is_admin() needs a verified session).
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000007');
insert into public.admin_verified_sessions (session_id, user_id) values ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000007');

select tests.act('00000000-0000-0000-0000-000000000003');
select is((select count(*) from public.profiles where id = '00000000-0000-0000-0000-000000000001'), 0::bigint,
  'another worker cannot read this worker''s profile (CNIC, date of birth)');
select is((select count(*) from public.profiles where id = '00000000-0000-0000-0000-000000000003'), 1::bigint, 'a user reads their own profile');
select tests.act('00000000-0000-0000-0000-000000000007');
select ok((select count(*) from public.profiles where id = '00000000-0000-0000-0000-000000000001') = 1,
  'staff can read worker profiles (to verify identity)');
select tests.back();

select is((select count(*) from information_schema.columns
           where table_schema = 'public' and table_name <> 'profiles' and column_name in ('cnic', 'date_of_birth')),
  0::bigint, 'no other table or view exposes CNIC or date of birth');

-- ---------------------------------------------------------------- the apps cannot write profiles directly
select tests.act('00000000-0000-0000-0000-000000000003');
select throws_ok($$insert into public.profiles (id, role) values ('00000000-0000-0000-0000-000000000009', 'worker')$$, '42501', null,
  'a signed-in user cannot insert a profile directly');
select throws_ok($$update public.profiles set verification_status = 'approved' where id = '00000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'a user cannot approve themselves');
select throws_ok($$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'a user cannot change their own role');
select throws_ok($$update public.profiles set cnic = '42101-9999999-9' where id = '00000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'a user cannot write CNIC directly');
select tests.back();

select * from finish();
rollback;
