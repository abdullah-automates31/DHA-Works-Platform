-- Migration 0081: my_payment_detail(payment). One payment in full: its facts, and which dues it paid (worked out from the pooled,
-- oldest-first ledger), credit, a projection for a waiting payment, nothing for a rejected one. Own payments only.
begin;
select no_plan();

create schema tests;
grant usage on schema tests to authenticated;
create function tests.act(p_uid uuid, p_session uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'session_id', coalesce(p_session, p_uid))::text, true);
  execute 'set local role authenticated';
end $$;
create function tests.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
grant execute on function tests.act(uuid, uuid), tests.back() to authenticated;

-- a1 resident (owns the jobs); b1 and b2 approved workers; c1 admin (the one who waived).
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'res@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'w1@test.dev'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'w2@test.dev'),
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'admin1@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Rida Resident', 'res@test.dev', '03001112222', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Usman One', 'w1@test.dev', '03003334444', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Bilal Two', 'w2@test.dev', '03005556666', 'approved'),
  ('00000000-0000-0000-0000-0000000000c1', 'admin', 'Staff One', 'admin1@test.dev', '03009990001', 'approved');
insert into public.worker_details (profile_id) values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');

create function tests.make_job(p_title text, p_n text) returns uuid language plpgsql as $$
declare
  v_job uuid;
  v_addr uuid;
begin
  perform tests.act('00000000-0000-0000-0000-0000000000a1');
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, p_title, 'Needs fixing today', 'asap'::public.job_urgency, null, null, null, null,
                                 array['00000000-0000-0000-0000-0000000000a1/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform tests.back();
  return v_job;
end $$;

-- Four jobs. Dues of worker b1, oldest first: J1 Rs 50, J2 Rs 60, J3 Rs 50, and a WAIVED Rs 40 one in between (not counted).
create temp table jobs_t (n text primary key, id uuid);
insert into jobs_t select 'J1', tests.make_job('Tap one', '1');
insert into jobs_t select 'J2', tests.make_job('Tap two', '2');
insert into jobs_t select 'J3', tests.make_job('Tap three', '3');
insert into jobs_t select 'JW', tests.make_job('Tap waived', '4');
insert into jobs_t select 'JX', tests.make_job('Other worker job', '5');
grant select on jobs_t to authenticated;

insert into public.worker_dues (worker_id, job_id, amount, accrued_at, due_at) values
  ('00000000-0000-0000-0000-0000000000b1', (select id from jobs_t where n = 'J1'), 50, now() - interval '4 days', now() + interval '1 day'),
  ('00000000-0000-0000-0000-0000000000b1', (select id from jobs_t where n = 'J2'), 60, now() - interval '3 days', now() + interval '2 days'),
  ('00000000-0000-0000-0000-0000000000b1', (select id from jobs_t where n = 'J3'), 50, now() - interval '1 day', now() + interval '4 days');
insert into public.worker_dues (worker_id, job_id, amount, accrued_at, due_at, waived_at, waived_by, waive_reason) values
  ('00000000-0000-0000-0000-0000000000b1', (select id from jobs_t where n = 'JW'), 40, now() - interval '2 days', now() + interval '3 days', now(), '00000000-0000-0000-0000-0000000000c1', 'test');
insert into public.worker_dues (worker_id, job_id, amount, accrued_at, due_at) values
  ('00000000-0000-0000-0000-0000000000b2', (select id from jobs_t where n = 'JX'), 70, now() - interval '1 day', now() + interval '4 days');

-- Payments of b1. Counted dues are Rs 160 in all: J1 [0,50), J2 [50,110), J3 [110,160).
--   P1 confirmed Rs 80 (sent first)  -> stretch [0,80):    J1 50, J2 30
--   P2 confirmed Rs 40 (sent second) -> stretch [80,120):  J2 30, J3 10
--   P3 rejected  Rs 50                                      -> paid nothing
--   P4 pending   Rs 30 (sent last)   -> projected [120,150): J3 30
--   P5 confirmed Rs 100 by staff at the office, sent later than P2 but before P4's decision: see below (added in a second step)
insert into public.dues_payments (id, worker_id, amount, method, reference, status, created_by, created_at, decided_by, decided_at, proof_path) values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000b1', 80, 'jazzcash', 'PD-1', 'confirmed', '00000000-0000-0000-0000-0000000000b1', now() - interval '3 days', '00000000-0000-0000-0000-0000000000c1', now() - interval '3 days', '00000000-0000-0000-0000-0000000000b1/dues/p1.jpg'),
  ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-0000000000b1', 40, 'bank', 'PD-2', 'confirmed', '00000000-0000-0000-0000-0000000000b1', now() - interval '2 days', '00000000-0000-0000-0000-0000000000c1', now() - interval '2 days', null);
insert into public.dues_payments (id, worker_id, amount, method, reference, status, created_by, created_at, decided_by, decided_at, decision_reason, proof_path) values
  ('00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-0000000000b1', 50, 'easypaisa', 'PD-3', 'rejected', '00000000-0000-0000-0000-0000000000b1', now() - interval '1 day', '00000000-0000-0000-0000-0000000000c1', now() - interval '1 day', 'the id was not found', '00000000-0000-0000-0000-0000000000b1/dues/p3.jpg');
insert into public.dues_payments (id, worker_id, amount, method, reference, status, created_by, created_at, proof_path) values
  ('00000000-0000-0000-0000-00000000f004', '00000000-0000-0000-0000-0000000000b1', 30, 'jazzcash', 'PD-4', 'pending', '00000000-0000-0000-0000-0000000000b1', now() - interval '1 hour', '00000000-0000-0000-0000-0000000000b1/dues/p4.jpg');
insert into public.dues_payments (id, worker_id, amount, method, reference, status, created_by, created_at) values
  ('00000000-0000-0000-0000-00000000f009', '00000000-0000-0000-0000-0000000000b2', 20, 'jazzcash', 'PD-9', 'pending', '00000000-0000-0000-0000-0000000000b2', now());

-- Who may call it ---------------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.my_payment_detail('00000000-0000-0000-0000-00000000f001')$$, '42501', 'not available', 'a resident cannot');
select tests.back();
select tests.act('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select public.my_payment_detail('00000000-0000-0000-0000-00000000f001')$$, '42501', 'not available', 'staff use the portal, not this function');
select tests.back();
set local role anon;
select throws_ok($$select public.my_payment_detail('00000000-0000-0000-0000-00000000f001')$$, '42501', null, 'anon cannot');
reset role;

-- Another worker's payment looks like one that does not exist -----------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$select public.my_payment_detail('00000000-0000-0000-0000-00000000f001')$$, 'P0001', 'this payment was not found', 'worker b2 cannot read b1''s payment');
select throws_ok($$select public.my_payment_detail('00000000-0000-0000-0000-00000000ffff')$$, 'P0001', 'this payment was not found', 'a payment that does not exist: the same words');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f009') -> 'payment' ->> 'amount'), '20', 'b2 reads their own');
select tests.back();

-- b1's payments ---------------------------------------------------------------------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');

-- P1: confirmed Rs 80 pays J1 in full (50) and J2 in part (30)
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'payment' ->> 'status'), 'confirmed', 'P1 is confirmed');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'payment' ->> 'method'), 'jazzcash', 'how it was paid');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'payment' ->> 'reference'), 'PD-1', 'the transaction ID');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'payment' ->> 'proof_path'), '00000000-0000-0000-0000-0000000000b1/dues/p1.jpg', 'the worker gets the path of their own screenshot');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'payment' ->> 'by_staff'), 'false', 'sent by the worker, not staff');
select is(jsonb_array_length(public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'covers'), 2, 'P1 paid two dues');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'covers' -> 0 ->> 'title'), 'Tap one', 'the oldest due first');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'covers' -> 0 ->> 'covered'), '50', 'J1 paid in full by P1');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'covers' -> 0 ->> 'fee'), '50', 'with the fee beside it');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'covers' -> 1 ->> 'title'), 'Tap two', 'then the next one');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'covers' -> 1 ->> 'covered'), '30', 'J2 only in part by P1');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'covers' -> 0 ->> 'phase'), '6', 'where: the phase of the job');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'covers' -> 0 ->> 'lane'), 'Lane 4', 'and the lane');
select ok((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'covers' -> 0) ? 'completed_at', 'and when it was completed');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') ->> 'credit'), '0', 'no credit');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') ->> 'projected'), 'false', 'a confirmed payment is not a projection');

-- P2: confirmed Rs 40 pays the rest of J2 (30) and starts J3 (10); the waived due is not counted
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f002') -> 'covers' -> 0 ->> 'title'), 'Tap two', 'P2 starts where P1 stopped');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f002') -> 'covers' -> 0 ->> 'covered'), '30', 'the other 30 of J2');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f002') -> 'covers' -> 1 ->> 'title'), 'Tap three', 'then J3');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f002') -> 'covers' -> 1 ->> 'covered'), '10', 'Rs 10 of J3');
select is((select count(*) from jsonb_array_elements(public.my_payment_detail('00000000-0000-0000-0000-00000000f002') -> 'covers') c where c ->> 'title' = 'Tap waived'), 0::bigint, 'a waived due is never listed');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f002') -> 'payment' ->> 'proof_path'), null, 'no screenshot: null');

-- the two confirmed payments add up to what My Dues says is paid (the same pooled oldest-first rule as private.dues_rows)
select is((select sum((c ->> 'covered')::int) from jsonb_array_elements(public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'covers') c)
        + (select sum((c ->> 'covered')::int) from jsonb_array_elements(public.my_payment_detail('00000000-0000-0000-0000-00000000f002') -> 'covers') c),
          (select sum((x ->> 'paid')::int) from jsonb_array_elements(public.my_dues() -> 'dues') x), 'what the payments paid equals what My Dues shows as paid');

-- P3: rejected pays nothing and says why
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f003') -> 'payment' ->> 'status'), 'rejected', 'P3 is rejected');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f003') -> 'payment' ->> 'reason'), 'the id was not found', 'with the reason');
select is(jsonb_array_length(public.my_payment_detail('00000000-0000-0000-0000-00000000f003') -> 'covers'), 0, 'it paid nothing');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f003') ->> 'credit'), '0', 'and made no credit');

-- P4: pending Rs 30 is a projection onto J3 (stretch [120,150))
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f004') ->> 'projected'), 'true', 'a waiting payment is a projection');
select is(jsonb_array_length(public.my_payment_detail('00000000-0000-0000-0000-00000000f004') -> 'covers'), 1, 'it would go to one due');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f004') -> 'covers' -> 0 ->> 'title'), 'Tap three', 'the oldest due that is still open');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f004') -> 'covers' -> 0 ->> 'covered'), '30', 'Rs 30 of it');
select tests.back();

-- Staff office cash, a payment bigger than what is left: the rest is credit ------------------------------------------------------
insert into public.dues_payments (id, worker_id, amount, method, reference, status, created_by, created_at, decided_by, decided_at, note) values
  ('00000000-0000-0000-0000-00000000f005', '00000000-0000-0000-0000-0000000000b1', 100, 'office_cash', null, 'confirmed', '00000000-0000-0000-0000-0000000000c1', now(), '00000000-0000-0000-0000-0000000000c1', now(), 'cash at the office');
select tests.act('00000000-0000-0000-0000-0000000000b1');
-- confirmed so far: 80 + 40 + 100 = 220; P5 owns [120,220): J3 needs [110,160) so it pays J3's last 40 (the first 10 came from P2); 60 is credit
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f005') -> 'payment' ->> 'by_staff'), 'true', 'recorded by staff');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f005') -> 'covers' -> 0 ->> 'title'), 'Tap three', 'P5 pays what is left of J3');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f005') -> 'covers' -> 0 ->> 'covered'), '40', 'Rs 40 of it');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f005') ->> 'credit'), '60', 'and Rs 60 stays as credit');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f005') -> 'payment' ->> 'reference'), null, 'office cash has no transaction ID');
-- the waiting P4 now projects past the dues: nothing left to pay, all credit
select is(jsonb_array_length(public.my_payment_detail('00000000-0000-0000-0000-00000000f004') -> 'covers'), 0, 'P4 would pay nothing now: the dues are all paid');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f004') ->> 'credit'), '30', 'it would all be credit');
select tests.back();

-- Nothing about the automatic check, and the function is closed to the wrong roles ------------------------------------------------
select tests.act('00000000-0000-0000-0000-0000000000b1');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') ? 'check'), false, 'the worker never sees the screenshot check');
select is((public.my_payment_detail('00000000-0000-0000-0000-00000000f001') -> 'payment' ? 'check'), false, 'not inside the payment either');
select tests.back();
select is(has_function_privilege('anon', 'public.my_payment_detail(uuid)', 'execute'), false, 'anon has no execute');
select is(has_function_privilege('authenticated', 'public.my_payment_detail(uuid)', 'execute'), true, 'signed-in users have execute (the function checks the role itself)');

select * from finish();
rollback;
