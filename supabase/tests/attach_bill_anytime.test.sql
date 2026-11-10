-- Migration 0045: attach_material_bill (the worker attaches the bill any time until the job is completed) and
-- complete_job accepting a bill attached earlier.
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
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'res1@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'res2@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida One', 'res1@test.dev', '03001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000a2', 'resident', 'Rida Two', 'res2@test.dev', '03001110002', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman One', 'w1@test.dev', '03003334444', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Bilal Two', 'w2@test.dev', '03005556666', 'approved');
insert into public.worker_details (profile_id) values ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');
insert into public.worker_categories (worker_id, category_id) values
  ('00000000-0000-0000-0000-0000000000b1', 1), ('00000000-0000-0000-0000-0000000000b2', 1);
insert into public.worker_areas (worker_id, phase) values
  ('00000000-0000-0000-0000-0000000000b1', 6), ('00000000-0000-0000-0000-0000000000b2', 6);

create function tests.make_job(p_title text, p_n text) returns uuid
language plpgsql as $$
declare
  v_job uuid;
  v_addr uuid;
begin
  perform tests.act('00000000-0000-0000-0000-0000000000a1');
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing today', 'asap', null, null, null, null,
                                 array['00000000-0000-0000-0000-0000000000a1/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;

-- A: materials, claimed by w1.  B: no materials, claimed by w1.
create temp table t as select tests.make_job('Job A', '1') as a, tests.make_job('Job B', '2') as b, tests.make_job('Job C', '3') as c;
grant select on t to authenticated;

select tests.act('00000000-0000-0000-0000-0000000000b1');
select public.accept_job((select a from t), 3000, 500, 'pipes');
select public.accept_job((select b from t), 2000, 0);
select public.accept_job((select c from t), 1000, 300, 'tiles');
select tests.back();
-- The customer accepts A and B (0043: a claim only quotes the job); C stays quoted, its quote only sent.
select tests.act('00000000-0000-0000-0000-0000000000a1');
select public.accept_quote((select id from public.resident_quotes where job_id = (select a from t)));
select public.accept_quote((select id from public.resident_quotes where job_id = (select b from t)));
select tests.back();

insert into storage.objects (bucket_id, name, owner) values
  ('job-media', '00000000-0000-0000-0000-0000000000b1/bill-1.jpg', '00000000-0000-0000-0000-0000000000b1'),
  ('job-media', '00000000-0000-0000-0000-0000000000b1/bill-2.jpg', '00000000-0000-0000-0000-0000000000b1'),
  ('job-media', '00000000-0000-0000-0000-0000000000b2/other.jpg', '00000000-0000-0000-0000-0000000000b2');

-- ------------------------------------------------------------------ who may attach
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.attach_material_bill((select a from t), null)$$, null, null, 'a bill path is required');
select throws_ok($$select public.attach_material_bill((select a from t), '00000000-0000-0000-0000-0000000000b2/other.jpg')$$, null, null, 'the bill must sit in the worker''s own folder');
select throws_ok($$select public.attach_material_bill((select a from t), '00000000-0000-0000-0000-0000000000b1/missing.jpg')$$, null, null, 'the file must exist in storage');
select throws_ok($$select public.attach_material_bill((select b from t), '00000000-0000-0000-0000-0000000000b1/bill-1.jpg')$$, null, null, 'a quote without materials takes no bill');
select tests.back();

select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select public.attach_material_bill((select a from t), '00000000-0000-0000-0000-0000000000b2/other.jpg')$$, null, null, 'another worker cannot attach a bill to this job');
select tests.back();

select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.attach_material_bill((select a from t), '00000000-0000-0000-0000-0000000000a1/x.jpg')$$, null, null, 'a resident cannot attach a bill');
select tests.back();

-- ------------------------------------------------------------------ attach, replace, customer sees it
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.attach_material_bill((select a from t), '00000000-0000-0000-0000-0000000000b1/bill-1.jpg')$$, null, null, 'before the job is started no bill can be attached');
select lives_ok($$select public.start_job((select a from t))$$, 'the worker starts job A');
select lives_ok($$select public.attach_material_bill((select a from t), '00000000-0000-0000-0000-0000000000b1/bill-1.jpg')$$, 'the worker attaches the bill while the job is in progress');
select tests.back();
select is((select material_bill_path from public.quotes where job_id = (select a from t) and status = 'accepted'),
          '00000000-0000-0000-0000-0000000000b1/bill-1.jpg', 'the bill is filed on the quote');
select is((select count(*)::int from public.job_events where job_id = (select a from t) and event_type = 'bill_attached'), 1, 'the attach is recorded');

select tests.act('00000000-0000-0000-0000-0000000000a1');
select is((select material_bill_path from public.resident_quotes where job_id = (select a from t)),
          '00000000-0000-0000-0000-0000000000b1/bill-1.jpg', 'the customer sees the bill in view quote');
select is((select count(*)::int from storage.objects where bucket_id = 'job-media' and name = '00000000-0000-0000-0000-0000000000b1/bill-1.jpg'), 1, 'and may read the file');
select tests.back();

select tests.act('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from storage.objects where bucket_id = 'job-media' and name = '00000000-0000-0000-0000-0000000000b1/bill-1.jpg'), 0, 'another resident cannot read it');
select tests.back();

select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.attach_material_bill((select a from t), '00000000-0000-0000-0000-0000000000b1/bill-2.jpg')$$, 'the worker can replace the bill before the job is completed');
select tests.back();
select is((select material_bill_path from public.quotes where job_id = (select a from t) and status = 'accepted'),
          '00000000-0000-0000-0000-0000000000b1/bill-2.jpg', 'the quote points at the new bill');

-- ------------------------------------------------------------------ complete with the attached bill
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.complete_job((select a from t))$$, 'completing without a new photo works when a bill was attached');
select tests.back();
select is((select material_bill_path from public.jobs where id = (select a from t)),
          '00000000-0000-0000-0000-0000000000b1/bill-2.jpg', 'the job carries the attached bill');

select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.attach_material_bill((select a from t), '00000000-0000-0000-0000-0000000000b1/bill-1.jpg')$$, null, null, 'no bill can be attached after the job is completed');
select tests.back();

-- ------------------------------------------------------------------ the bill rule at completion still holds
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.start_job((select b from t))$$, 'start the job without materials');
select lives_ok($$select public.complete_job((select b from t))$$, 'a job without materials completes without a bill');
select tests.back();

-- ------------------------------------------------------------------ not while the customer has not decided yet
select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.attach_material_bill((select c from t), '00000000-0000-0000-0000-0000000000b1/bill-1.jpg')$$, null, null, 'a quoted job (customer undecided) takes no bill');
select tests.back();

select * from finish();
rollback;
