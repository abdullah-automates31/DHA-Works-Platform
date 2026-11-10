-- W10 Create quote: submit_quote rules, the server-computed total, refusals, and what each side can read.
-- Fixture jobs start with 'W10 ' so the test ignores other jobs in the database (for example the local seed).
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
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'q' || n || '@test.dev'
from unnest(array['a1', 'b1', 'b2', 'b3', 'b4']) n;
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Quote Resident', 'q1@test.dev', '+923000000030', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Quote Worker One', 'q2@test.dev', '+923000000031', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Quote Worker Two', 'q3@test.dev', '+923000000032', 'approved'),
  ('00000000-0000-0000-0000-0000000000b3', 'worker', 'Quote Worker Three', 'q4@test.dev', '+923000000033', 'approved'),
  ('00000000-0000-0000-0000-0000000000b4', 'worker', 'Quote Worker Four', 'q5@test.dev', '+923000000034', 'approved');
insert into public.worker_details (profile_id) select id from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.worker_categories (worker_id, category_id) select id, 1 from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%' and id <> '00000000-0000-0000-0000-0000000000b4';
insert into public.worker_categories (worker_id, category_id) values ('00000000-0000-0000-0000-0000000000b4', 2);
insert into public.worker_areas (worker_id, phase) select id, 6 from public.profiles where id::text like '00000000-0000-0000-0000-0000000000b%';
insert into public.addresses (id, resident_id, label, phase, lane, plot_no, floor, is_default)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Home', 6, 'Lane 7', '118-C', 'Ground', true);

insert into public.jobs (id, resident_id, category_id, address_id, phase, lane, title, description, urgency, status, posted_at) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'W10 main',    'x', 'asap', 'open', now() - interval '10 minutes'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000a1', 1, '00000000-0000-0000-0000-0000000000d1', 6, 'Lane 7', 'W10 expired', 'x', 'asap', 'open', now() - interval '30 hours');
insert into public.job_private (job_id, plot_no, floor, resident_phone) select id, '118-C', 'Ground', '+923000000030' from public.jobs where title like 'W10 %';

-- ---------------------------------------------------------------- refusals before interest
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 1000, now() + interval '1 day', now() + interval '1 day 2 hours')$$, null,
  'this job is not available for quotes', 'a job nobody showed interest in yet does not take quotes');
select lives_ok($$select public.express_interest('00000000-0000-0000-0000-00000000c001')$$, 'w1 shows interest');
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select public.express_interest('00000000-0000-0000-0000-00000000c001')$$, 'w2 shows interest');
select tests.act('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 1000, now() + interval '1 day', now() + interval '1 day 2 hours')$$, null,
  'show interest in the job before sending a quote', 'a worker must show interest before quoting');
select tests.act('00000000-0000-0000-0000-0000000000b4');
select throws_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 1000, now() + interval '1 day', now() + interval '1 day 2 hours')$$, null,
  'this job is not available for quotes', 'a worker of another trade cannot quote');

-- ---------------------------------------------------------------- the quote itself
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 0, now() + interval '1 day', now() + interval '1 day 2 hours')$$, '23514', null,
  'a total of zero is refused');
select throws_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 1000, now() + interval '1 day', now() + interval '1 day 2 hours', 0, null, 250, null)$$, '23514', null,
  'an extra cost without a note is refused');
-- Known gap (docs/OPEN-QUESTIONS.md): the table only checks that the note is not empty, so a note of spaces passes at the
-- database. The app trims the text and requires real characters, so it never sends one.
select throws_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', -5, now() + interval '1 day', now() + interval '1 day 2 hours')$$, '23514', null,
  'a negative amount is refused');
select is((select count(*) from public.quotes where job_id = '00000000-0000-0000-0000-00000000c001'), 0::bigint, 'none of the refused attempts left a quote behind');

select throws_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 1500, now() + interval '1 day', now() + interval '1 day 2 hours', 500, 'pipe', 0, null, null, '00000000-0000-0000-0000-0000000000b2/bill.jpg')$$, null, 'invalid bill path', 'a bill in someone else folder is refused');
select lives_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 1500, now() + interval '1 day', now() + interval '1 day 2 hours',
  1450, 'Trap pipe, flexible hose, washers', 250, 'Fittings and washers')$$, 'a full quote is sent (labour, materials with a list, other with a reason)');
select is((select total from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1' and job_id = '00000000-0000-0000-0000-00000000c001'), 3200,
  'the database computes the total: 1500 + 1450 + 250 = 3200');
select ok((select material_bill_path is null from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1' and job_id = '00000000-0000-0000-0000-00000000c001'), 'the quote carries the materials list and cost but no bill: the bill is uploaded when the job is completed');
select is((select materials_note from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1'), 'Trap pipe, flexible hose, washers', 'the materials list is stored');
select is((select other_note from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1'), 'Fittings and washers', 'and the reason for the extra cost');
select is((select status::text from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1'), 'sent', 'the quote is sent');
select ok((select visit_start is null and visit_end is null from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1'), 'the visit times a worker passes are ignored: the customer chooses the schedule');
select throws_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 900, now() + interval '2 days', now() + interval '2 days 2 hours')$$, null,
  'you already sent a quote; withdraw it first', 'a second quote on the same job is refused (a sent quote is final)');
select throws_ok($$update public.quotes set labour = 1 where worker_id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 'a sent quote cannot be edited directly');
select throws_ok($$insert into public.quotes (job_id, worker_id, labour, visit_start, visit_end) values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000b1', 5, now() + interval '1 day', now() + interval '2 days')$$, '42501', null,
  'and a worker cannot write quotes around the function');

-- the job and the people around it
select tests.back();
select is((select status::text from public.jobs where id = '00000000-0000-0000-0000-00000000c001'), 'quoted', 'the job is now quoted');
select is((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and type = 'quote_received'), 1::bigint, 'the resident gets one "quote received" notification');
select is((select (payload ->> 'title') from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1' and type = 'quote_received'), 'W10 main', 'which carries only the job title');

select tests.act('00000000-0000-0000-0000-0000000000b3');
select is((select count(*) from public.worker_feed where id = '00000000-0000-0000-0000-00000000c001'), 0::bigint, 'a quoted job leaves another worker''s feed (0043)');
select is((select count(*) from public.quotes where job_id = '00000000-0000-0000-0000-00000000c001'), 0::bigint, 'but cannot read anyone else''s quote');
select is((select count(*) from information_schema.columns where table_name = 'worker_feed' and column_name ~ '(total|labour|amount|price)'), 0::bigint, 'and the feed exposes no amounts');

-- a worker reads their own quote through worker_jobs (no resident name before acceptance)
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((select my_quote_total from public.worker_jobs where id = '00000000-0000-0000-0000-00000000c001'), 3200, 'worker_jobs shows the worker''s own total');
select is((select my_quote_status::text from public.worker_jobs where id = '00000000-0000-0000-0000-00000000c001'), 'sent', 'and its status');
select is((select resident_name from public.worker_jobs where id = '00000000-0000-0000-0000-00000000c001'), null, 'with no resident name');

-- ---------------------------------------------------------------- withdraw and send a new one
select lives_ok($$select public.withdraw_quote((select id from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1' and status = 'sent'))$$, 'the worker withdraws the quote');
select lives_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 1200, now() + interval '1 day', now() + interval '1 day 2 hours')$$, 'and may send a fresh one');
select tests.back();
select is((select count(*) from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1' and status = 'sent'), 1::bigint, 'still only one live quote per worker');
select is((select total from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b1' and status = 'sent'), 1200, 'the new total is its own (labour only, no materials or other)');

-- ---------------------------------------------------------------- expiry and rejection
insert into public.job_interests (job_id, worker_id) values ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000b1');
update public.jobs set status = 'interested' where id = '00000000-0000-0000-0000-00000000c002';
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c002', 1000, now() + interval '1 day', now() + interval '1 day 2 hours')$$, null,
  'this job has expired', 'a job past 24 hours takes no quote, even before the hourly sweep marks it expired');

select tests.back();
update public.quotes set status = 'rejected', decided_at = now() where worker_id = '00000000-0000-0000-0000-0000000000b1' and status = 'sent';
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 1000, now() + interval '1 day', now() + interval '1 day 2 hours')$$, null,
  'the resident did not accept your quote on this job', 'a worker whose quote was rejected cannot quote again');

-- ---------------------------------------------------------------- big amounts and a resident
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 9999999, now() + interval '1 day', now() + interval '1 day 2 hours', 9999999, null, 0, null)$$, 'a very large amount is accepted (the app limits input to seven digits)');
select is((select total from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b2'), 19999998, 'and the total adds up');
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.submit_quote('00000000-0000-0000-0000-00000000c001', 1000, now() + interval '1 day', now() + interval '1 day 2 hours')$$, null,
  'this action is not available for your account type', 'a resident cannot send a quote');
select tests.back();

select * from finish();
rollback;
