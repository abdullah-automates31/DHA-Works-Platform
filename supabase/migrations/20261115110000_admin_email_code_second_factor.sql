-- Migration 0055: the emailed code is the admin second factor again (owner decision, 15 Nov 2026).
--
-- 0052 moved staff sign-in and the 15-minute step-up to an authenticator app, and left the emailed code with one job
-- (proving the mailbox before registering an authenticator). The owner wants the code to arrive by email, and to be asked
-- for only where it matters: signing in, and the sensitive actions (suspend, delete, approve, settings, staff, and so on).
--
-- This puts back the body of admin_verify_code from 0049: a correct emailed code marks the session verified and fresh
-- (sign-in), and the same call for an already verified session is the step-up (audited as 'admin_step_up').
-- Nothing else changes: the code is six digits, valid 10 minutes, 5 tries, one new code a minute, 5 an hour, and the
-- hourly lock across codes still applies. is_admin() and private.admin_fresh() are untouched.
--
-- The authenticator-app functions from 0052 (admin_mark_session_verified, admin_register_totp, admin_reset_totp) stay in
-- the database with their own strict rules, but the portal no longer calls them.

create or replace function public.admin_verify_code(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid := nullif((select auth.jwt()) ->> 'session_id', '')::uuid;
  v_c public.admin_factor_challenges;
  v_was_verified boolean;
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
    select exists (
      select 1 from public.admin_verified_sessions where session_id = v_session
    ) into v_was_verified;
    insert into public.admin_verified_sessions (session_id, user_id) values (v_session, v_uid)
    on conflict (session_id) do update set verified_at = now(), fresh_at = now();
    insert into public.audit_log (actor_id, action, table_name, record_id)
    values (v_uid, case when v_was_verified then 'admin_step_up' else 'admin_signed_in' end, 'admin_verified_sessions', v_session::text);
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
