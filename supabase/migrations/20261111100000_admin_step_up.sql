-- 0048: step-up code before sensitive admin actions (docs/SECURITY.md section 18).
--
-- A verified admin session lasts 4 hours (0046). Destructive actions now also need a code typed in the last 15 minutes
-- ("fresh"): invite or remove staff, suspend or reactivate, cancel or replace on a job, settings, categories, phases.
-- A stolen but verified session therefore cannot do these without the staff member's mailbox as well.
--
--   * admin_verified_sessions.fresh_at: set every time a code is verified (first sign-in and every step-up).
--   * private.admin_fresh(minutes): true when the caller's own session was confirmed within the window.
--   * admin_issue_challenge: a code may now also be requested by an already verified session (same limits: 1 a minute,
--     5 an hour); the old "session already verified" refusal is gone.
--   * admin_verify_code: on success the session is marked fresh (and verified, as before).
--   * admin_step_up_status(): 'fresh' or 'needs_code' for the portal's confirm page.
--   * The sensitive functions below are re-created unchanged except for one added check after is_admin():
--     raise 'confirm with a new code' (P0001) when the session is not fresh. Grants stay as they were.

alter table public.admin_verified_sessions add column fresh_at timestamptz not null default now();

create function private.admin_fresh(p_minutes integer default 15)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admin_verified_sessions v
    where v.session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
      and v.user_id = (select auth.uid())
      and v.fresh_at > now() - make_interval(mins => p_minutes)
  );
$$;
revoke all on function private.admin_fresh(integer) from public, anon, authenticated;

create function public.admin_step_up_status()
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when not public.is_admin() then 'not_admin'
    when private.admin_fresh() then 'fresh'
    else 'needs_code'
  end;
$$;
revoke all on function public.admin_step_up_status() from public, anon;
grant execute on function public.admin_step_up_status() to authenticated;

-- A verified session may ask for a new code (step-up). Body as in 0037, minus the "already verified" refusal.
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

-- Body as in 0046, plus: success also marks the session fresh, renews a verification whose 4 hours are over, and an
-- already verified session is audited as a step-up.
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
      select 1 from public.admin_verified_sessions
      where session_id = v_session and verified_at > now() - interval '4 hours'
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

-- The sensitive functions, each exactly as it is today plus the freshness check after is_admin().
CREATE OR REPLACE FUNCTION public.invite_staff(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_id uuid := gen_random_uuid();
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'enter a valid email address';
  end if;
  if exists (select 1 from public.profiles where lower(email) = v_email and role = 'admin') then
    raise exception 'that person is already an admin';
  end if;
  update public.staff_invites set status = 'revoked' where lower(email) = v_email and status = 'pending';
  insert into public.staff_invites (id, email, invited_by, token_hash)
  values (v_id, v_email, v_uid, encode(extensions.digest(convert_to(v_token, 'utf8'), 'sha256'), 'hex'));
  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (v_uid, 'staff_invited', 'staff_invites', v_id::text, jsonb_build_object('email', v_email));
  return v_token; -- shown once to the inviter; only its hash is stored
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_staff_invite(p_invite uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  update public.staff_invites set status = 'revoked' where id = p_invite and status = 'pending';
  if not found then raise exception 'no pending invite'; end if;
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (auth.uid(), 'staff_invite_revoked', 'staff_invites', p_invite::text);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_remove_staff(p_profile uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if p_profile = v_uid then
    raise exception 'you cannot remove your own account';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'write a reason (3 to 500 characters)';
  end if;
  select * into v_p from public.profiles where id = p_profile and role = 'admin' for update;
  if not found then
    raise exception 'no such admin';
  end if;
  if v_p.account_status <> 'active' then
    raise exception 'this admin is already removed';
  end if;
  if (select count(*) from public.profiles where role = 'admin' and account_status = 'active' and id <> p_profile) = 0 then
    raise exception 'the last active admin cannot be removed';
  end if;
  update public.profiles set account_status = 'suspended', suspended_at = now(), suspension_reason = v_reason where id = p_profile;
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (v_uid, 'staff_removed', 'profiles', p_profile::text, jsonb_build_object('account_status', 'active'),
          jsonb_build_object('account_status', 'suspended'), v_reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_account_status(p_profile uuid, p_suspend boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_job uuid;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if p_profile = v_uid then
    raise exception 'you cannot change your own account';
  end if;
  select * into v_p from public.profiles where id = p_profile for update;
  if not found or v_p.role not in ('worker', 'resident') then
    raise exception 'no such user';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'write a reason (3 to 500 characters)';
  end if;

  if p_suspend then
    if v_p.account_status = 'suspended' then
      raise exception 'this account is already suspended';
    end if;
    update public.profiles
       set account_status = 'suspended', suspended_at = now(), suspension_reason = v_reason
     where id = p_profile;
    if v_p.role = 'worker' then
      for v_job in
        select j.id from public.jobs j
         where j.status in ('scheduled', 'in_progress')
           and exists (select 1 from public.quotes q where q.job_id = j.id and q.worker_id = p_profile and q.status = 'accepted')
           and j.under_review_reason is null
         for update
      loop
        update public.jobs set under_review_reason = 'worker_suspended' where id = v_job;
        perform private.record(v_job, 'under_review', v_uid, jsonb_build_object('reason', 'worker_suspended'));
      end loop;
    end if;
  else
    if v_p.account_status <> 'suspended' then
      raise exception 'this account is not suspended';
    end if;
    update public.profiles
       set account_status = 'active', suspended_at = null, suspended_until = null, suspension_reason = null
     where id = p_profile;
    perform private.notify(p_profile, 'account_reactivated', null, '{}'::jsonb);
  end if;

  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (v_uid, case when p_suspend then 'account_suspended' else 'account_reactivated' end, 'profiles', p_profile::text,
          jsonb_build_object('account_status', v_p.account_status),
          jsonb_build_object('account_status', case when p_suspend then 'suspended' else 'active' end), v_reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_cancel_job(p_job uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'write a reason (3 to 500 characters)';
  end if;
  perform private.cancel_job(p_job, auth.uid(), v_reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_decide_cancellation(p_request uuid, p_approve boolean, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_x public.cancellation_requests;
  v_job public.jobs;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if p_approve is null then
    raise exception 'choose approve or decline';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'the note is too long (500 characters at most)';
  end if;
  select * into v_x from public.cancellation_requests where id = p_request for update;
  if not found or v_x.status <> 'pending' then
    raise exception 'this request is not waiting for a decision';
  end if;
  select * into v_job from public.jobs where id = v_x.job_id;

  if p_approve then
    perform private.cancel_job(v_x.job_id, v_uid,
      coalesce(v_note, format('Cancellation requested by the %s (%s)', v_x.requester_role, replace(v_x.reason_code::text, '_', ' '))));
    update public.cancellation_requests set decision_note = v_note where id = p_request and v_note is not null;
  else
    if v_note is null or char_length(v_note) < 3 then
      raise exception 'write a note the requester will see (3 to 500 characters)';
    end if;
    update public.cancellation_requests
       set status = 'declined', decided_by = v_uid, decided_at = now(), decision_note = v_note
     where id = p_request;
    insert into public.job_events (job_id, event_type, actor_id) values (v_x.job_id, 'cancellation_declined', v_uid);
    insert into public.audit_log (actor_id, action, table_name, record_id, reason)
    values (v_uid, 'cancellation_declined', 'cancellation_requests', p_request::text, v_note);
    perform private.notify(v_x.requester_id, 'cancellation_declined', v_x.job_id,
                           jsonb_build_object('title', v_job.title, 'message', v_note));
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_job_replace_worker(p_job uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs;
  v_worker uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'write a reason (3 to 500 characters)';
  end if;
  select * into v_job from public.jobs where id = p_job for update;
  if not found then
    raise exception 'no such job';
  end if;
  if v_job.status <> 'scheduled' then
    raise exception 'the worker can only be replaced before the work starts';
  end if;
  if exists (select 1 from public.cancellation_requests where job_id = p_job and status = 'pending') then
    raise exception 'decide the cancellation request first';
  end if;
  v_worker := v_job.accepted_worker_id;
  update public.quotes set status = 'rejected', reject_reason = v_reason, decided_at = now() where id = v_job.accepted_quote_id;
  update public.jobs
     set status = 'open', accepted_quote_id = null, accepted_worker_id = null, scheduled_start = null, scheduled_end = null,
         under_review_reason = null, stuck_since = null, stuck_reason = null
   where id = p_job;
  update public.job_interests set withdrawn_at = now() where job_id = p_job and worker_id = v_worker and withdrawn_at is null;
  perform private.recompute_job_stage(p_job);
  perform private.notify_matching_workers(p_job);
  if v_worker is not null then
    perform private.notify(v_worker, 'quote_rejected', p_job, jsonb_build_object('title', v_job.title));
  end if;
  perform private.notify(v_job.resident_id, 'worker_replaced_by_staff', p_job, jsonb_build_object('title', v_job.title));
  insert into public.job_events (job_id, event_type, actor_id, resident_only) values (p_job, 'worker_replaced_by_staff', v_uid, true);
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, reason)
  values (v_uid, 'job_worker_replaced_by_staff', 'jobs', p_job::text, jsonb_build_object('worker', v_worker), v_reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_save_settings(p_helpline_number text, p_helpline_enabled boolean, p_report_window_days integer, p_review_window_days integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_number text := btrim(coalesce(p_helpline_number, ''));
  v_old jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if v_number <> '' and v_number !~ '^[0-9+ -]{3,20}$' then
    raise exception 'the helpline number can only have digits, spaces, + and - (3 to 20 characters)';
  end if;
  if p_helpline_enabled is null then
    raise exception 'choose whether to show the helpline';
  end if;
  if p_helpline_enabled and v_number = '' then
    raise exception 'enter the helpline number before showing it in the apps';
  end if;
  if p_report_window_days is null or p_report_window_days not between 1 and 30 then
    raise exception 'the report window must be 1 to 30 days';
  end if;
  if p_review_window_days is null or p_review_window_days not between 1 and 30 then
    raise exception 'the review window must be 1 to 30 days';
  end if;

  v_old := public.admin_settings_get() - 'categories' - 'phases';
  update public.app_settings set value = to_jsonb(v_number), updated_by = v_uid where key = 'helpline_number';
  update public.app_settings set value = to_jsonb(p_helpline_enabled), updated_by = v_uid where key = 'helpline_enabled';
  update public.app_settings set value = to_jsonb(p_report_window_days), updated_by = v_uid where key = 'report_window_days';
  update public.app_settings set value = to_jsonb(p_review_window_days), updated_by = v_uid where key = 'review_window_days';
  insert into public.audit_log (actor_id, action, table_name, old_data, new_data)
  values (v_uid, 'settings_saved', 'app_settings', v_old,
          jsonb_build_object('helpline_number', v_number, 'helpline_enabled', p_helpline_enabled,
                             'report_window_days', p_report_window_days, 'review_window_days', p_review_window_days));
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_category(p_name text, p_subtitle text)
 RETURNS smallint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_sub text := nullif(btrim(coalesce(p_subtitle, '')), '');
  v_slug text;
  v_id smallint;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if char_length(v_name) not between 2 and 40 then
    raise exception 'the category name must be 2 to 40 characters';
  end if;
  if v_sub is not null and char_length(v_sub) > 80 then
    raise exception 'the description is too long (80 characters at most)';
  end if;
  v_slug := btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-');
  if v_slug = '' then
    raise exception 'the category name needs letters or numbers';
  end if;
  if exists (select 1 from public.categories where slug = v_slug or lower(name) = lower(v_name)) then
    raise exception 'a category with that name already exists';
  end if;
  if (select count(*) from public.categories) >= 30 then
    raise exception 'there are already 30 categories';
  end if;
  insert into public.categories (slug, name, subtitle, sort)
  values (v_slug, v_name, v_sub, coalesce((select max(sort) from public.categories), 0) + 1)
  returning id into v_id;
  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'category_added', 'categories', v_id::text, jsonb_build_object('name', v_name));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_category(p_id smallint, p_name text, p_subtitle text, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_c public.categories;
  v_name text := btrim(coalesce(p_name, ''));
  v_sub text := nullif(btrim(coalesce(p_subtitle, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  select * into v_c from public.categories where id = p_id for update;
  if not found then
    raise exception 'no such category';
  end if;
  if char_length(v_name) not between 2 and 40 then
    raise exception 'the category name must be 2 to 40 characters';
  end if;
  if v_sub is not null and char_length(v_sub) > 80 then
    raise exception 'the description is too long (80 characters at most)';
  end if;
  if p_active is null then
    raise exception 'choose on or off';
  end if;
  if exists (select 1 from public.categories where id <> p_id and lower(name) = lower(v_name)) then
    raise exception 'a category with that name already exists';
  end if;
  if not p_active and v_c.active and (select count(*) from public.categories where active and id <> p_id) = 0 then
    raise exception 'at least one category must stay on';
  end if;
  update public.categories set name = v_name, subtitle = v_sub, active = p_active where id = p_id;
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), 'category_updated', 'categories', p_id::text,
          jsonb_build_object('name', v_c.name, 'subtitle', v_c.subtitle, 'active', v_c.active),
          jsonb_build_object('name', v_name, 'subtitle', v_sub, 'active', p_active));
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_phase_active(p_phase smallint, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old boolean;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if p_active is null then
    raise exception 'choose on or off';
  end if;
  select active into v_old from public.service_areas where phase = p_phase for update;
  if not found then
    raise exception 'no such phase';
  end if;
  if not p_active and v_old and (select count(*) from public.service_areas where active and phase <> p_phase) = 0 then
    raise exception 'at least one phase must stay on';
  end if;
  update public.service_areas set active = p_active where phase = p_phase;
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), 'phase_updated', 'service_areas', p_phase::text, jsonb_build_object('active', v_old), jsonb_build_object('active', p_active));
end;
$function$;
