-- Who can read or change notifications and device tokens (the data the send-push function uses).
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

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'n1@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'n2@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'One', 'n1@test.dev', '03001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000a2', 'resident', 'Two', 'n2@test.dev', '03001110002', 'approved');
insert into public.notifications (user_id, type, payload) values
  ('00000000-0000-0000-0000-0000000000a1', 'quote_received', '{"title":"A job"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'quote_accepted', '{"title":"B job"}');

-- Notifications: owners read their own rows only and cannot create or edit any.
select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from public.notifications), 1::bigint, 'a user reads only their own notifications');
select throws_ok($$insert into public.notifications (user_id, type) values ('00000000-0000-0000-0000-0000000000a2', 'quote_accepted')$$,
  null, null, 'a user cannot send a notification to someone else');
select throws_ok($$insert into public.notifications (user_id, type) values (auth.uid(), 'quote_accepted')$$,
  null, null, 'a user cannot create notifications for themselves either');
select throws_ok($$update public.notifications set push_sent_at = now()$$, null, null, 'a user cannot mark pushes as sent');
select throws_ok($$delete from public.notifications$$, null, null, 'a user cannot delete notifications');
select lives_ok($$select public.mark_notifications_read(null)$$, 'a user marks their own notifications read');
select is((select count(*) from public.notifications where read_at is not null), 1::bigint, 'only their own row changed');
select tests.back();
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a2' and read_at is not null),
  0::bigint, 'the other user''s notification is untouched');

-- Device tokens: unreadable and unwritable directly; the RPC only ever writes the caller's own row.
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.register_device_token('ExponentPushToken[user_one_token_0001]', 'android')$$, 'a user registers their device');
select throws_ok($$select count(*) from public.device_tokens$$, null, null, 'a user cannot read device tokens, not even their own');
select throws_ok($$insert into public.device_tokens (user_id, push_token, platform)
  values ('00000000-0000-0000-0000-0000000000a2', 'ExponentPushToken[planted_on_user_two]', 'android')$$, null, null,
  'a user cannot plant a token on another account');
select throws_ok($$delete from public.device_tokens$$, null, null, 'a user cannot delete tokens directly');
select throws_ok($$select public.register_device_token('x', 'windows')$$, null, null, 'an unknown platform is refused');
select tests.back();
select is((select user_id from public.device_tokens where push_token = 'ExponentPushToken[user_one_token_0001]'),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'the token is stored against the caller');

-- A phone belongs to one account at a time: signing in as someone else moves the token, never copies it.
select tests.act('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.register_device_token('ExponentPushToken[user_one_token_0001]', 'android')$$, 'the same phone signs in as user two');
select tests.back();
select is((select count(*) from public.device_tokens where push_token = 'ExponentPushToken[user_one_token_0001]'), 1::bigint,
  'the token exists once');
select is((select user_id from public.device_tokens where push_token = 'ExponentPushToken[user_one_token_0001]'),
  '00000000-0000-0000-0000-0000000000a2'::uuid, 'and now belongs to user two, so user one gets no pushes on that phone');

-- Signing out removes the phone's token, and only from the caller's own account.
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.unregister_device_token('ExponentPushToken[user_one_token_0001]')$$,
  'user one may call unregister for a token they no longer own');
select tests.back();
select is((select count(*) from public.device_tokens where push_token = 'ExponentPushToken[user_one_token_0001]'), 1::bigint,
  'but it does not remove user two''s token');
select tests.act('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.unregister_device_token('ExponentPushToken[user_one_token_0001]')$$, 'user two signs out on that phone');
select tests.back();
select is((select count(*) from public.device_tokens where push_token = 'ExponentPushToken[user_one_token_0001]'), 0::bigint,
  'the token is gone, so the phone gets no more pushes');

-- Anonymous callers get nothing.
set local role anon;
select throws_ok($$select count(*) from public.notifications$$, null, null, 'anon cannot read notifications');
select throws_ok($$select public.register_device_token('ExponentPushToken[anon_token_000001]', 'android')$$, null, null,
  'anon cannot register a token');
select throws_ok($$select public.unregister_device_token('ExponentPushToken[anon_token_000001]')$$, null, null,
  'anon cannot remove a token');
select throws_ok($$select public.push_webhook_secret_matches('guess')$$, null, null, 'anon cannot probe the push secret');
reset role;
set local role authenticated;
select throws_ok($$select public.push_webhook_secret_matches('guess')$$, null, null, 'a signed-in user cannot probe the push secret');
reset role;

select * from finish();
rollback;
