-- 0060: the emailed code is asked only at sign-in (owner decision, 18 Nov 2026).
--
-- Since 0048 a verified admin session also needed a code typed in the last 15 minutes ("fresh") before sensitive
-- actions (invite or remove staff, suspend, approve or reject, cancel or replace on a job, settings, categories, phases,
-- reports, reviews, messages). Staff found typing a new code for each of these too slow, so the owner chose to ask for
-- the code once, at sign-in.
--
-- private.admin_fresh() now returns true for any verified admin session of the caller (the same test as is_admin()'s
-- session part). Every sensitive function keeps its call to admin_fresh(), so the old behaviour can come back by
-- restoring the 0048 body. admin_step_up_status() therefore reports 'fresh' for every verified session, and the portal
-- never sends staff to /confirm. Weaker: a stolen, already verified session can now do these actions without the
-- staff member's mailbox. Recorded in docs/DECISIONS.md and docs/SECURITY.md (section 18).

create or replace function private.admin_fresh(p_minutes integer default 15)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admin_verified_sessions v
    where v.session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
      and v.user_id = (select auth.uid())
  );
$$;
revoke all on function private.admin_fresh(integer) from public, anon, authenticated;
