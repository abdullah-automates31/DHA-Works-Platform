-- 0053: report tracking and suspension notices (14 Nov 2026).
--
-- A report can now be followed by the person who filed it, and DHA staff notices reach the people involved.
--
--  1. Reporter notices, written by triggers so every path (decide, log a call, a future one) behaves the same and each
--     step is announced once: report_received (filed), report_in_review (staff first open it), report_resolved with a
--     generic outcome 'action_taken' (warning or suspension) or 'no_action'. No names, no punishment, no staff reason.
--  2. Account notices, also by trigger, so they exist in the same transaction as the status change (before access is
--     blocked): account_suspended (reason and end date when there is one) and account_reactivated (expired = true when it
--     ended by itself).
--  3. Suspensions can last a number of days: admin_set_account_status gets an optional p_days; a sweep every 10 minutes
--     lifts the expired ones. The old 3-argument function is dropped (a default argument keeps existing callers working).
--  4. my_reports(): the signed-in worker or resident reads their own reports with a plain status and last update.
--  5. Privacy: the reporter could read the staff's private action, reason, assignee and the other person's id straight
--     from the table. Those columns are no longer readable by app users (no app reads them; the admin portal uses RPCs).
--  6. private.notify no longer drops a staff warning that is tied to a job the worker's quote was rejected on.

-- 1. reports.updated_at --------------------------------------------------------------------------------------------
alter table public.reports add column updated_at timestamptz not null default now();
update public.reports set updated_at = coalesce(resolved_at, created_at);

create function private.touch_report() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger reports_touch before update on public.reports for each row execute function private.touch_report();

-- 2. Privacy: app users read only the columns that are theirs ---------------------------------------------------------
revoke select on public.reports from authenticated;
grant select (id, code, job_id, kind, status, created_at, updated_at, resolved_at, reporter_id, reporter_role, reason_text, system_generated)
  on public.reports to authenticated;

-- 3. A staff warning is never dropped, even for a job the worker's quote was rejected on ---------------------------------
create or replace function private.notify(p_user uuid, p_type text, p_job uuid, p_payload jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.notifications (user_id, type, job_id, payload)
  select p_user, p_type, p_job, p_payload
  where p_job is null
     or p_type in ('quote_rejected', 'quote_not_selected', 'report_warning')
     or not exists (select 1 from public.quotes q
                    where q.job_id = p_job and q.worker_id = p_user and q.status = 'rejected');
$$;

-- 4. Reporter notices ---------------------------------------------------------------------------------------------------
create function private.report_notices() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_type text;
  v_payload jsonb := jsonb_build_object('code', new.code);
begin
  if new.system_generated then
    return null; -- system reports (for example a cash mismatch) have no human reporter to answer
  end if;
  if tg_op = 'INSERT' then
    v_type := 'report_received';
  elsif new.status = 'in_review' then
    v_type := 'report_in_review';
  elsif new.status = 'resolved' then
    v_type := 'report_resolved';
    v_payload := v_payload || jsonb_build_object('outcome', case when new.action in ('warning', 'suspend') then 'action_taken' else 'no_action' end);
  else
    return null;
  end if;
  -- Once per step: a repeat of the same step (for example "keep open" pressed twice) adds nothing.
  if not exists (select 1 from public.notifications n
                  where n.user_id = new.reporter_id and n.type = v_type and n.payload ->> 'code' = new.code) then
    perform private.notify(new.reporter_id, v_type, null, v_payload);
  end if;
  return null;
end;
$$;
create trigger reports_notices_insert after insert on public.reports
  for each row execute function private.report_notices();
create trigger reports_notices_status after update of status on public.reports
  for each row when (old.status is distinct from new.status) execute function private.report_notices();

-- 5. Account notices ----------------------------------------------------------------------------------------------------
create function private.account_notices() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.account_status = 'suspended' and old.account_status is distinct from 'suspended' then
    perform private.notify(new.id, 'account_suspended', null,
      jsonb_build_object('message', new.suspension_reason, 'until', new.suspended_until));
  elsif old.account_status = 'suspended' and new.account_status = 'active' then
    perform private.notify(new.id, 'account_reactivated', null,
      jsonb_build_object('expired', coalesce(old.suspended_until <= now(), false)));
  end if;
  return null;
end;
$$;
create trigger profiles_account_notices after update of account_status on public.profiles
  for each row when (old.account_status is distinct from new.account_status)
  execute function private.account_notices();

-- 6. Suspensions with an end date -----------------------------------------------------------------------------------------
drop function public.admin_set_account_status(uuid, boolean, text);
-- (was in 20261111100000_admin_step_up.sql)
create function public.admin_set_account_status(p_profile uuid, p_suspend boolean, p_reason text, p_days integer default null)
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
  if p_days is not null and (not p_suspend or p_days < 1 or p_days > 365) then
    raise exception 'a suspension lasts 1 to 365 days (leave it empty to suspend until staff lift it)';
  end if;

  if p_suspend then
    if v_p.account_status = 'suspended' then
      raise exception 'this account is already suspended';
    end if;
    update public.profiles
       set account_status = 'suspended', suspended_at = now(), suspension_reason = v_reason,
           suspended_until = case when p_days is null then null else now() + make_interval(days => p_days) end
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
  end if;

  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (v_uid, case when p_suspend then 'account_suspended' else 'account_reactivated' end, 'profiles', p_profile::text,
          jsonb_build_object('account_status', v_p.account_status),
          jsonb_build_object('account_status', case when p_suspend then 'suspended' else 'active' end, 'days', p_days), v_reason);
end;
$function$;

revoke all on function public.admin_set_account_status(uuid, boolean, text, integer) from public, anon;
grant execute on function public.admin_set_account_status(uuid, boolean, text, integer) to authenticated;

-- Lifts the suspensions whose end date has passed. The account trigger sends the "active again" notice.
create function private.lift_expired_suspensions() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  with lifted as (
    update public.profiles
       set account_status = 'active', suspended_at = null, suspended_until = null, suspension_reason = null
     where account_status = 'suspended' and suspended_until is not null and suspended_until <= now()
    returning id
  ), logged as (
    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    select null, 'account_reactivated', 'profiles', id::text, jsonb_build_object('account_status', 'active', 'reason', 'suspension ended')
    from lifted
    returning 1
  )
  select count(*) into v_n from lifted;
  return v_n;
end;
$$;
revoke all on function private.lift_expired_suspensions() from public, anon, authenticated;
select cron.schedule('dw-lift-suspensions', '*/10 * * * *', 'select private.lift_expired_suspensions()');

-- 7. The user screen shows the end date of a suspension
-- (was in 20261113110000_admin_audit_dedupe_and_search.sql)
create or replace function public.admin_user_detail(p_profile uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.profiles;
  v_out jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  select * into v_p from public.profiles where id = p_profile and role in ('worker', 'resident') and verification_status = 'approved';
  if not found then
    raise exception 'no such user';
  end if;

  v_out := jsonb_build_object(
    'id', v_p.id, 'role', v_p.role, 'full_name', v_p.full_name, 'phone', v_p.phone, 'email', v_p.email,
    'cnic_masked', case when v_p.cnic is null then null else left(v_p.cnic, 5) || '-*******-' || right(v_p.cnic, 1) end,
    'created_at', v_p.created_at, 'avatar_path', v_p.avatar_path,
    'account_status', v_p.account_status, 'suspended_at', v_p.suspended_at, 'suspension_reason', v_p.suspension_reason, 'suspended_until', v_p.suspended_until,
    'verified_at', (select max(decided_at) from public.verification_decisions where profile_id = p_profile and decision = 'approve'),
    'open_reports', (select count(*) from public.reports where against_id = p_profile and status <> 'resolved'),
    'past_suspensions', (select count(*) from public.audit_log where action = 'account_suspended' and record_id = p_profile::text),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('type', d.doc_type, 'path', d.storage_path) order by d.doc_type), '[]'::jsonb)
                    from public.verification_documents d where d.profile_id = p_profile),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'note', n.note, 'created_at', n.created_at,
                                                          'author_name', (select full_name from public.profiles where id = n.author_id))
                                        order by n.created_at desc), '[]'::jsonb)
                from public.staff_notes n where n.profile_id = p_profile));

  if v_p.role = 'worker' then
    v_out := v_out || jsonb_build_object(
      'worker', (select jsonb_build_object('experience_years', w.experience_years, 'about', w.about, 'rating_avg', w.rating_avg,
                                           'rating_count', w.rating_count, 'jobs_done', w.jobs_done)
                   from public.worker_details w where w.profile_id = p_profile),
      'categories', (select coalesce(jsonb_agg(c.name order by c.sort), '[]'::jsonb)
                       from public.worker_categories wc join public.categories c on c.id = wc.category_id where wc.worker_id = p_profile),
      'phases', (select coalesce(jsonb_agg(wa.phase order by wa.phase), '[]'::jsonb) from public.worker_areas wa where wa.worker_id = p_profile),
      'recent_jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'title', x.title, 'status', x.status,
                                                                   'other_name', x.other_name, 'quote_total', x.quote_total)
                                                order by x.updated_at desc), '[]'::jsonb)
                        from (select j.id, j.code, j.title, j.status, j.updated_at, rp.full_name as other_name,
                                     (select q.total from public.quotes q where q.id = j.accepted_quote_id) as quote_total
                                from public.jobs j join public.profiles rp on rp.id = j.resident_id
                               where j.accepted_worker_id = p_profile
                               order by j.updated_at desc limit 5) x));
  else
    v_out := v_out || jsonb_build_object(
      'addresses', (select coalesce(jsonb_agg(jsonb_build_object('label', a.label, 'phase', a.phase, 'lane', a.lane, 'plot_no', a.plot_no, 'floor', a.floor)
                                              order by a.is_default desc, a.created_at), '[]'::jsonb)
                      from public.addresses a where a.resident_id = p_profile),
      'jobs_count', (select count(*) from public.jobs where resident_id = p_profile and status <> 'draft'),
      'recent_jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'title', x.title, 'status', x.status,
                                                                   'other_name', x.other_name, 'quote_total', x.quote_total)
                                                order by x.updated_at desc), '[]'::jsonb)
                        from (select j.id, j.code, j.title, j.status, j.updated_at, wp.full_name as other_name,
                                     (select q.total from public.quotes q where q.id = j.accepted_quote_id) as quote_total
                                from public.jobs j left join public.profiles wp on wp.id = j.accepted_worker_id
                               where j.resident_id = p_profile and j.status <> 'draft'
                               order by j.updated_at desc limit 5) x));
  end if;

  insert into public.audit_log (actor_id, action, table_name, record_id)
    select auth.uid(), 'user_viewed', 'profiles', p_profile::text
     where not exists (select 1 from public.audit_log a
                        where a.table_name = 'profiles' and a.record_id = p_profile::text
                          and a.actor_id = auth.uid() and a.action = 'user_viewed'
                          and a.created_at > now() - interval '10 minutes');
  return v_out;
end;
$$;

-- 7b. A verification decision tells the person WHY. The notice for "ask for changes", "visit HQ" and "reject" now carries
-- the reason staff wrote (payload.reason, 3 to 500 characters, written for the applicant to read); an approval carries
-- none. Until now the notice said only that changes were needed and the apps never showed the reason.
-- (was in 20261113100000_admin_step_up_more.sql)
create or replace function public.admin_decide_verification(
  p_profile uuid,
  p_decision public.verification_decision,
  p_reason text,
  p_checklist jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_status public.verification_status;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if p_profile = v_uid then
    raise exception 'you cannot decide on your own account';
  end if;
  select * into v_p from public.profiles where id = p_profile and role in ('worker', 'resident') for update;
  if not found then
    raise exception 'no such application';
  end if;
  if v_p.verification_status not in ('pending', 'visit_hq') then
    raise exception 'this application is not waiting for a decision';
  end if;
  if v_p.account_status <> 'active' then
    raise exception 'this account is suspended';
  end if;
  if p_checklist is null or jsonb_typeof(p_checklist) <> 'object' then
    raise exception 'the checklist is required';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'the reason is too long (500 characters at most)';
  end if;

  if p_decision = 'approve' then
    if not (select bool_and(value = 'true'::jsonb) from jsonb_each(p_checklist)) or p_checklist = '{}'::jsonb then
      raise exception 'tick every checklist item before approving';
    end if;
    v_status := 'approved';
  else
    if v_reason is null or char_length(v_reason) < 3 then
      raise exception 'write a reason the applicant will see';
    end if;
    v_status := (case p_decision when 'ask_for_changes' then 'needs_changes' when 'visit_hq' then 'visit_hq' else 'rejected' end)::public.verification_status;
  end if;

  insert into public.verification_decisions (profile_id, decision, reason, checklist, decided_by)
  values (p_profile, p_decision, v_reason, p_checklist, v_uid);
  update public.profiles
     set verification_status = v_status, verification_reason = v_reason, verification_updated_at = now()
   where id = p_profile;
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (v_uid, 'verification_' || p_decision::text, 'profiles', p_profile::text,
          jsonb_build_object('status', v_p.verification_status), jsonb_build_object('status', v_status), v_reason);
  perform private.notify(p_profile, 'verification_decided', null,
    case when p_decision = 'approve' then jsonb_build_object('decision', p_decision)
         else jsonb_build_object('decision', p_decision, 'reason', v_reason) end);
end;
$$;

-- 8. My reports ----------------------------------------------------------------------------------------------------------
-- Only the signed-in worker's or resident's own reports, with a plain status. Nothing about the other person, no staff
-- notes and no decision details: 'outcome' says only whether DHA took action.
create function public.my_reports(p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.role in ('worker', 'resident')) then
    raise exception 'not available' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.reports r where r.reporter_id = v_uid and not r.system_generated),
    'rows', coalesce((
      select jsonb_agg(x.row order by x.created_at desc, x.id)
      from (
        select r.id, r.created_at, jsonb_build_object(
          'id', r.id,
          'code', r.code,
          'kind', r.kind,
          'status', case r.status when 'new' then 'submitted' when 'in_review' then 'under_review' else 'resolved' end,
          'outcome', case when r.status = 'resolved' then case when r.action in ('warning', 'suspend') then 'action_taken' else 'no_action' end end,
          'job_title', j.title,
          'job_code', j.code,
          'details', r.reason_text,
          'created_at', r.created_at,
          'updated_at', r.updated_at,
          'resolved_at', r.resolved_at) as row
        from public.reports r
        join public.jobs j on j.id = r.job_id
        where r.reporter_id = v_uid and not r.system_generated
        order by r.created_at desc, r.id
        limit v_limit offset v_offset
      ) x), '[]'::jsonb));
end;
$$;
revoke all on function public.my_reports(integer, integer) from public, anon;
grant execute on function public.my_reports(integer, integer) to authenticated;
