-- Migration 0066: a worker may change name (audited) and sign-in phone (only via the code flow); everyone else stays locked.
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

insert into auth.users (id, aud, role, phone) values
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', '923001110001'),
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', '923001110002');
insert into public.profiles (id, role, full_name, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman One', '+923001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida One', '+923001110002', 'approved');
insert into public.worker_details (profile_id) values ('00000000-0000-0000-0000-0000000000b1');

-- name ---------------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.update_my_profile(p_full_name => 'Hacker') $$, null, 'name, gender, date of birth and CNIC are locked after approval; contact DHA staff', 'the old route stays locked after approval');
select lives_ok($$ select public.change_my_name('  Usman   Ali Khan ') $$, 'an approved worker can change the name');
select is((select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'Usman Ali Khan', 'spaces are tidied');
select throws_ok($$ select public.change_my_name('   ') $$, 'enter your full name', 'empty refused');
select throws_ok($$ select public.change_my_name('12345') $$, 'enter your full name', 'no letters refused');
select throws_ok($$ select public.change_my_name(repeat('a', 101)) $$, 'enter your full name', 'too long refused');
select lives_ok($$ select public.change_my_name('Usman Ali Khan') $$, 'the same name is a quiet no-op');
select tests.back();
select is((select count(*) from public.audit_log where action = 'worker_changed_name'), 1::bigint, 'one change is audited, the no-op is not');
select is((select old_data ->> 'full_name' from public.audit_log where action = 'worker_changed_name'), 'Usman One', 'with the old name');
select is((select new_data ->> 'full_name' from public.audit_log where action = 'worker_changed_name'), 'Usman Ali Khan', 'and the new name');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.change_my_name('Someone Else') $$, null, 'a customer cannot use it');
select tests.back();
select is(has_function_privilege('anon', 'public.change_my_name(text)', 'execute'), false, 'signed-out callers cannot call it');

-- phone --------------------------------------------------------------------------------------------------------------
-- a worker cannot jump to a number no code was sent to
select throws_ok($$ update auth.users set phone = '923009999999' where id = '00000000-0000-0000-0000-0000000000b1' $$, 'P0001', 'the sign-in number cannot be changed', 'no direct change');
select throws_ok($$ update auth.users set phone = null where id = '00000000-0000-0000-0000-0000000000b1' $$, 'P0001', 'the sign-in number cannot be changed', 'never cleared');
-- the code flow: GoTrue first stores the pending number, then moves it after the code is confirmed
select lives_ok($$ update auth.users set phone_change = '923007770001', phone_change_token = 'x' where id = '00000000-0000-0000-0000-0000000000b1' $$, 'a worker can start a number change');
select throws_ok($$ update auth.users set phone = '923009999999' where id = '00000000-0000-0000-0000-0000000000b1' $$, 'P0001', 'the sign-in number cannot be changed', 'still not to any other number');
select lives_ok($$ update auth.users set phone = '923007770001', phone_change = '', phone_change_token = '' where id = '00000000-0000-0000-0000-0000000000b1' $$, 'the confirmed number is accepted');
select is((select phone from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), '+923007770001', 'the profile phone follows');
select is((select new_data ->> 'phone' from public.audit_log where action = 'worker_changed_phone'), '+923007770001', 'the move is audited');
select is((select old_data ->> 'phone' from public.audit_log where action = 'worker_changed_phone'), '+923001110001', 'with the old number');
-- everyone else stays locked
select throws_ok($$ update auth.users set phone_change = '923007770002', phone_change_token = 'x' where id = '00000000-0000-0000-0000-0000000000a1' $$, 'P0001', 'the sign-in number cannot be changed', 'a customer cannot start a change');
select throws_ok($$ update auth.users set phone = '923007770002' where id = '00000000-0000-0000-0000-0000000000a1' $$, 'P0001', 'the sign-in number cannot be changed', 'nor move the number');

select * from finish();
rollback;
