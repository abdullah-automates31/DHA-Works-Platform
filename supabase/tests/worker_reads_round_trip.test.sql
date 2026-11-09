-- 0027: worker_feed.thumb_paths, worker_jobs.cash_recorded, the index-friendly worker_jobs filter, the unread index.
-- Fixture jobs start with 'W27 ' so other jobs in the database are ignored.
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

insert into auth.users (id, aud, role, email)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'r' || n || '@test.dev'
from unnest(array['a1', 'b1', 'b2', 'b3']) n;
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Hira Farooq', 'r1@test.dev', '+923215550148', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Winner Worker', 'r2@test.dev', '+923001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Other Worker', 'r3@test.dev', '+923001110002', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'worker', 'Unrelated Worker', 'r4@test.dev', '+923001110003', 'approved');
insert into public.worker_details (profile_id) select id from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.worker_categories (worker_id, category_id) select id, 1 from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.worker_areas (worker_id, phase) select id, 6 from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.addresses (id, resident_id, label, phase, lane, plot_no, floor, is_default)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Home', 6, 'Lane 7', '118-C', 'Ground', true);
insert into public.jobs (id, resident_id, category_id, address_id, phase, lane, title, description, urgency, status, posted_at) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'W27 three photos', 'x', 'asap', 'open', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'W27 no photos',    'x', 'asap', 'open', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'W27 cash flow',    'x', 'asap', 'open', now() - interval '1 hour');
insert into public.job_private (job_id, plot_no, floor, resident_phone) select id, '118-C', 'Ground', '+923215550148' from public.jobs where title like 'W27 %';
-- inserted out of order on purpose: the feed must return them by sort, and only the first two
insert into public.job_photos (job_id, storage_path, sort) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1/w27-2.jpg', 2),
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1/w27-0.jpg', 0),
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1/w27-1.jpg', 1);

-- ---------------------------------------------------------------- worker_feed.thumb_paths
select tests.act('00000000-0000-0000-0000-0000000000b3');
select is((select thumb_paths from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'),
  array['00000000-0000-0000-0000-0000000000a1/w27-0.jpg', '00000000-0000-0000-0000-0000000000a1/w27-1.jpg'],
  'thumb_paths is the first two photos, in sort order');
select is((select cardinality(thumb_paths) from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 2, 'never more than two');
select is((select photo_count from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 3::bigint, 'photo_count still counts every photo');
select is((select thumb_path from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), '00000000-0000-0000-0000-0000000000a1/w27-0.jpg', 'and thumb_path is unchanged');
select is((select thumb_paths from public.worker_feed where id = '00000000-0000-0000-0000-00000000e002'), null, 'a job without photos has null thumb_paths');

-- ---------------------------------------------------------------- worker_jobs: who sees what (the three ways in)
select is((select count(*) from public.worker_jobs where title like 'W27 %'), 0::bigint, 'a worker who engaged with nothing sees none of the jobs');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e002')$$, 'w1 shows interest in the no-photo job');
select is((select count(*) from public.worker_jobs where title like 'W27 %'), 1::bigint, 'interest alone brings a job into the list');
select lives_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e003')$$, 'w1 shows interest in the cash job');
select lives_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000e003', 900, now() + interval '2 hours', now() + interval '4 hours')$$, 'and quotes Rs 900 (labour only)');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e003')$$, 'w2 shows interest in the cash job');
select lives_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000e003', 800, now() + interval '2 hours', now() + interval '4 hours')$$, 'and quotes Rs 800');
select is((select count(*) from public.worker_jobs where title like 'W27 %'), 1::bigint, 'w2 sees only the job they engaged with');
select tests.act('00000000-0000-0000-0000-0000000000b3');
select is((select count(*) from public.worker_jobs where title like 'W27 %'), 0::bigint, 'the unrelated worker still sees none');

-- the resident accepts w1, who then starts and completes the job
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.accept_quote((select id from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1' and job_id = '00000000-0000-0000-0000-00000000e003'))$$, 'the resident accepts w1''s quote');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.worker_jobs where title like 'W27 %'), 2::bigint, 'w1 now lists the accepted job and the interest-only job');
select lives_ok($$select public.start_job('00000000-0000-0000-0000-00000000e003')$$, 'w1 starts it');
select lives_ok($$select public.complete_job('00000000-0000-0000-0000-00000000e003')$$, 'and completes it');

-- ---------------------------------------------------------------- worker_jobs.cash_recorded
select is((select cash_recorded from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e003'), false, 'before the worker enters cash: not recorded');
select lives_ok($$select public.record_cash_worker('00000000-0000-0000-0000-00000000e003', 900)$$, 'w1 records the cash');
select is((select cash_recorded from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e003'), true, 'now the winner''s list says it is recorded');
select is((select cash_recorded from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e002'), false, 'a job without a cash record is false, not null');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select cash_recorded from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e003'), false, 'the worker who lost never learns that cash was recorded');
select tests.back();
select is((select count(*) from pg_attribute where attrelid = 'public.worker_jobs'::regclass and attnum > 0 and not attisdropped
             and attname ~ '(amount|cash)' and attname <> 'cash_recorded'),
  0::bigint, 'worker_jobs exposes only the yes/no flag, never a cash amount');
select is((select attname::text from pg_attribute where attrelid = 'public.worker_jobs'::regclass and attnum > 0 and not attisdropped
           order by attnum desc limit 1 offset 1), 'cash_recorded', 'cash_recorded is added at the end (0044 appends my_quote_revision after it); existing columns keep their order');
select is((select attname::text from pg_attribute where attrelid = 'public.worker_jobs'::regclass and attnum = 5), 'description', 'worker_jobs column 5 is unchanged');

-- ---------------------------------------------------------------- grants and index
select ok(has_table_privilege('authenticated', 'public.worker_jobs', 'SELECT'), 'authenticated can still read worker_jobs');
select ok(not has_table_privilege('anon', 'public.worker_jobs', 'SELECT'), 'anon still cannot read worker_jobs');
select ok(not has_table_privilege('authenticated', 'public.worker_jobs', 'INSERT, UPDATE, DELETE'), 'worker_jobs is read only');
select ok(has_table_privilege('authenticated', 'public.worker_feed', 'SELECT'), 'authenticated can still read worker_feed');
select ok(not has_table_privilege('anon', 'public.worker_feed', 'SELECT'), 'anon still cannot read worker_feed');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'notifications_unread_idx'
                  and indexdef like '%(user_id)%' and indexdef like '%WHERE (read_at IS NULL)%'),
  'the unread-notifications partial index exists');

select * from finish();
rollback;
