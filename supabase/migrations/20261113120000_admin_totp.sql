-- 0052: authenticator-app (TOTP) second factor for admin staff (docs/SECURITY.md section 18, audit 13 Nov 2026).
--
-- Until now an emailed six-digit code made a session an admin session (0037, 0046, 0048). Supabase's authenticator-app
-- factor is free on every plan, so it replaces the email code for signing in and for the 15-minute step-up. Sign-in is
-- now: password, then the code from the authenticator app. The emailed code stays for ONE job only: proving the
-- mailbox when a person registers a new authenticator (first sign-in, or a lost phone).
--
-- How a session becomes an admin session (nothing about is_admin() or private.admin_fresh() changes; only who may write
-- public.admin_verified_sessions does):
--   1. The person verifies their authenticator code with Supabase Auth. The session becomes aal2 and records the factor.
--   2. The portal calls admin_mark_session_verified(). The database requires: an active admin account, an aal2 session
--      whose factor is the REGISTERED one for that account, a TOTP verification in the last 2 minutes (the token's amr
--      claim), and fewer than 10 failed attempts on that factor in 15 minutes. Only then is the session marked verified
--      (and fresh). The same call after a new code is the 15-minute step-up.
--   3. A factor becomes "registered" only through admin_register_totp(), which needs the emailed-code proof from this
--      same session. Someone who knows only the password can enrol their own authenticator through the Auth API, but
--      it is not registered, so it grants nothing.
--
-- Supabase Auth does not limit wrong TOTP codes, so the lock above (counting auth.mfa_challenges that were never
-- verified) is what stops guessing through the API. Existing verified sessions are removed: everyone signs in again.

create table public.admin_totp_factors (
  factor_id uuid primary key references auth.mfa_factors (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  registered_at timestamptz not null default now()
);
create unique index admin_totp_factors_user_idx on public.admin_totp_factors (user_id);
alter table public.admin_totp_factors enable row level security;
comment on table public.admin_totp_factors is 'The one authenticator-app factor registered for each admin account (0052). No app role can read or write it.';

create table public.admin_enroll_proofs (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  proven_at timestamptz not null default now()
);
alter table public.admin_enroll_proofs enable row level security;
comment on table public.admin_enroll_proofs is 'A session that typed the emailed code, which allows registering a new authenticator for 15 minutes (0052). No app role can read or write it.';

-- The emailed code no longer makes a session an admin session: it only proves the mailbox for registering an authenticator.
create or replace function public.admin_verify_code(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid := nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
  v_c public.admin_factor_challenges;
begin
  if v_uid is null or v_session is null or not private.is_admin_account() then
    raise exception 'not available' using errcode = '42501';
  end if;
  select * into v_c from public.admin_factor_challenges
  where session_id = v_session and user_id = v_uid and not consumed
  order by created_at desc limit 1
  for update;
  if not found then return 'none'; end if;
  if v_c.expires_at < now() then
    update public.admin_factor_challenges set consumed = true where id = v_c.id;
    return 'expired';
  end if;
  if v_c.tries >= 5 then return 'locked'; end if;
  if (select coalesce(sum(tries), 0) from public.admin_factor_challenges
       where user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    return 'locked';
  end if;

  if p_code is not null
     and v_c.code_hash = encode(extensions.digest(convert_to(p_code || v_c.id::text, 'utf8'), 'sha256'), 'hex') then
    update public.admin_factor_challenges set consumed = true where id = v_c.id;
    insert into public.admin_enroll_proofs (session_id, user_id) values (v_session, v_uid)
    on conflict (session_id) do update set proven_at = now();
    insert into public.audit_log (actor_id, action, table_name, record_id)
    values (v_uid, 'admin_mailbox_proved', 'admin_enroll_proofs', v_session::text);
    return 'ok';
  end if;

  update public.admin_factor_challenges set tries = tries + 1 where id = v_c.id;
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (v_uid, 'admin_code_wrong', 'admin_factor_challenges', v_c.id::text); -- never the guess itself
  if v_c.tries + 1 >= 5 then
    insert into public.audit_log (actor_id, action, table_name, record_id)
    values (v_uid, 'admin_code_locked', 'admin_factor_challenges', v_c.id::text);
    return 'locked';
  end if;
  return 'wrong';
end;
$$;

-- True when this session typed the emailed code in the last 15 minutes.
create function public.admin_enroll_proof_status()
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin_account() then
    raise exception 'not available' using errcode = '42501';
  end if;
  return exists (
    select 1 from public.admin_enroll_proofs p
    where p.session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
      and p.user_id = auth.uid()
      and p.proven_at > now() - interval '15 minutes'
  );
end;
$$;

-- 'enrolled' when this account has a registered, verified authenticator; otherwise 'none'.
create function public.admin_totp_status()
returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin_account() then
    raise exception 'not available' using errcode = '42501';
  end if;
  return case when exists (
    select 1 from public.admin_totp_factors f
    join auth.mfa_factors m on m.id = f.factor_id and m.status = 'verified' and m.factor_type = 'totp'
    where f.user_id = auth.uid()
  ) then 'enrolled' else 'none' end;
end;
$$;

-- The id of this account's registered authenticator (the portal needs it to ask for a code), or null.
create function public.admin_totp_factor()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin_account() then
    raise exception 'not available' using errcode = '42501';
  end if;
  return (
    select f.factor_id from public.admin_totp_factors f
    join auth.mfa_factors m on m.id = f.factor_id and m.status = 'verified' and m.factor_type = 'totp'
    where f.user_id = auth.uid()
  );
end;
$$;

-- Registers the authenticator this session has just verified. Needs the emailed-code proof from this session.
-- Returns 'ok', 'proof' (type the emailed code first) or 'invalid'. A new registration replaces the old one and ends
-- the verification of every other session of the account.
create function public.admin_register_totp(p_factor uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid := nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
begin
  if v_uid is null or v_session is null or not private.is_admin_account() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.admin_enroll_proofs p
    where p.session_id = v_session and p.user_id = v_uid and p.proven_at > now() - interval '15 minutes'
  ) then
    return 'proof';
  end if;
  if p_factor is null
     or not exists (select 1 from auth.mfa_factors m where m.id = p_factor and m.user_id = v_uid and m.factor_type = 'totp' and m.status = 'verified')
     or coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2'
     or not exists (select 1 from auth.sessions s where s.id = v_session and s.user_id = v_uid and s.aal = 'aal2' and s.factor_id = p_factor) then
    return 'invalid';
  end if;
  delete from public.admin_totp_factors where user_id = v_uid;
  insert into public.admin_totp_factors (factor_id, user_id) values (p_factor, v_uid);
  delete from public.admin_enroll_proofs where session_id = v_session;
  delete from public.admin_verified_sessions where user_id = v_uid and session_id <> v_session;
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (v_uid, 'admin_totp_registered', 'admin_totp_factors', p_factor::text);
  return 'ok';
end;
$$;

-- Removes every authenticator of this account (registered or not) so a new one can be set up. Needs the emailed-code
-- proof from this session. This is also what makes recovery safe: once ANY verified authenticator exists, Supabase Auth
-- refuses to add another at password level, so someone who knows only the password could enrol one first and block the
-- real admin. After the mailbox proof the real admin wipes it and starts again. Every verified session of the account
-- ends, and the wrong-attempt counter starts from zero.
create function public.admin_reset_totp()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid := nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
begin
  if v_uid is null or v_session is null or not private.is_admin_account() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.admin_enroll_proofs p
    where p.session_id = v_session and p.user_id = v_uid and p.proven_at > now() - interval '15 minutes'
  ) then
    raise exception 'confirm your email first' using errcode = 'P0001';
  end if;
  delete from public.admin_totp_factors where user_id = v_uid;
  delete from auth.mfa_factors where user_id = v_uid;
  delete from public.admin_verified_sessions where user_id = v_uid;
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (v_uid, 'admin_totp_reset', 'admin_totp_factors', v_uid::text);
end;
$$;

-- Marks this session as a verified admin session (and fresh for 15 minutes) after a good authenticator code.
-- Returns 'ok', 'locked' (too many wrong codes lately) or 'not_ready' (no registered authenticator, the session is not
-- aal2 with it, or the last code was typed more than 2 minutes ago).
create function public.admin_mark_session_verified()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid := nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
  v_factor uuid;
  v_ts bigint;
  v_was boolean;
begin
  if v_uid is null or v_session is null or not private.is_admin_account() then
    raise exception 'not available' using errcode = '42501';
  end if;
  select f.factor_id into v_factor
  from public.admin_totp_factors f
  join auth.mfa_factors m on m.id = f.factor_id and m.status = 'verified' and m.factor_type = 'totp'
  where f.user_id = v_uid;
  if v_factor is null then return 'not_ready'; end if;

  -- Supabase Auth does not limit wrong codes: ten never-verified attempts in 15 minutes lock this factor.
  if (select count(*) from auth.mfa_challenges c
       where c.factor_id = v_factor and c.verified_at is null and c.created_at > now() - interval '15 minutes') >= 10 then
    return 'locked';
  end if;

  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2'
     or not exists (select 1 from auth.sessions s where s.id = v_session and s.user_id = v_uid and s.aal = 'aal2' and s.factor_id = v_factor) then
    return 'not_ready';
  end if;
  select max((a ->> 'timestamp')::bigint) into v_ts
  from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) a
  where a ->> 'method' = 'totp';
  if v_ts is null or v_ts < extract(epoch from now() - interval '2 minutes') then
    return 'not_ready';
  end if;

  select exists (select 1 from public.admin_verified_sessions where session_id = v_session) into v_was;
  insert into public.admin_verified_sessions (session_id, user_id) values (v_session, v_uid)
  on conflict (session_id) do update set verified_at = now(), fresh_at = now();
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (v_uid, case when v_was then 'admin_step_up' else 'admin_signed_in' end, 'admin_verified_sessions', v_session::text);
  return 'ok';
end;
$$;

revoke all on function public.admin_enroll_proof_status() from public, anon;
revoke all on function public.admin_totp_status() from public, anon;
revoke all on function public.admin_totp_factor() from public, anon;
revoke all on function public.admin_register_totp(uuid) from public, anon;
revoke all on function public.admin_reset_totp() from public, anon;
revoke all on function public.admin_mark_session_verified() from public, anon;
grant execute on function public.admin_enroll_proof_status() to authenticated;
grant execute on function public.admin_totp_status() to authenticated;
grant execute on function public.admin_totp_factor() to authenticated;
grant execute on function public.admin_register_totp(uuid) to authenticated;
grant execute on function public.admin_reset_totp() to authenticated;
grant execute on function public.admin_mark_session_verified() to authenticated;

-- Everyone signs in again with the authenticator.
delete from public.admin_verified_sessions;
