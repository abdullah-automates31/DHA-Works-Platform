-- Migration 0068: an admin who forgot the password can reset it through the portal (owner request, 19 Nov 2026).
--
-- Flow: "Forgot password?" -> the admin-password-reset Edge Function checks the Cloudflare Turnstile bot check and asks
-- admin_reset_issue for a six-digit code, which it emails (Brevo, like the sign-in code) -> the admin types the code and
-- a new password -> admin_reset_confirm checks the code and sets the password.
--
-- Owner decisions: no approval by another admin, no email to the other admins, no waiting period, no authenticator
-- app. If the email is not an active admin the page says so plainly. Every step is written to the audit log.
--
-- What this migration also closes (found by testing on the local stack, 19 Nov):
--   1. Supabase's own password recovery (POST /auth/v1/recover with the public key, then the emailed link) can set
--      a new password for ANY account, admins included. A trigger on auth.users now refuses to change an admin's
--      password unless it happens inside admin_reset_confirm.
--   2. A session made by an email link (magic link, recovery, one-time code) is not a password sign-in. The admin
--      code is emailed to the same inbox, so such a session plus the code would open the portal without the
--      password. admin_issue_challenge now refuses a session that was not created with the password.
--
-- Limits (same as the sign-in code): six digits, valid 10 minutes, 5 wrong tries per code, 10 wrong tries per hour
-- across codes, one code a minute and five an hour per account. Codes are stored only as a salted hash.

-- Table ----------------------------------------------------------------------------------------------------------
create table public.admin_reset_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null,
  tries smallint not null default 0,
  consumed boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);
create index admin_reset_challenges_user_idx on public.admin_reset_challenges (user_id, created_at desc);
alter table public.admin_reset_challenges enable row level security;
-- No policy and no grant: only the security-definer functions below touch this table.

-- Issue a code (service role only: called by the admin-password-reset Edge Function, which emails it) ---------------
-- Returns jsonb {status, code?, email?}: 'sent' (with the code and the address to mail), 'not_admin', 'wait' or
-- 'limit'. It never raises for those, so the Edge Function can answer plainly.
create function public.admin_reset_issue(p_email text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_mail text;
  v_id uuid := gen_random_uuid();
  v_code text;
begin
  select u.id, u.email into v_uid, v_mail
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(btrim(coalesce(p_email, '')))
    and p.role = 'admin' and p.account_status = 'active'
  limit 1;
  if v_uid is null then return jsonb_build_object('status', 'not_admin'); end if;

  -- Two requests at the same moment must not both pass the one-a-minute check.
  perform pg_advisory_xact_lock(hashtextextended('admin_reset_issue:' || v_uid::text, 0));
  if exists (select 1 from public.admin_reset_challenges where user_id = v_uid and created_at > now() - interval '1 minute') then
    return jsonb_build_object('status', 'wait');
  end if;
  if (select count(*) from public.admin_reset_challenges where user_id = v_uid and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('status', 'limit');
  end if;

  update public.admin_reset_challenges set consumed = true where user_id = v_uid and not consumed;
  v_code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into public.admin_reset_challenges (id, user_id, code_hash)
  values (v_id, v_uid, encode(extensions.digest(convert_to(v_code || v_id::text, 'utf8'), 'sha256'), 'hex'));
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (v_uid, 'admin_reset_requested', 'admin_reset_challenges', v_id::text); -- never the code itself
  return jsonb_build_object('status', 'sent', 'code', v_code, 'email', v_mail);
end;
$$;

-- Check the code and set the new password (service role only) ----------------------------------------------------
-- Returns 'ok', 'wrong', 'locked', 'expired', 'none' or 'weak' (the code was right but the password is not allowed;
-- the code stays valid). A wrong guess is counted and kept (the function returns instead of raising).
create function public.admin_reset_confirm(p_email text, p_code text, p_password text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_mail text;
  v_c public.admin_reset_challenges;
begin
  select u.id, u.email into v_uid, v_mail
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(btrim(coalesce(p_email, '')))
    and p.role = 'admin' and p.account_status = 'active'
  limit 1;
  if v_uid is null then return 'none'; end if;

  select * into v_c from public.admin_reset_challenges
  where user_id = v_uid and not consumed
  order by created_at desc limit 1
  for update;
  if not found then return 'none'; end if;
  if v_c.expires_at < now() then
    update public.admin_reset_challenges set consumed = true where id = v_c.id;
    return 'expired';
  end if;
  if v_c.tries >= 5 then return 'locked'; end if;
  if (select coalesce(sum(tries), 0) from public.admin_reset_challenges
       where user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    return 'locked';
  end if;

  if p_code is not null and p_code ~ '^[0-9]{6}$'
     and v_c.code_hash = encode(extensions.digest(convert_to(p_code || v_c.id::text, 'utf8'), 'sha256'), 'hex') then
    -- The code is right. The password must be 12 to 72 bytes (bcrypt reads at most 72) and not the email address.
    if p_password is null or char_length(p_password) < 12 or octet_length(p_password) > 72
       or lower(p_password) = lower(v_mail) then
      return 'weak';
    end if;
    update public.admin_reset_challenges set consumed = true where id = v_c.id;
    perform set_config('dha.admin_password_reset', 'on', true);
    update auth.users
       set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
           recovery_token = '', recovery_sent_at = null, updated_at = now()
     where id = v_uid;
    perform set_config('dha.admin_password_reset', '', true);
    -- Every session ends (refresh tokens and the verified-session rows go with them): the person signs in again.
    delete from auth.sessions where user_id = v_uid;
    update public.admin_factor_challenges set consumed = true where user_id = v_uid and not consumed;
    update public.admin_reset_challenges set consumed = true where user_id = v_uid and not consumed;
    insert into public.audit_log (actor_id, action, table_name, record_id)
    values (v_uid, 'admin_password_reset', 'admin_reset_challenges', v_c.id::text);
    return 'ok';
  end if;

  update public.admin_reset_challenges set tries = tries + 1 where id = v_c.id;
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (v_uid, 'admin_reset_code_wrong', 'admin_reset_challenges', v_c.id::text); -- never the guess itself
  if v_c.tries + 1 >= 5 then
    insert into public.audit_log (actor_id, action, table_name, record_id)
    values (v_uid, 'admin_reset_locked', 'admin_reset_challenges', v_c.id::text);
    return 'locked';
  end if;
  return 'wrong';
end;
$$;

revoke all on function public.admin_reset_issue(text) from public, anon, authenticated;
revoke all on function public.admin_reset_confirm(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_reset_issue(text) to service_role;
grant execute on function public.admin_reset_confirm(text, text, text) to service_role;

-- Close Supabase's own password recovery for admins ---------------------------------------------------------------
-- Only admin_reset_confirm (which sets the flag for its own transaction) may change an admin's password. The auth
-- service, the admin API and the dashboard recovery mail all fail here. A database owner working in the SQL editor
-- (session user postgres or supabase_admin) is still allowed: that is the owner's own break-glass.
create function private.block_admin_password_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(current_setting('dha.admin_password_reset', true), '') <> 'on'
     and session_user not in ('postgres', 'supabase_admin')
     and exists (select 1 from public.profiles where id = new.id and role = 'admin') then
    raise exception 'an admin password can only be reset through the portal' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger block_admin_password_change
  before update of encrypted_password on auth.users
  for each row execute function private.block_admin_password_change();

-- A session that did not start with the password cannot ask for the admin code ------------------------------------
-- auth.mfa_amr_claims records how each session was created ('password', 'magiclink', 'otp', 'recovery', ...).
-- Body as in 0048 (a verified session may still ask for a step-up code), plus the password check.
create or replace function public.admin_issue_challenge(p_user uuid, p_session uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_code text;
begin
  if not exists (select 1 from public.profiles where id = p_user and role = 'admin' and account_status = 'active') then
    raise exception 'not an active admin' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.sessions where id = p_session and user_id = p_user) then
    raise exception 'no such session' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.mfa_amr_claims where session_id = p_session and authentication_method = 'password') then
    raise exception 'this session did not start with the password' using errcode = '42501';
  end if;
  if exists (select 1 from public.admin_factor_challenges where user_id = p_user and created_at > now() - interval '1 minute') then
    raise exception 'wait a minute before asking for another code' using errcode = 'P0001';
  end if;
  if (select count(*) from public.admin_factor_challenges where user_id = p_user and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too many codes requested; try again later' using errcode = 'P0001';
  end if;

  update public.admin_factor_challenges set consumed = true where session_id = p_session and not consumed;
  v_code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into public.admin_factor_challenges (id, user_id, session_id, code_hash)
  values (v_id, p_user, p_session,
          encode(extensions.digest(convert_to(v_code || v_id::text, 'utf8'), 'sha256'), 'hex'));
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (p_user, 'admin_code_issued', 'admin_factor_challenges', v_id::text); -- never the code itself
  return v_code;
end;
$$;
