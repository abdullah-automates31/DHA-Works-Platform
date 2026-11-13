-- 0049: step-up code for five more sensitive admin actions (docs/SECURITY.md section 18; audit 13 Nov 2026).
--
-- Migration 0048 required a code typed in the last 15 minutes for destructive actions. The audit found five more that
-- a stolen but verified session could still do without the staff member's mailbox:
--   * admin_decide_verification: approve, send to HQ or reject a worker or resident (decides who may work or post jobs)
--   * admin_report_decide: close, warn or suspend after a report (suspend already needed a code through
--     admin_set_account_status; warning and closing a case now do too)
--   * admin_set_review_hidden: hide or show a customer review
--   * admin_job_resume: take a job out of review
--   * admin_send_message: send a message to a user's phone
-- Each function is re-created exactly as it is today plus one check after is_admin(): raise 'confirm with a new code'
-- (P0001) when the session is not fresh. Signatures and grants are unchanged (create or replace keeps them). Notes,
-- call logs and read-only functions deliberately stay as they are.

-- admin_decide_verification (was in 20261107000038_admin_verification.sql)
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
  perform private.notify(p_profile, 'verification_decided', null, jsonb_build_object('decision', p_decision));
end;
$$;

-- admin_set_review_hidden (was in 20261107000042_admin_users_reviews_settings.sql)
create or replace function public.admin_set_review_hidden(p_review uuid, p_hidden boolean, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_r public.reviews;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if p_hidden is null then
    raise exception 'choose hide or show';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'write a reason (3 to 500 characters)';
  end if;
  select * into v_r from public.reviews where id = p_review for update;
  if not found then
    raise exception 'no such review';
  end if;
  if p_hidden and v_r.hidden_at is not null then
    raise exception 'this review is already hidden';
  end if;
  if not p_hidden and v_r.hidden_at is null then
    raise exception 'this review is not hidden';
  end if;
  update public.reviews
     set hidden_at = case when p_hidden then now() end, hidden_by = case when p_hidden then v_uid end,
         hidden_reason = case when p_hidden then v_reason end
   where id = p_review;
  insert into public.audit_log (actor_id, action, table_name, record_id, reason)
  values (v_uid, case when p_hidden then 'review_hidden' else 'review_shown' end, 'reviews', p_review::text, v_reason);
end;
$$;

-- admin_send_message (was in 20261107000042_admin_users_reviews_settings.sql)
create or replace function public.admin_send_message(p_profile uuid, p_text text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if v_text is null or char_length(v_text) < 3 or char_length(v_text) > 300 then
    raise exception 'write a message (3 to 300 characters)';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile and role in ('worker', 'resident') and account_status = 'active') then
    raise exception 'that person cannot receive a message';
  end if;
  perform private.notify(p_profile, 'staff_message', null, jsonb_build_object('text', v_text));
  insert into public.audit_log (actor_id, action, table_name, record_id, reason)
  values (auth.uid(), 'staff_message_sent', 'profiles', p_profile::text, v_text);
end;
$$;

-- admin_job_resume (was in 20261107000041_admin_operations.sql)
create or replace function public.admin_job_resume(p_job uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if v_note is null or char_length(v_note) < 3 or char_length(v_note) > 500 then
    raise exception 'write a note (3 to 500 characters)';
  end if;
  select * into v_job from public.jobs where id = p_job for update;
  if not found or v_job.under_review_reason is null then
    raise exception 'this job is not under review';
  end if;
  if v_job.accepted_worker_id is not null
     and (select account_status from public.profiles where id = v_job.accepted_worker_id) = 'suspended' then
    raise exception 'the worker is suspended: reactivate the worker first, or replace the worker, or cancel the job';
  end if;
  update public.jobs set under_review_reason = null where id = p_job;
  insert into public.job_events (job_id, event_type, actor_id) values (p_job, 'review_cleared', v_uid);
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, reason)
  values (v_uid, 'job_resumed', 'jobs', p_job::text, jsonb_build_object('under_review_reason', v_job.under_review_reason), v_note);
end;
$$;

-- admin_report_decide (was in 20261107000041_admin_operations.sql)
create or replace function public.admin_report_decide(p_report uuid, p_choice text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_r public.reports;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action public.report_action;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if p_choice is null or p_choice not in ('keep_open', 'warning', 'suspend', 'close') then
    raise exception 'choose what to do with this case';
  end if;
  select * into v_r from public.reports where id = p_report for update;
  if not found then
    raise exception 'no such case';
  end if;
  if v_r.status = 'resolved' then
    raise exception 'this case is already resolved';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'the reason is too long (500 characters at most)';
  end if;

  if p_choice = 'keep_open' then
    update public.reports set status = 'in_review', assigned_to = coalesce(assigned_to, v_uid) where id = p_report;
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
    values (v_uid, 'report_in_review', 'reports', p_report::text, jsonb_build_object('status', v_r.status),
            jsonb_build_object('status', 'in_review'), v_reason);
    return;
  end if;

  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'write a reason for this decision (3 to 500 characters)';
  end if;
  v_action := (case p_choice when 'warning' then 'warning' when 'suspend' then 'suspend' else 'no_action' end)::public.report_action;

  if p_choice = 'suspend' and (select account_status from public.profiles where id = v_r.against_id) = 'active' then
    perform public.admin_set_account_status(v_r.against_id, true, v_reason);
  end if;

  update public.reports
     set status = 'resolved', action = v_action, action_reason = v_reason, resolved_at = now(),
         assigned_to = coalesce(assigned_to, v_uid)
   where id = p_report;

  if p_choice = 'warning' then
    perform private.notify(v_r.against_id, 'report_warning', v_r.job_id, jsonb_build_object('message', v_reason));
  end if;

  -- The job was flagged for staff when an unsafe or price report came in; unflag it when no such report is left open.
  update public.jobs set under_review_reason = null
   where id = v_r.job_id and under_review_reason like 'report\_%'
     and not exists (select 1 from public.reports o
                      where o.job_id = v_r.job_id and o.id <> p_report and o.status <> 'resolved' and o.kind in ('unsafe', 'cash_price'));

  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (v_uid, 'report_resolved', 'reports', p_report::text, jsonb_build_object('status', v_r.status),
          jsonb_build_object('status', 'resolved', 'action', v_action), v_reason);
end;
$$;
