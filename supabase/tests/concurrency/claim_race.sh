#!/usr/bin/env bash
# Claim-and-lock (migration 0031): two workers tap Accept on the same open job at the same time. Exactly one must win.
# Local only: it commits throwaway rows, so run `supabase db reset` afterwards.
# Usage: bash supabase/tests/concurrency/accept_race.sh   (local stack must be running)
set -euo pipefail
DB=$(docker ps --format '{{.Names}}' | grep '^supabase_db_dha-works$')
psql() { docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

U_RES=00000000-0000-0000-0000-0000000000f1
U_W1=00000000-0000-0000-0000-0000000000f2
U_W2=00000000-0000-0000-0000-0000000000f3
as() { echo "select set_config('request.jwt.claims', json_build_object('sub','$1','role','authenticated')::text, true); set local role authenticated;"; }

psql <<SQL
insert into auth.users (id, aud, role, email) values
  ('$U_RES','authenticated','authenticated','claim-res@test.dev'),
  ('$U_W1','authenticated','authenticated','claim-w1@test.dev'),
  ('$U_W2','authenticated','authenticated','claim-w2@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('$U_RES','resident','Race Resident','claim-res@test.dev','03000000001','approved'),
  ('$U_W1','worker','Race One','claim-w1@test.dev','03000000002','approved'),
  ('$U_W2','worker','Race Two','claim-w2@test.dev','03000000003','approved');
insert into public.worker_details (profile_id) values ('$U_W1'), ('$U_W2');
insert into public.worker_categories (worker_id, category_id) values ('$U_W1',1), ('$U_W2',1);
insert into public.worker_areas (worker_id, phase) values ('$U_W1',6), ('$U_W2',6);
SQL

JOB=$(psql <<SQL | tail -1
begin; $(as $U_RES) select public.upsert_address(null,'Home',6::smallint,'Lane 4','12-C','2nd',true) \gset
select public.save_job_draft(null,1::smallint,:'upsert_address','Claim race job','Race test for concurrent claims','asap',null,null,null,null,array['$U_RES/r.jpg']) as j \gset
select public.post_job(:'j');
commit;
select :'j';
SQL
)

# Worker 1 accepts and holds its transaction open for 3 s; worker 2 tries one second later and must be refused.
( psql <<SQL > /tmp/claim_a.out 2>&1; echo "A exit=$?" >> /tmp/claim_a.out
begin; $(as $U_W1) select public.accept_job('$JOB', 1000); select pg_sleep(3); commit;
SQL
) &
sleep 1
( psql <<SQL > /tmp/claim_b.out 2>&1; echo "B exit=$?" >> /tmp/claim_b.out
begin; $(as $U_W2) select public.accept_job('$JOB', 900); commit;
SQL
) &
wait

echo "--- worker 1:"; cat /tmp/claim_a.out; echo "--- worker 2:"; cat /tmp/claim_b.out
# Since 0043 a claim leaves the job quoted (one sent quote) until the customer accepts.
SENT=$(psql -c "select count(*) from public.quotes where job_id='$JOB' and status='sent'")
STATUS=$(psql -c "select status from public.jobs where id='$JOB'")
WINNER=$(psql -c "select worker_id from public.quotes where job_id='$JOB' and status='sent'")
echo "sent quotes=$SENT job status=$STATUS winner=$WINNER"
[ "$SENT" = "1" ] && [ "$STATUS" = "quoted" ] && [ "$WINNER" = "$U_W1" ] && echo "PASS: exactly one worker holds the job" || { echo "FAIL"; exit 1; }
