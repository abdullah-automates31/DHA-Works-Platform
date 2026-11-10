-- 0029: the rewritten worker_feed shows exactly the same jobs as the version before it (0027), for every kind of worker.
-- The old definition is recreated here as worker_feed_v27 (rolled back at the end) and the two are compared per worker.
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

-- the 0027 definition, verbatim apart from its name and one change: a quoted job is locked to one worker and leaves the
-- feed since 0043 (customer accepts the quote), so 'quoted' is no longer in the status list
create view public.worker_feed_v27 with (security_invoker = false) as
select j.id, j.code, j.status, j.title, j.description, j.category_id, c.name as category_name,
  j.phase, j.lane, j.urgency, j.preferred_date, j.window_from, j.window_to, j.voice_note_path, j.posted_at,
  j.posted_at + make_interval(hours => private.setting_int('job_expiry_hours', 24)) as expires_at,
  (select count(*) from public.job_interests i where i.job_id = j.id and i.withdrawn_at is null) as interest_count,
  (select count(*) from public.job_views v where v.job_id = j.id) as viewed_count,
  (select count(*) from public.job_photos p where p.job_id = j.id) as photo_count,
  (select p.storage_path from public.job_photos p where p.job_id = j.id order by p.sort limit 1) as thumb_path,
  (select count(*) from public.quotes q where q.job_id = j.id and q.status = 'sent') as quote_count,
  (select array_agg(t.storage_path order by t.sort)
     from (select p.storage_path, p.sort from public.job_photos p where p.job_id = j.id order by p.sort limit 2) t) as thumb_paths
from public.jobs j
join public.categories c on c.id = j.category_id
where j.status in ('open', 'interested')
  and j.posted_at + make_interval(hours => private.setting_int('job_expiry_hours', 24)) > now()
  and public.worker_matches_job(j.category_id, j.phase)
  and not public.worker_has_stake(j.id);
grant select on public.worker_feed_v27 to authenticated;

-- people: one resident and nine workers
insert into auth.users (id, aud, role, email)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'q' || n || '@test.dev'
from unnest(array['a1', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']) n;
insert into public.profiles (id, role, full_name, email, phone, verification_status, account_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Resident', 'q1@test.dev', '+923215550001', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000c1', 'worker', 'Approved trade1 phase6', 'q2@test.dev', '+923001110011', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000c2', 'worker', 'Pending', 'q3@test.dev', '+923001110012', 'pending', 'active'),
  ('00000000-0000-0000-0000-0000000000c3', 'worker', 'Suspended', 'q4@test.dev', '+923001110013', 'approved', 'suspended'),
  ('00000000-0000-0000-0000-0000000000c4', 'worker', 'No areas', 'q5@test.dev', '+923001110014', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000c5', 'worker', 'Trade 2 only', 'q6@test.dev', '+923001110015', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000c6', 'worker', 'Trades 1+2 phases 6+7', 'q7@test.dev', '+923001110016', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000c7', 'worker', 'Has interest', 'q8@test.dev', '+923001110017', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000c8', 'worker', 'Withdrew interest', 'q9@test.dev', '+923001110018', 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000c9', 'worker', 'Has a quote', 'q0@test.dev', '+923001110019', 'approved', 'active');
insert into public.worker_details (profile_id) select id from public.profiles where role = 'worker' and email like 'q%@test.dev';
insert into public.worker_categories (worker_id, category_id) values
  ('00000000-0000-0000-0000-0000000000c1', 1), ('00000000-0000-0000-0000-0000000000c2', 1), ('00000000-0000-0000-0000-0000000000c3', 1),
  ('00000000-0000-0000-0000-0000000000c4', 1), ('00000000-0000-0000-0000-0000000000c5', 2),
  ('00000000-0000-0000-0000-0000000000c6', 1), ('00000000-0000-0000-0000-0000000000c6', 2),
  ('00000000-0000-0000-0000-0000000000c7', 1), ('00000000-0000-0000-0000-0000000000c8', 1), ('00000000-0000-0000-0000-0000000000c9', 1);
insert into public.worker_areas (worker_id, phase) values
  ('00000000-0000-0000-0000-0000000000c1', 6), ('00000000-0000-0000-0000-0000000000c2', 6), ('00000000-0000-0000-0000-0000000000c3', 6),
  ('00000000-0000-0000-0000-0000000000c5', 6), ('00000000-0000-0000-0000-0000000000c6', 6), ('00000000-0000-0000-0000-0000000000c6', 7),
  ('00000000-0000-0000-0000-0000000000c7', 6), ('00000000-0000-0000-0000-0000000000c8', 6), ('00000000-0000-0000-0000-0000000000c9', 6);
insert into public.addresses (id, resident_id, label, phase, lane, plot_no, floor, is_default)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Home', 6, 'Lane 7', '118-C', 'Ground', true);

-- jobs: statuses, ages around the 24 hour edge, trades and phases
insert into public.jobs (id, resident_id, category_id, address_id, phase, lane, title, description, urgency, status, posted_at) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'EQ open',            'x', 'asap', 'open',       now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'EQ interested',     'x', 'asap', 'interested', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'EQ quoted',         'x', 'asap', 'quoted',     now() - interval '3 hours'),
  ('00000000-0000-0000-0000-00000000b004', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 7, 'Lane 7', 'EQ phase 7',        'x', 'asap', 'open',       now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000b005', '00000000-0000-0000-0000-0000000000a1', 2, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'EQ trade 2',        'x', 'asap', 'open',       now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000b006', '00000000-0000-0000-0000-0000000000a1', 2, '00000000-0000-0000-0000-0000000000d1', 7, 'Lane 7', 'EQ trade 2 phase 7', 'x', 'asap', 'open',       now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000b007', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'EQ 23h59m old',      'x', 'asap', 'open',       now() - interval '23 hours 59 minutes'),
  ('00000000-0000-0000-0000-00000000b008', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'EQ 24h01m old',      'x', 'asap', 'open',       now() - interval '24 hours 1 minute'),
  ('00000000-0000-0000-0000-00000000b009', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'EQ scheduled',       'x', 'asap', 'scheduled',  now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000b00a', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'EQ cancelled',       'x', 'asap', 'cancelled',  now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000b00b', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'EQ draft',           'x', 'asap', 'draft',      null),
  ('00000000-0000-0000-0000-00000000b00c', '00000000-0000-0000-0000-0000000000a1', 3, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'EQ trade 3',        'x', 'asap', 'open',       now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000b00d', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'EQ expired',         'x', 'asap', 'expired',    now() - interval '30 hours');
insert into public.job_private (job_id, plot_no, floor, resident_phone) select id, '118-C', 'Ground', '+923215550001' from public.jobs where title like 'EQ %';

-- stakes: c7 has an interest in job 1, c8 withdrew one from job 1, c9 has a quote on job 2
insert into public.job_interests (job_id, worker_id, withdrawn_at) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000c7', null),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000c8', now());
insert into public.quotes (job_id, worker_id, labour, materials, status) values
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-0000000000c9', 500, 0, 'sent');

create function pg_temp.same(p_worker uuid) returns boolean language plpgsql as $$
declare a uuid[]; b uuid[];
begin
  perform tests.act(p_worker);
  select coalesce(array_agg(id order by id), '{}') into a from public.worker_feed where title like 'EQ %';
  select coalesce(array_agg(id order by id), '{}') into b from public.worker_feed_v27 where title like 'EQ %';
  perform tests.back();
  return a = b;
end $$;
create function pg_temp.seen(p_worker uuid) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform tests.act(p_worker);
  select count(*) into n from public.worker_feed where title like 'EQ %';
  perform tests.back();
  return n;
end $$;

-- ---------------------------------------------------------------- same jobs as before, and the expected number of them
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000c1'), 'approved worker (trade 1, phase 6): same jobs as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000c1'), 3::bigint, '... open, interested and the 23h59m job: 3 (the quoted job is locked and gone, 0043)');
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000c2'), 'pending worker: same jobs as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000c2'), 0::bigint, '... none');
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000c3'), 'suspended worker: same jobs as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000c3'), 0::bigint, '... none');
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000c4'), 'worker with no areas: same jobs as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000c4'), 0::bigint, '... none');
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000c5'), 'trade 2 worker: same jobs as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000c5'), 1::bigint, '... only the trade 2 job in phase 6');
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000c6'), 'two trades and two phases: same jobs as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000c6'), 6::bigint, '... 6 jobs across both trades and phases');
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000c7'), 'worker with an interest: same jobs as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000c7'), 2::bigint, '... the job they are interested in is gone');
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000c8'), 'worker who withdrew an interest: same jobs as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000c8'), 2::bigint, '... a withdrawn interest still hides the job');
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000c9'), 'worker with a quote: same jobs as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000c9'), 2::bigint, '... the quoted job is gone');
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000a1'), 'a resident (not a worker): same as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a1'), 0::bigint, '... sees no worker feed');

-- ---------------------------------------------------------------- the expiry setting is still honoured
update public.app_settings set value = '48'::jsonb where key = 'job_expiry_hours';
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000c1'), 'expiry set to 48 hours: same jobs as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000c1'), 4::bigint, '... the 24h01m job is visible now');
update public.app_settings set value = '12'::jsonb where key = 'job_expiry_hours';
select ok(pg_temp.same('00000000-0000-0000-0000-0000000000c1'), 'expiry set to 12 hours: same jobs as before');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000c1'), 2::bigint, '... the 23h59m job is gone, the 1 to 3 hour jobs stay');

-- ---------------------------------------------------------------- shape and privacy unchanged
select is((select attname::text from pg_attribute where attrelid = 'public.worker_feed'::regclass and attnum > 0 and not attisdropped order by attnum desc limit 1),
  'thumb_paths', 'thumb_paths is still the last column');
select is((select count(*) from pg_attribute where attrelid = 'public.worker_feed'::regclass and attnum > 0 and not attisdropped),
  (select count(*) from pg_attribute where attrelid = 'public.worker_feed_v27'::regclass and attnum > 0 and not attisdropped), 'same number of columns as before');
select ok(has_table_privilege('authenticated', 'public.worker_feed', 'SELECT'), 'authenticated can still read the feed');
select ok(not has_table_privilege('anon', 'public.worker_feed', 'SELECT'), 'anon still cannot');

select * from finish();
rollback;
