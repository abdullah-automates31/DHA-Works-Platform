-- LOCAL DEVELOPMENT ONLY. Attack lab for the busy-worker and scheduling rules (migrations 0057, 0058): two residents and two approved workers
-- (fake people; the password Test#12345 is public on purpose), a helper schema `atk`, 40 open jobs of the first resident (n 1 to 40) and 10 of the second (n 101 to 110). Never run this against
-- a hosted project. Run it on a freshly reset local stack (`npm run db:local -- db reset`), then:
--   docker exec -i supabase_db_dha-works psql -U postgres -d postgres -q < supabase/dev/seed_local_attack_lab.sql
--   node scripts/challenge-busy-worker-local.cjs   (checks the 16 Nov rules of migration 0058)
-- The lab uses the same user ids as the pgTAP files, so reset the database again before `npm run db:local -- test db`.
begin;
create schema if not exists atk;
grant usage on schema atk to authenticated;
drop table if exists atk.jobs;
create table atk.jobs (n int primary key, id uuid);

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, encrypted_password, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, phone_change, phone_change_token)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email, now(),
       extensions.crypt('Test#12345', extensions.gen_salt('bf')), now(), now(),
       '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''
from (values ('00000000-0000-0000-0000-0000000000a1', 'atk-res@test.dev'),
             ('00000000-0000-0000-0000-0000000000a2', 'atk-res2@test.dev'),
             ('00000000-0000-0000-0000-0000000000b1', 'atk-w1@test.dev'),
             ('00000000-0000-0000-0000-0000000000b2', 'atk-w2@test.dev')) as v(id, email)
on conflict (id) do nothing;
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email', jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
from auth.users u where u.email in ('atk-res@test.dev', 'atk-res2@test.dev', 'atk-w1@test.dev', 'atk-w2@test.dev')
on conflict do nothing;

insert into public.profiles (id, role, full_name, email, phone, verification_status) values
  ('00000000-0000-0000-0000-0000000000a1', 'resident', 'Atk Resident', 'atk-res@test.dev', '03001110001', 'approved'),
  ('00000000-0000-0000-0000-0000000000a2', 'resident', 'Atk Resident Two', 'atk-res2@test.dev', '03001110002', 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'worker', 'Atk Worker One', 'atk-w1@test.dev', '03003334444', 'approved'),
  ('00000000-0000-0000-0000-0000000000b2', 'worker', 'Atk Worker Two', 'atk-w2@test.dev', '03005556666', 'approved')
on conflict (id) do update set verification_status = 'approved', account_status = 'active';
insert into public.worker_details (profile_id) values ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2') on conflict do nothing;
insert into public.worker_categories (worker_id, category_id) values ('00000000-0000-0000-0000-0000000000b1', 1), ('00000000-0000-0000-0000-0000000000b2', 1) on conflict do nothing;
insert into public.worker_areas (worker_id, phase) values ('00000000-0000-0000-0000-0000000000b1', 6), ('00000000-0000-0000-0000-0000000000b2', 6) on conflict do nothing;

create function atk.act(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function atk.back() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;
create function atk.make_job(p_n int, p_res uuid default '00000000-0000-0000-0000-0000000000a1') returns uuid language plpgsql as $$
declare v_job uuid; v_addr uuid;
begin
  perform atk.act(p_res);
  v_addr := public.upsert_address(null, 'Home' || p_n, 6::smallint, 'Lane 4', '12-C', '2nd', false);
  v_job := public.save_job_draft(null, 1::smallint, v_addr, 'Atk job ' || p_n, 'Needs fixing today', 'asap', null, null, null, null,
                                 array[p_res::text || '/p' || p_n || '.jpg']);
  perform public.post_job(v_job);
  perform atk.back();
  return v_job;
end $$;
grant execute on function atk.act(uuid), atk.back() to authenticated;
insert into atk.jobs select g, atk.make_job(g) from generate_series(1, 40) g;
insert into atk.jobs select g, atk.make_job(g, '00000000-0000-0000-0000-0000000000a2') from generate_series(101, 110) g;
commit;
select count(*) as jobs_created from atk.jobs;
