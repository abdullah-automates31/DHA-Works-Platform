-- Admin sessions: a verified admin session no longer runs out after 4 hours (user decision, 14 Nov 2026).
-- Staff type the authenticator-app code once per sign-in (0052); the session then lasts until they sign out (or Supabase ends it).
-- Everything else in is_admin() is unchanged: the account must be an active admin and the session must have been
-- verified. The 15-minute code check before destructive actions (private.admin_fresh) is unchanged.

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_admin_account()
     and exists (
       select 1 from public.admin_verified_sessions v
       where v.session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
         and v.user_id = (select auth.uid())
     );
$$;
