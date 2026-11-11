-- SYNTHETIC DEMO WORKERS for the shared DEV project (and for the local stack). Never run on production.
-- Three separate approved worker identities (separate auth users, separate phone numbers) so a demo or test can show
-- competing claims, claim-and-lock, "replace worker" and feed updates between real, independent accounts.
--
-- Everything here is fake: names, numbers and CNICs. No real person's data goes into DEV (docs/TEST-PLAN.md section 1).
--
-- BEFORE you use the accounts, add their sign-in codes in the Supabase dashboard of the DEV project:
--   Authentication > Sign In / Providers > Phone > Test Phone Numbers and OTPs
-- one line per number, a six-digit code of your choice for each (keep the codes in the git-ignored .env.dev-test-otps,
-- never in a committed file or in chat):
--   923000000201=<code>,923000000202=<code>,923000000203=<code>
-- (Local stack: the three numbers are not in the static test OTP list; use `npm run db:local` and add them there if needed.)
--
-- Hosted DEV (after checking `supabase status` shows ref xiozwoocisesgmegewww and `db push --dry-run` is empty):
--   supabase db query --linked -f supabase/dev/seed_dev_demo_workers.sql
-- Re-running is safe: every row is an upsert on its fixed id.
--
-- Demo cast (all approved and active, phases 5 to 8, so they see the same jobs as the main test worker):
--   +923000000201  Demo Worker Plumber        Plumbing
--   +923000000202  Demo Worker Electrician    Electrical
--   +923000000203  Demo Worker All-rounder    Plumbing + Electrical + Welding & Ironwork

begin;

insert into auth.users (id, instance_id, aud, role, phone, phone_confirmed_at, encrypted_password, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, phone_change, phone_change_token)
values
  ('d3300000-0000-4000-8000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '923000000201', now(), '', now(), now(), '{"provider":"phone","providers":["phone"]}', '{}', '', '', '', '', '', '', '', ''),
  ('d3300000-0000-4000-8000-000000000202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '923000000202', now(), '', now(), now(), '{"provider":"phone","providers":["phone"]}', '{}', '', '', '', '', '', '', '', ''),
  ('d3300000-0000-4000-8000-000000000203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '923000000203', now(), '', now(), now(), '{"provider":"phone","providers":["phone"]}', '{}', '', '', '', '', '', '', '', '')
on conflict (id) do update set
  phone = excluded.phone, phone_confirmed_at = excluded.phone_confirmed_at, updated_at = now(),
  raw_app_meta_data = excluded.raw_app_meta_data, raw_user_meta_data = excluded.raw_user_meta_data,
  confirmation_token = '', recovery_token = '', email_change_token_new = '', email_change = '',
  email_change_token_current = '', reauthentication_token = '', phone_change = '', phone_change_token = '';

insert into public.profiles (id, role, full_name, phone, cnic, gender, date_of_birth, verification_status, account_status)
values
  ('d3300000-0000-4000-8000-000000000201', 'worker', 'Demo Worker Plumber',     '+923000000201', '42101-0000201-1', 'male', date '1988-03-03', 'approved', 'active'),
  ('d3300000-0000-4000-8000-000000000202', 'worker', 'Demo Worker Electrician', '+923000000202', '42101-0000202-1', 'male', date '1991-04-04', 'approved', 'active'),
  ('d3300000-0000-4000-8000-000000000203', 'worker', 'Demo Worker All-rounder', '+923000000203', '42101-0000203-1', 'male', date '1985-05-05', 'approved', 'active')
on conflict (id) do update set
  full_name = excluded.full_name, phone = excluded.phone, cnic = excluded.cnic, gender = excluded.gender,
  date_of_birth = excluded.date_of_birth, verification_status = 'approved', verification_reason = null,
  account_status = 'active', suspended_at = null, suspended_until = null, suspension_reason = null;

insert into public.worker_details (profile_id)
values ('d3300000-0000-4000-8000-000000000201'), ('d3300000-0000-4000-8000-000000000202'), ('d3300000-0000-4000-8000-000000000203')
on conflict (profile_id) do update set available_today = true;

-- Trades: look the category ids up by name so the script survives a re-numbered category list.
delete from public.worker_categories where worker_id in
  ('d3300000-0000-4000-8000-000000000201', 'd3300000-0000-4000-8000-000000000202', 'd3300000-0000-4000-8000-000000000203');
insert into public.worker_categories (worker_id, category_id)
select w.id, c.id
from (values
  ('d3300000-0000-4000-8000-000000000201'::uuid, 'Plumbing'),
  ('d3300000-0000-4000-8000-000000000202'::uuid, 'Electrical'),
  ('d3300000-0000-4000-8000-000000000203'::uuid, 'Plumbing'),
  ('d3300000-0000-4000-8000-000000000203'::uuid, 'Electrical'),
  ('d3300000-0000-4000-8000-000000000203'::uuid, 'Welding & Ironwork')
) as w(id, trade)
join public.categories c on c.name = w.trade;

delete from public.worker_areas where worker_id in
  ('d3300000-0000-4000-8000-000000000201', 'd3300000-0000-4000-8000-000000000202', 'd3300000-0000-4000-8000-000000000203');
insert into public.worker_areas (worker_id, phase)
select w.id, p
from (values
  ('d3300000-0000-4000-8000-000000000201'::uuid), ('d3300000-0000-4000-8000-000000000202'::uuid), ('d3300000-0000-4000-8000-000000000203'::uuid)
) as w(id), generate_series(5, 8) as p;

-- Self-check: all three must be approved workers with at least one trade and four phases.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.profiles p
  where p.id in ('d3300000-0000-4000-8000-000000000201', 'd3300000-0000-4000-8000-000000000202', 'd3300000-0000-4000-8000-000000000203')
    and (p.verification_status <> 'approved'
         or (select count(*) from public.worker_categories c where c.worker_id = p.id) = 0
         or (select count(*) from public.worker_areas a where a.worker_id = p.id) <> 4);
  if v_bad > 0 then raise exception 'seed check failed for % demo worker(s)', v_bad; end if;
end $$;

commit;
