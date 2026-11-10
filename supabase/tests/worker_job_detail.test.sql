-- W08 Job detail: what a worker may read about a job, record_job_view, and "I will quote this job" (express_interest).
-- Fixture jobs start with 'W08 ' so the test ignores any other jobs in the database (for example the local seed).
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

-- People: a resident; w1, w2, w3 approved plumbers in phase 6; w4 an approved electrician; w5 still pending.
insert into auth.users (id, aud, role, email)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'd' || n || '@test.dev'
from unnest(array['a1', 'b1', 'b2', 'b3', 'b4', 'b5']) n;
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Detail Resident', 'd1@test.dev', '+923000000020', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Detail Worker One', 'd2@test.dev', '+923000000021', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Detail Worker Two', 'd3@test.dev', '+923000000022', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'worker', 'Detail Worker Three', 'd4@test.dev', '+923000000023', 'approved'),
  ('00000000-0000-0000-0000-0000000000b4', 'worker', 'Detail Worker Four', 'd5@test.dev', '+923000000024', 'approved'),
  ('00000000-0000-0000-0000-0000000000b5', 'worker', 'Detail Worker Five', 'd6@test.dev', '+923000000025', 'pending');
insert into public.worker_details (profile_id) select id from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.worker_categories (worker_id, category_id) values
  ('00000000-0000-0000-0000-0000000000b1', 1), ('00000000-0000-0000-0000-0000000000b2', 1), ('00000000-0000-0000-0000-0000000000b3', 1),
  ('00000000-0000-0000-0000-0000000000b4', 2), ('00000000-0000-0000-0000-0000000000b5', 1);
insert into public.worker_areas (worker_id, phase) select id, 6 from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.addresses (id, resident_id, label, phase, lane, plot_no, floor, is_default)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Home', 6, 'Lane 7', '118-C', 'Ground', true);

insert into public.jobs (id, resident_id, category_id, address_id, phase, lane, title, description, urgency, voice_note_path, status, posted_at) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'W08 main', 'Water drips from the trap pipe.', 'asap',
   '00000000-0000-0000-0000-0000000000a1/w08-voice.mp3', 'open', now() - interval '12 minutes'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'W08 other', 'x', 'asap', null, 'open', now() - interval '1 hour');
insert into public.job_private (job_id, plot_no, floor, resident_phone)
select id, '118-C', 'Ground', '+923000000020' from public.jobs where title like 'W08 %';
insert into public.job_photos (job_id, storage_path, sort) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1/w08-0.jpg', 0),
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1/w08-1.jpg', 1),
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1/w08-2.jpg', 2),
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1/w08-3.jpg', 3);

-- ---------------------------------------------------------------- reading a job from the feed (not engaged yet)
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 1::bigint, 'a matching worker finds the job by id');
select ok((select code ~ '^DW-[0-9]+$' from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 'the job code (DW-####) is available for the header');
select is((select description from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 'Water drips from the trap pipe.', 'and the description');
select ok((select voice_note_path is not null from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 'and whether there is a voice note');
select is((select interest_count from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'nobody else is interested yet');
select is((select count(*) from public.job_photos where job_id = '00000000-0000-0000-0000-00000000e001'), 4::bigint, 'the worker reads all four photo rows (the screen scrolls past three)');
select is((select array_agg(sort order by sort) from public.job_photos where job_id = '00000000-0000-0000-0000-00000000e001'), array[0, 1, 2, 3]::smallint[], 'in the order the resident added them');

-- other workers cannot reach it
select tests.act('00000000-0000-0000-0000-0000000000b4');
select is((select count(*) from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'a worker of another trade does not find the job');
select is((select count(*) from public.job_photos where job_id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'and cannot read its photos');
select tests.act('00000000-0000-0000-0000-0000000000b5');
select is((select count(*) from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'a worker still under review does not find it');

-- ---------------------------------------------------------------- record_job_view
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.record_job_view('00000000-0000-0000-0000-00000000e001')$$, 'opening the job records a view');
select lives_ok($$select public.record_job_view('00000000-0000-0000-0000-00000000e001')$$, 'opening it again is harmless');
select is((select count(*) from public.job_views where job_id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'the worker cannot read the views table (only the resident sees the count)');
select tests.back();
select is((select count(*) from public.job_views where job_id = '00000000-0000-0000-0000-00000000e001' and worker_id = '00000000-0000-0000-0000-0000000000b1'), 1::bigint, 'only one view is counted per worker');
select tests.act('00000000-0000-0000-0000-0000000000b4');
select throws_ok($$select public.record_job_view('00000000-0000-0000-0000-00000000e001')$$, null, 'job not found', 'a worker who cannot see the job cannot record a view');
select tests.act('00000000-0000-0000-0000-0000000000b5');
select throws_ok($$select public.record_job_view('00000000-0000-0000-0000-00000000e001')$$, null, 'your account is not approved yet', 'a pending worker cannot either');

-- ---------------------------------------------------------------- "I will quote this job" = express_interest
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e001')$$, 'w1 shows interest');
select lives_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e001')$$, 'a double tap or retry is safe');
select is((select count(*) from public.job_interests where job_id = '00000000-0000-0000-0000-00000000e001' and withdrawn_at is null), 1::bigint, 'one live interest, not two');
select is((select status::text from public.jobs where id = '00000000-0000-0000-0000-00000000e001'), 'interested', 'the job moves to interested');
select is((select count(*) from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'it leaves w1''s feed...');
select is((select status::text from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e001'), 'interested', '...and appears in w1''s own jobs, so the detail screen still opens');
select is((select my_quote_status::text from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e001'), null, 'with no quote yet (the button becomes "Create your quote")');
select is((select resident_name from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e001'), null, 'and still no resident name before acceptance');
select is((select count(*) from public.job_photos where job_id = '00000000-0000-0000-0000-00000000e001'), 4::bigint, 'photos stay readable for a worker who engaged');

-- others now see "1 other worker is interested"
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select interest_count from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 1::bigint, 'w2 sees exactly 1 other worker interested');
select is((select quote_count from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'and no quotes yet');

-- refusals
select throws_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e0ff')$$, null, 'this job is not available', 'an unknown job is refused');
select tests.act('00000000-0000-0000-0000-0000000000b4');
select throws_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e001')$$, null, 'this job is not available', 'a worker of another trade is refused');
select tests.act('00000000-0000-0000-0000-0000000000b5');
select throws_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e001')$$, null, 'your account is not approved yet', 'a pending worker is refused');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e001')$$, null, 'this action is not available for your account type', 'a resident cannot use the worker action');

-- withdrawing and coming back
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.withdraw_interest('00000000-0000-0000-0000-00000000e001')$$, 'w1 withdraws');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select interest_count from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'the count drops');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e001')$$, 'w1 can come back');
select is((select count(*) from public.job_interests where job_id = '00000000-0000-0000-0000-00000000e001' and worker_id = '00000000-0000-0000-0000-0000000000b1'), 1::bigint, 'still one interest row for w1');

-- ---------------------------------------------------------------- after quotes: the standing of each worker
select lives_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000e001', 3000, now() + interval '1 day', now() + interval '1 day 2 hours', 0, null, 0, null, null)$$, 'w1 sends a quote');
select is((select my_quote_status::text from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e001'), 'sent', 'w1 now has a sent quote (the button reads "Quote sent")');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e001')$$, 'w2 shows interest');
select lives_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000e001', 2800, now() + interval '1 day', now() + interval '1 day 2 hours', 0, null, 0, null, null)$$, 'w2 sends a quote');
select tests.act('00000000-0000-0000-0000-0000000000b3');
select is((select count(*) from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'a quoted job is locked to one worker and no longer in w3''s feed (0043)');
select is((select count(*) from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'and stays out of the feed');

-- the resident accepts w2: w1 is closed out, and only w2 learns the resident name
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.accept_quote((select id from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b2' and job_id = '00000000-0000-0000-0000-00000000e001'))$$, 'the resident accepts w2''s quote');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select status::text from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e001'), 'open', 'w1 gets a neutral status for a job that went to someone else (no status updates)');
select ok((select description is null and lane is null and scheduled_start is null from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e001'), 'and no job details');
select is((select my_quote_status::text from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e001'), 'not_selected', 'and that their quote was not selected (the screen shows "closed")');
select is((select resident_name from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e001'), null, 'w1 still does not see the resident name');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select resident_name from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e001'), 'Detail Resident', 'only the accepted worker sees the resident name');
select tests.act('00000000-0000-0000-0000-0000000000b3');
select is((select count(*) from public.worker_feed where id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'the job is gone from w3''s feed (unavailable)');
select is((select count(*) from public.worker_jobs where id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'and w3 has no access at all: the screen shows "no longer available"');
select throws_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e001')$$, null, 'this job is not available', 'and interest in a taken job is refused');

-- ---------------------------------------------------------------- a rejected worker cannot come back
select tests.back();
insert into public.job_interests (job_id, worker_id) values ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000b1');
insert into public.quotes (id, job_id, worker_id, labour, materials, other_amount, visit_start, visit_end, status)
values ('00000000-0000-0000-0000-00000000f0f1', '00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000b1', 1000, 0, 0,
  now() + interval '1 day', now() + interval '1 day 2 hours', 'rejected');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.express_interest('00000000-0000-0000-0000-00000000e002')$$, null,
  'the resident did not accept your quote on this job', 'a worker whose quote was rejected cannot quote the job again');

select tests.back();
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'worker_feed'
           and (column_name ~ '(resident|phone|plot|floor|address|cnic|email)' or column_name = 'full_name')), 0::bigint,
  'worker_feed (the detail screen''s source) exposes no resident, phone, plot or address');

select * from finish();
rollback;
