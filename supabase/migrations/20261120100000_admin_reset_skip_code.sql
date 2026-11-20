-- Migration 0069: after a password reset, the first password sign-in does not ask for the emailed sign-in code again
-- (owner request, 20 Nov 2026: "after resetting my password and I log in again with my new password it is asking for
-- the code again, this should not happen").
--
-- Why this is safe enough: completing a reset already proved the mailbox (the person typed the emailed reset code), and
-- they chose the new password a moment ago. So admin_reset_confirm leaves ONE marker for that account, valid 10 minutes.
-- admin_verify_after_reset() lets the next session verify itself with it, only if
--   * the caller is that active admin and the session started with the PASSWORD (auth.mfa_amr_claims, as in 0068),
--   * the marker exists and has not expired,
--   * the session is not verified yet.
-- The marker is used up on the first success, and it is deleted when a new reset starts. It is audited
-- ('admin_signed_in_after_reset'). Anyone who knows the new password within those 10 minutes would also skip the code:
-- that is the accepted tradeoff, kept small by the short window and the single use.

create table public.admin_reset_signins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.admin_reset_signins enable row level security;
-- No policy and no grant: only the security-definer functions touch this table.

-- admin_reset_confirm: body as in 0068, plus the marker after a successful reset -----------------------------------
create or replace function public.admin_reset_confirm(p_email text, p_code text, p_password text)
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
    delete from auth.sessions where user_id = v_uid;
    update public.admin_factor_challenges set consumed = true where user_id = v_uid and not consumed;
    update public.admin_reset_challenges set consumed = true where user_id = v_uid and not consumed;
    -- The mailbox was just proved: the next password sign-in (within 10 minutes) does not need the sign-in code.
    insert into public.admin_reset_signins (user_id, expires_at) values (v_uid, now() + interval '10 minutes')
    on conflict (user_id) do update set created_at = now(), expires_at = excluded.expires_at;
    insert into public.audit_log (actor_id, action, table_name, record_id)
    values (v_uid, 'admin_password_reset', 'admin_reset_challenges', v_c.id::text);
    return 'ok';
  end if;

  update public.admin_reset_challenges set tries = tries + 1 where id = v_c.id;
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (v_uid, 'admin_reset_code_wrong', 'admin_reset_challenges', v_c.id::text);
  if v_c.tries + 1 >= 5 then
    insert into public.audit_log (actor_id, action, table_name, record_id)
    values (v_uid, 'admin_reset_locked', 'admin_reset_challenges', v_c.id::text);
    return 'locked';
  end if;
  return 'wrong';
end;
$$;

-- A new reset request clears an old marker (admin_reset_issue: body as in 0068, plus the delete) ---------------------
create or replace function public.admin_reset_issue(p_email text)
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

  perform pg_advisory_xact_lock(hashtextextended('admin_reset_issue:' || v_uid::text, 0));
  if exists (select 1 from public.admin_reset_challenges where user_id = v_uid and created_at > now() - interval '1 minute') then
    return jsonb_build_object('status', 'wait');
  end if;
  if (select count(*) from public.admin_reset_challenges where user_id = v_uid and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('status', 'limit');
  end if;

  update public.admin_reset_challenges set consumed = true where user_id = v_uid and not consumed;
  delete from public.admin_reset_signins where user_id = v_uid;
  v_code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into public.admin_reset_challenges (id, user_id, code_hash)
  values (v_id, v_uid, encode(extensions.digest(convert_to(v_code || v_id::text, 'utf8'), 'sha256'), 'hex'));
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (v_uid, 'admin_reset_requested', 'admin_reset_challenges', v_id::text);
  return jsonb_build_object('status', 'sent', 'code', v_code, 'email', v_mail);
end;
$$;

-- Use the marker (a signed-in admin, called by the portal right after the password sign-in) ------------------------
-- Returns 'ok' (the session is now verified and fresh) or 'none' (the normal emailed code is needed).
create function public.admin_verify_after_reset()
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
  if not exists (select 1 from auth.sessions where id = v_session and user_id = v_uid)
     or not exists (select 1 from auth.mfa_amr_claims where session_id = v_session and authentication_method = 'password')
     or exists (select 1 from public.admin_verified_sessions where session_id = v_session) then
    return 'none';
  end if;
  -- One use: the marker is deleted in the same statement that checks it.
  delete from public.admin_reset_signins where user_id = v_uid and expires_at > now();
  if not found then return 'none'; end if;

  insert into public.admin_verified_sessions (session_id, user_id) values (v_session, v_uid)
  on conflict (session_id) do update set verified_at = now(), fresh_at = now();
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (v_uid, 'admin_signed_in_after_reset', 'admin_verified_sessions', v_session::text);
  return 'ok';
end;
$$;

revoke all on function public.admin_reset_issue(text) from public, anon, authenticated;
revoke all on function public.admin_reset_confirm(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_reset_issue(text) to service_role;
grant execute on function public.admin_reset_confirm(text, text, text) to service_role;
revoke all on function public.admin_verify_after_reset() from public, anon;
grant execute on function public.admin_verify_after_reset() to authenticated;
