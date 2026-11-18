-- 0061: a verified admin session lasts 7 days, and the unused authenticator-app functions are closed (audit, 18 Nov 2026).
--
-- Audit finding: since 0051 a verified admin session never ran out, and since 0060 no new code is asked before sensitive
-- actions. A stolen portal cookie was therefore full admin access until the staff member signed out.
--
--   * public.is_admin(): the session's emailed-code verification must be younger than 7 days. After that every admin
--     function refuses ('not available') and the portal sends the person to the code page; a new emailed code
--     (admin_verify_code) renews the 7 days for the same session. An attacker holding only the cookie cannot renew it
--     without the staff member's mailbox.
--   * private.admin_fresh(): the same 7-day window (it is only reached after is_admin() anyway).
--   * The six authenticator-app (TOTP) functions from 0052 are no longer callable by app roles. The portal stopped
--     using them in 0055; leaving them open let any signed-in account call them. Owner can reopen them by granting again.

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_admin_account()
     and exists (
       select 1 from public.admin_verified_sessions v
       where v.session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
         and v.user_id = (select auth.uid())
         and v.verified_at > now() - interval '7 days'
     );
$$;

create or replace function private.admin_fresh(p_minutes integer default 15)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admin_verified_sessions v
    where v.session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
      and v.user_id = (select auth.uid())
      and v.verified_at > now() - interval '7 days'
  );
$$;
revoke all on function private.admin_fresh(integer) from public, anon, authenticated;

revoke execute on function public.admin_enroll_proof_status() from authenticated;
revoke execute on function public.admin_totp_status() from authenticated;
revoke execute on function public.admin_totp_factor() from authenticated;
revoke execute on function public.admin_register_totp(uuid) from authenticated;
revoke execute on function public.admin_reset_totp() from authenticated;
revoke execute on function public.admin_mark_session_verified() from authenticated;
