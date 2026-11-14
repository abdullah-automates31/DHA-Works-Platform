-- W14 Report a problem: what a worker can file and read. Fixture jobs start with 'W14 '.
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
-- reads as the database owner: app users cannot read the staff-only report columns (0053)
create function tests.scalar(p_sql text) returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin execute p_sql into v; return v; end $$;
grant execute on function tests.act(uuid), tests.back(), tests.scalar(text) to authenticated;

insert into auth.users (id, aud, role, email)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'r' || n || '@test.dev'
from unnest(array['a1', 'b1', 'b2']) n;
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Hira Farooq', 'r1@test.dev', '+923215550148', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Winner Worker', 'r2@test.dev', '+923001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Other Worker', 'r3@test.dev', '+923001110002', 'approved');
insert into public.worker_details (profile_id) select id from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.worker_categories (worker_id, category_id) select id, 1 from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.worker_areas (worker_id, phase) select id, 6 from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.addresses (id, resident_id, label, phase, lane, plot_no, floor, is_default)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Home', 6, 'Lane 7', '118-C', 'Ground', true);
insert into public.jobs (id, resident_id, category_id, address_id, phase, lane, title, description, urgency, status, posted_at) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'W14 report', 'x', 'asap', 'open', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'W14 open', 'x', 'asap', 'open', now() - interval '1 hour');
insert into public.job_private (job_id, plot_no, floor, resident_phone) select id, '118-C', 'Ground', '+923215550148' from public.jobs where title like 'W14 %';

select tests.act('00000000-0000-0000-0000-0000000000b1');
select public.express_interest('00000000-0000-0000-0000-00000000e001');
select public.submit_quote('00000000-0000-0000-0000-00000000e001', 1500, now() + interval '2 hours', now() + interval '4 hours');
select public.express_interest('00000000-0000-0000-0000-00000000e002');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select public.accept_quote((select id from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1' and job_id = '00000000-0000-0000-0000-00000000e001'));

-- ---------------------------------------------------------------- who can report
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select public.file_report('00000000-0000-0000-0000-00000000e001', 'other', 'x')$$, null, 'job not found', 'a worker who did not win the job cannot report on it');
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.file_report('00000000-0000-0000-0000-00000000e002', 'other', 'x')$$, null, 'job not found', 'and neither can a worker who only showed interest');

-- ---------------------------------------------------------------- filing
select lives_ok($$select public.start_job('00000000-0000-0000-0000-00000000e001')$$, 'w1 starts the job');
select lives_ok($$select public.file_report('00000000-0000-0000-0000-00000000e001', 'rude_damage', 'Customer rude: shouted at me')$$, 'w1 reports a rude customer');
select is((select kind::text from public.reports where job_id = '00000000-0000-0000-0000-00000000e001' and kind = 'rude_damage'), 'rude_damage', 'it is stored with its kind');
select is((select reason_text from public.reports where kind = 'rude_damage' and job_id = '00000000-0000-0000-0000-00000000e001'), 'Customer rude: shouted at me', 'and the text, which keeps the chosen reason');
select is((select reporter_role::text from public.reports where kind = 'rude_damage' and job_id = '00000000-0000-0000-0000-00000000e001'), 'worker', 'as a worker report');
select is(tests.scalar($$select against_id::text from public.reports where kind = 'rude_damage' and job_id = '00000000-0000-0000-0000-00000000e001'$$), '00000000-0000-0000-0000-0000000000a1', 'against the resident');
select is((select under_review_reason from public.jobs where id = '00000000-0000-0000-0000-00000000e001'), null, 'a rude-customer report does not flag the job');
select lives_ok($$select public.file_report('00000000-0000-0000-0000-00000000e001', 'unsafe', 'I felt unsafe', array['00000000-0000-0000-0000-0000000000b1/e001-1-a.jpg', '00000000-0000-0000-0000-0000000000b2/stolen.jpg'])$$, 'w1 reports feeling unsafe, with two photo paths');
select is((select under_review_reason from public.jobs where id = '00000000-0000-0000-0000-00000000e001'), 'report_unsafe', 'an unsafe report flags the job for staff');
select is((select count(*) from public.report_photos where report_id = (select id from public.reports where kind = 'unsafe' and job_id = '00000000-0000-0000-0000-00000000e001')), 1::bigint, 'only the photo under the worker''s own folder is kept');
select is((select status::text from public.jobs where id = '00000000-0000-0000-0000-00000000e001'), 'in_progress', 'the job status is unchanged');

-- ---------------------------------------------------------------- the report window
select tests.back();
update public.jobs set status = 'completed', completed_at = now() - interval '8 days' where id = '00000000-0000-0000-0000-00000000e001';
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.file_report('00000000-0000-0000-0000-00000000e001', 'other', 'late')$$, null, 'the reporting period for this job has ended', 'more than 7 days after completion nothing can be reported');
select tests.back();
update public.jobs set completed_at = now() - interval '6 days' where id = '00000000-0000-0000-0000-00000000e001';
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.file_report('00000000-0000-0000-0000-00000000e001', 'cash_price', 'Refused to pay')$$, '6 days after completion a report is still accepted');
select is((select count(*) from public.reports where job_id = '00000000-0000-0000-0000-00000000e001'), 3::bigint, 'w1 reads their three reports');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from public.reports where job_id = '00000000-0000-0000-0000-00000000e001'), 0::bigint, 'another worker reads none of them');

select * from finish();
rollback;
