-- 0046: admin portal hardening (10 Nov 2026, docs/SECURITY.md section 16).
--
--   * A verified admin session now lasts 4 hours (was 12). After that the admin types a new emailed code.
--   * Wrong-code guesses are counted per ACCOUNT, not only per code: after 10 wrong guesses in an hour the account
--     is locked for the rest of that hour, however many new codes it asks for. (Before: 5 codes x 5 tries = 25 guesses
--     an hour.) Every wrong guess is written to the audit log.
--   * check_staff_invite: the portal checks the invitation BEFORE it creates an account, so a stranger cannot fill
--     the user list with accounts by calling the public invitation page.

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_admin_account()
     and exists (
       select 1 from public.admin_verified_sessions v
       where v.session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
         and v.user_id = (select auth.uid())
         and v.verified_at > now() - interval '4 hours'
     );
$$;

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
  -- Account-wide cap across all codes of the last hour.
  if (select coalesce(sum(tries), 0) from public.admin_factor_challenges
       where user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    return 'locked';
  end if;

  if p_code is not null
     and v_c.code_hash = encode(extensions.digest(convert_to(p_code || v_c.id::text, 'utf8'), 'sha256'), 'hex') then
    update public.admin_factor_challenges set consumed = true where id = v_c.id;
    insert into public.admin_verified_sessions (session_id, user_id) values (v_session, v_uid)
    on conflict (session_id) do update set verified_at = now();
    insert into public.audit_log (actor_id, action, table_name, record_id)
    values (v_uid, 'admin_signed_in', 'admin_verified_sessions', v_session::text);
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

-- True only for a pending, unexpired invitation whose email and one-time token both match. Callable before sign-up.
create function public.check_staff_invite(p_email text, p_token text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_invites
    where lower(email) = lower(btrim(coalesce(p_email, ''))) and status = 'pending' and expires_at > now()
      and token_hash = encode(extensions.digest(convert_to(coalesce(p_token, ''), 'utf8'), 'sha256'), 'hex')
  );
$$;

revoke all on function public.check_staff_invite(text, text) from public;
grant execute on function public.check_staff_invite(text, text) to anon, authenticated;
