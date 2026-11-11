#!/usr/bin/env bash
# Three workers claim the SAME open job at the same moment (accept_job). Exactly one must win; the other two must be
# refused and leave nothing behind. Local only: it commits throwaway rows, so run `supabase db reset` afterwards.
# Usage: bash supabase/tests/concurrency/claim_race.sh   (local stack must be running)
set -euo pipefail
DB=$(docker ps --format '{{.Names}}' | grep '^supabase_db_dha-works$')
psql() { docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -qtA "$@"; }
OUT=$(mktemp -d)

U_RES=00000000-0000-0000-0000-0000000000e1
W1=00000000-0000-0000-0000-0000000000e2
W2=00000000-0000-0000-0000-0000000000e3
W3=00000000-0000-0000-0000-0000000000e4
as() { echo "select set_config('request.jwt.claims', json_build_object('sub','$1','role','authenticated')::text, true); set local role authenticated;"; }

# Remove rows of an earlier run, so the script can be repeated without a database reset.
psql <<SQL
delete from public.notifications where user_id in ('$U_RES','$W1','$W2','$W3');
delete from public.jobs where resident_id = '$U_RES';
delete from public.addresses where resident_id = '$U_RES';
delete from public.profiles where id in ('$U_RES','$W1','$W2','$W3');
delete from auth.users where id in ('$U_RES','$W1','$W2','$W3');
SQL

psql <<SQL
insert into auth.users (id, aud, role, email) values
  ('$U_RES','authenticated','authenticated','claim-res@test.dev'),
  ('$W1','authenticated','authenticated','claim-w1@test.dev'),
  ('$W2','authenticated','authenticated','claim-w2@test.dev'),
  ('$W3','authenticated','authenticated','claim-w3@test.dev');
insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('$U_RES','resident','Claim Resident','claim-res@test.dev','03000000011','approved'),
  ('$W1','worker','Claim One','claim-w1@test.dev','03000000012','approved'),
  ('$W2','worker','Claim Two','claim-w2@test.dev','03000000013','approved'),
  ('$W3','worker','Claim Three','claim-w3@test.dev','03000000014','approved');
insert into public.worker_details (profile_id) values ('$W1'), ('$W2'), ('$W3');
insert into public.worker_categories (worker_id, category_id) values ('$W1',1), ('$W2',1), ('$W3',1);
insert into public.worker_areas (worker_id, phase) values ('$W1',6), ('$W2',6), ('$W3',6);
SQL

JOB=$(psql <<SQL | tail -1
begin; $(as $U_RES) select public.upsert_address(null,'Home',6::smallint,'Lane 4','12-C','2nd',true) as a \gset
select public.save_job_draft(null,1::smallint,:'a','Claim race job','Race test for concurrent claims','asap',null,null,null,null,array['$U_RES/c.jpg']) as j \gset
select public.post_job(:'j');
commit;
select :'j';
SQL
)

# Each session starts, waits on a shared barrier time, then claims. A pg_sleep until the same instant makes them overlap.
START=$(psql -c "select (clock_timestamp() + interval '3 seconds')")
for W in $W1 $W2 $W3; do
  ( psql <<SQL > "$OUT/$W.out" 2>&1; echo "exit=$?" >> "$OUT/$W.out"
begin; $(as $W) select pg_sleep(greatest(0, extract(epoch from ('$START'::timestamptz - clock_timestamp()))));
select public.accept_job('$JOB', 1000, 0);
commit;
SQL
  ) &
done
wait

for W in $W1 $W2 $W3; do
  echo "--- $W"; grep -v '^$' "$OUT/$W.out" | grep -v 'sub"\|set_config' | head -4
done
OK=0; REFUSED=0
for W in $W1 $W2 $W3; do
  if grep -q "exit=0" "$OUT/$W.out"; then OK=$((OK+1)); else REFUSED=$((REFUSED+1)); fi
done
STATUS=$(psql -c "select status from public.jobs where id='$JOB'")
QUOTES=$(psql -c "select count(*) from public.quotes where job_id='$JOB'")
WINNER=$(psql -c "select worker_id from public.quotes where job_id='$JOB' limit 1")
WINQ=0; for W in $W1 $W2 $W3; do if [ "$W" = "$WINNER" ] && grep -q "exit=0" "$OUT/$W.out"; then WINQ=1; fi; done
echo "claims ok=$OK refused=$REFUSED job status=$STATUS quotes=$QUOTES winner=$WINNER"
if [ "$OK" = "1" ] && [ "$REFUSED" = "2" ] && [ "$STATUS" = "quoted" ] && [ "$QUOTES" = "1" ] && [ "$WINQ" = "1" ]; then
  echo "PASS: exactly one of three simultaneous claims won"
else
  echo "FAIL"; exit 1
fi
