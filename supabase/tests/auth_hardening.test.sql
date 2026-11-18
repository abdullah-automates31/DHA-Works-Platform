-- Migration 0033: strict JSON for references, the contact phone follows the verified login phone, race-safe registration.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
grant execute on function tests.act(uuid), tests.back() to authenticated;

-- Phone accounts (auth phone has no plus sign, like GoTrue stores it) and one email account.
insert into auth.users (id, aud, role, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', '923001110001', now()),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', '923001110002', now());
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000b3', 'authenticated', 'authenticated', 'mail@test.dev');

-- ---------------------------------------------------------------- the contact phone is the verified phone
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.register_profile('worker', 'Usman One', '+923009999999', 'male', '1990-01-01', '42101-1234567-1') $$,
                'a phone account can register');
select tests.back();
select is((select phone from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), '+923001110001',
          'the typed phone is ignored: the profile gets the number that signed in');

select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select public.update_my_profile(null, '+923008888888') $$, 'an update with another phone does not fail');
select tests.back();
select is((select phone from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), '+923001110001',
          'a phone account cannot type a different contact phone');

-- An email account (no proven phone) cannot register at all (0062, audit 18 Nov).
select tests.act('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select public.register_profile('worker', 'Mail Worker', '03005550000', 'male', '1990-01-01', '42101-7654321-1') $$,
                 'P0001', 'sign in with your phone number first', 'an email account cannot register with a typed phone');
select tests.back();
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000b3'), 0, 'and no profile was created');
-- The reference checks below need a worker profile for b3: created here as test setup, not through the app.
insert into public.profiles (id, role, full_name, email, phone) values ('00000000-0000-0000-0000-0000000000b3', 'worker', 'Mail Worker', 'mail@test.dev', '+923005550000');
insert into public.worker_details (profile_id) values ('00000000-0000-0000-0000-0000000000b3');

-- ---------------------------------------------------------------- registration races and duplicates
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.register_profile('worker', 'Again', '+923000000000', 'male', '1990-01-01', '42101-1111111-1') $$,
                 'profile already exists', 'registering twice reports the existing profile cleanly');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select public.register_profile('worker', 'Copy', '+923000000000', 'male', '1990-01-01', '42101-1234567-1') $$,
                 '23505', null, 'a CNIC already used by another worker is refused (unique, not a race)');
select tests.back();
select throws_ok($$ insert into public.profiles (id, role, full_name, phone) values ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Dup', '+923001110001') $$,
                 '23505', null, 'two profiles cannot share a phone number');

-- ---------------------------------------------------------------- strict references
select tests.act('00000000-0000-0000-0000-0000000000b3');
select lives_ok($$ select public.set_my_references('[{"name":"Ali Raza","phone":"03001234567","address":"Phase 6"}]'::jsonb) $$, 'a valid reference list is accepted');
select is((select count(*)::int from public.worker_references where worker_id = '00000000-0000-0000-0000-0000000000b3'), 1, 'it is stored');
select throws_ok($$ select public.set_my_references('{"name":"x"}'::jsonb) $$, 'references must be a list', 'an object instead of a list is refused');
select throws_ok($$ select public.set_my_references('"text"'::jsonb) $$, 'references must be a list', 'a string is refused');
select throws_ok($$ select public.set_my_references('[1,2]'::jsonb) $$, 'a reference has the wrong shape or is too long', 'non-object elements are refused');
select throws_ok($$ select public.set_my_references('[{"name":"A","phone":"1","admin":true}]'::jsonb) $$, 'a reference has the wrong shape or is too long', 'unknown keys are refused');
select throws_ok($$ select public.set_my_references('[{"name":{"$ne":null},"phone":"1"}]'::jsonb) $$, 'a reference has the wrong shape or is too long', 'a nested operator object instead of a string is refused');
select throws_ok($$ select public.set_my_references('[{"name":"A","phone":123}]'::jsonb) $$, 'a reference has the wrong shape or is too long', 'a number instead of a string is refused');
select throws_ok($$ select public.set_my_references(('[' || repeat('{"name":"A","phone":"1"},', 5) || '{"name":"A","phone":"1"}]')::jsonb) $$, 'at most 5 references are allowed', 'more than 5 is refused');
select throws_ok($$ select public.set_my_references(jsonb_build_array(jsonb_build_object('name', repeat('x', 101), 'phone', '1'))) $$, 'a reference has the wrong shape or is too long', 'an over-long name is refused');
select is((select count(*)::int from public.worker_references where worker_id = '00000000-0000-0000-0000-0000000000b3'), 1, 'a refused call leaves the stored list untouched');
select lives_ok($$ select public.set_my_references('[]'::jsonb) $$, 'an empty list clears the references');
select lives_ok($$ select public.set_my_references(null) $$, 'null clears the references');
select tests.back();

select * from finish();
rollback;
