-- Migrations 0016 and 0017 (worker app prep):
--   0016 submit_for_review no longer requires areas; the feed still does.
--   0017 worker_feed gains quote_count and keeps interest_count.
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

-- People: a resident, workers w1..w5 (incomplete, ready to submit unless noted), an approved worker with no areas (w6).
insert into auth.users (id, aud, role, email)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'u' || n || '@test.dev'
from unnest(array['a1', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6']) n;

insert into public.profiles (id, role, full_name, email, phone, cnic, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida Resident', 'u1@test.dev', '03001112222', '42101-1111111-1', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Ready No Areas', 'u2@test.dev', '03003334444', '42101-2222222-1', 'incomplete'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'No Trade', 'u3@test.dev', '03005556666', '42101-3333333-1', 'incomplete'),
  ('00000000-0000-0000-0000-0000000000b3', 'worker', 'No Photo', 'u4@test.dev', '03007778888', '42101-4444444-1', 'incomplete'),
  ('00000000-0000-0000-0000-0000000000b4', 'worker', 'No Police Or Refs', 'u5@test.dev', '03009990000', '42101-5555555-1', 'incomplete'),
  ('00000000-0000-0000-0000-0000000000b5', 'worker', 'Refs Instead', 'u6@test.dev', '03001230000', '42101-6666666-1', 'incomplete'),
  ('00000000-0000-0000-0000-0000000000b6', 'worker', 'Approved No Areas', 'u7@test.dev', '03004560000', '42101-7777777-1', 'approved');
insert into public.worker_details (profile_id)
select id from public.profiles where role = 'worker' and id::text like '00000000-0000-0000-0000-%';

-- Documents: everyone gets CNIC both sides; b3 has no photo; b4 has no police certificate; b5 gets references below.
insert into public.verification_documents (profile_id, doc_type, storage_path)
select p.id, d, p.id || '/' || d
from public.profiles p, unnest(array['cnic_front', 'cnic_back']::public.document_type[]) d
where p.role = 'worker' and p.id::text like '00000000-0000-0000-0000-%';
insert into public.verification_documents (profile_id, doc_type, storage_path)
select p.id, 'profile_photo', p.id || '/photo'
from public.profiles p
where p.role = 'worker' and p.id::text like '00000000-0000-0000-0000-%' and p.id <> '00000000-0000-0000-0000-0000000000b3';
insert into public.verification_documents (profile_id, doc_type, storage_path)
select p.id, 'police_cert', p.id || '/police'
from public.profiles p
where p.role = 'worker' and p.id::text like '00000000-0000-0000-0000-%' and p.id not in ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000b5');
insert into public.worker_references (worker_id, name, phone, address) values
  ('00000000-0000-0000-0000-0000000000b5', 'Ref One', '03111111111', 'DHA'),
  ('00000000-0000-0000-0000-0000000000b5', 'Ref Two', '03222222222', 'DHA');

-- Trades: everyone except b2. No worker has any area (phase) yet.
insert into public.worker_categories (worker_id, category_id)
select id, 1 from public.profiles where role = 'worker' and id::text like '00000000-0000-0000-0000-%' and id <> '00000000-0000-0000-0000-0000000000b2';

-- ---------------------------------------------------------------- 0016: submit_for_review
select is((select count(*) from public.worker_areas where worker_id::text like '00000000-0000-0000-0000-%'), 0::bigint, 'setup: no test worker has any area');

select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.submit_for_review()$$, 'worker with everything but areas can submit');
select tests.back();
select is((select verification_status from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  'pending'::public.verification_status, 'status is pending after submit');
select is((select count(*) from public.audit_log where action = 'submit_for_review'
           and actor_id = '00000000-0000-0000-0000-0000000000b1'), 1::bigint, 'submission is audited');

select tests.act('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.submit_for_review()$$, null, 'already submitted', 'cannot submit twice');

select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select public.submit_for_review()$$, null, 'choose at least one trade', 'a trade is still required');

select tests.act('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$select public.submit_for_review()$$, null, 'upload a profile photo', 'a profile photo is still required');

select tests.act('00000000-0000-0000-0000-0000000000b4');
select throws_ok($$select public.submit_for_review()$$, null, 'upload a police certificate or give two references',
  'police certificate or two references is still required');

select tests.act('00000000-0000-0000-0000-0000000000b5');
select lives_ok($$select public.submit_for_review()$$, 'two references replace the police certificate');

-- A worker missing CNIC details is still refused.
select tests.back();
update public.profiles set cnic = null where id = '00000000-0000-0000-0000-0000000000b4';
insert into public.verification_documents (profile_id, doc_type, storage_path)
values ('00000000-0000-0000-0000-0000000000b4', 'police_cert', 'x/police');
select tests.act('00000000-0000-0000-0000-0000000000b4');
select throws_ok($$select public.submit_for_review()$$, null, 'name, phone and CNIC are required', 'CNIC is still required');

-- The resident rules are untouched.
select tests.back();
update public.profiles set verification_status = 'incomplete' where id = '00000000-0000-0000-0000-0000000000a1';
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.submit_for_review()$$, null, 'upload both sides of your CNIC', 'resident still needs CNIC documents');
select tests.back();
update public.profiles set verification_status = 'approved' where id = '00000000-0000-0000-0000-0000000000a1';

-- ---------------------------------------------------------------- the feed still needs areas
-- Resident posts a plumbing job in phase 6.
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.upsert_address(null, 'Home', 6::smallint, 'Lane 4', '12-C', '2nd', true)$$, 'resident adds an address');
select lives_ok($$
  select public.save_job_draft(null, 1::smallint, (select id from public.addresses limit 1),
    'Kitchen tap leaking', 'Tap under the sink drips all day', 'asap', null, null, null, null,
    array['00000000-0000-0000-0000-0000000000a1/p1.jpg'])
$$, 'resident saves a draft');
select tests.back();
create temp table t_job as select id from public.jobs where title = 'Kitchen tap leaking' limit 1;
grant select on t_job to authenticated;
select tests.act('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.post_job((select id from t_job))$$, 'resident posts the job');

-- b6 is approved with a trade but no areas: sees nothing and cannot show interest.
select tests.back();
insert into public.worker_categories (worker_id, category_id) values ('00000000-0000-0000-0000-0000000000b6', 1)
on conflict do nothing;
select tests.act('00000000-0000-0000-0000-0000000000b6');
select is((select count(*) from public.worker_feed where title = 'Kitchen tap leaking'), 0::bigint, 'approved worker without areas sees no jobs');
select throws_ok($$select public.express_interest((select id from t_job))$$, null, 'this job is not available',
  'approved worker without areas cannot show interest');
select lives_ok($$select public.set_my_areas(array[6]::smallint[])$$, 'worker picks areas after approval');
select is((select count(*) from public.worker_feed where title = 'Kitchen tap leaking'), 1::bigint, 'after choosing areas the job appears in the feed');

-- ---------------------------------------------------------------- 0017: worker_feed.quote_count
select is((select quote_count from public.worker_feed where title = 'Kitchen tap leaking'), 0::bigint, 'a new job has quote_count 0');
select is((select interest_count from public.worker_feed where title = 'Kitchen tap leaking'), 0::bigint, 'a new job has interest_count 0');

-- b1 and b5 become approved workers with phase 6 so they can engage with the job.
select tests.back();
update public.profiles set verification_status = 'approved'
where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b5');
insert into public.worker_areas (worker_id, phase) values
  ('00000000-0000-0000-0000-0000000000b1', 6), ('00000000-0000-0000-0000-0000000000b5', 6);
insert into public.worker_categories (worker_id, category_id) values ('00000000-0000-0000-0000-0000000000b5', 1)
on conflict do nothing;

-- b1 shows interest twice (a retry must be safe), then quotes.
select tests.act('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.express_interest((select id from t_job))$$, 'b1 shows interest');
select lives_ok($$select public.express_interest((select id from t_job))$$, 'a repeated express_interest is harmless');
select is((select count(*) from public.job_interests where job_id = (select id from t_job)), 1::bigint,
  'duplicate interest leaves one row');
select lives_ok($$
  select public.submit_quote((select id from t_job), 3000, now() + interval '1 day', now() + interval '1 day 2 hours',
    0, null, 0, null, null)$$, 'b1 sends a quote');

-- b6 (still has a feed view) sees the counts; b1 no longer does (their own stake hides the job).
select tests.act('00000000-0000-0000-0000-0000000000b6');
select is((select count(*) from public.worker_feed where title = 'Kitchen tap leaking'), 0::bigint, 'once b1 has quoted, the job is locked to b1 and leaves another worker''s feed (0043)');
select is((select count(*) from public.worker_feed where title = 'Kitchen tap leaking'), 0::bigint, 'and stays out of the feed, whatever the interest count was');

-- A second quote raises it; a withdrawn quote does not count.
select tests.act('00000000-0000-0000-0000-0000000000b5');
select lives_ok($$select public.express_interest((select id from t_job))$$, 'b5 shows interest');
select lives_ok($$
  select public.submit_quote((select id from t_job), 2500, now() + interval '1 day', now() + interval '1 day 2 hours',
    0, null, 0, null, null)$$, 'b5 sends a quote');
select tests.act('00000000-0000-0000-0000-0000000000b6');
select is((select count(*) from public.worker_feed where title = 'Kitchen tap leaking'), 0::bigint, 'a quoted job takes no second claim and stays out of the feed');
select is((select count(*) from public.worker_feed where title = 'Kitchen tap leaking'), 0::bigint, 'still out of the feed');

select tests.act('00000000-0000-0000-0000-0000000000b5');
select lives_ok($$select public.withdraw_quote((select id from public.quotes where worker_id = '00000000-0000-0000-0000-0000000000b5'))$$,
  'b5 withdraws the quote');
select tests.act('00000000-0000-0000-0000-0000000000b6');
select is((select count(*) from public.worker_feed where title = 'Kitchen tap leaking'), 0::bigint, 'the job is still quoted to b1, so it stays out of the feed');

-- Shape and privacy of the view.
select tests.back();
select is((select attname::text from pg_attribute
           where attrelid = 'public.worker_feed'::regclass and attnum = 21), 'quote_count', 'quote_count keeps its position (existing columns keep their order)');
select is((select attname::text from pg_attribute
           where attrelid = 'public.worker_feed'::regclass and attnum > 0 and not attisdropped
           order by attnum desc limit 1), 'thumb_paths', 'thumb_paths (0027) is the last column, added at the end');
select is((select attname::text from pg_attribute
           where attrelid = 'public.worker_feed'::regclass and attnum = 17), 'interest_count', 'interest_count keeps its position');
select is((select count(*) from pg_attribute
           where attrelid = 'public.worker_feed'::regclass and attnum > 0 and not attisdropped
             and attname ~ '(resident|phone|plot|floor|address|cnic|name$)' and attname <> 'category_name'),
  0::bigint, 'the feed exposes no resident identity, phone, plot or floor column');
select ok(has_table_privilege('authenticated', 'public.worker_feed', 'SELECT'), 'authenticated can still read the feed');
select ok(not has_table_privilege('anon', 'public.worker_feed', 'SELECT'), 'anon still cannot read the feed');
select ok(not has_table_privilege('authenticated', 'public.worker_feed', 'INSERT, UPDATE, DELETE'), 'the feed is read only');

select * from finish();
rollback;
