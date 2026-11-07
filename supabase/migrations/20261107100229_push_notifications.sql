-- Push notifications for job events (customer and worker apps, via FCM).
--
-- Every job event already inserts a row into public.notifications for the person concerned. This migration
-- sends each new row to the send-push Edge Function (supabase/functions/send-push), which writes the text,
-- delivers it to the recipient's devices (public.device_tokens) and sets push_sent_at.
--
-- Configuration lives in Vault, not here, so each project has its own values:
--   push_function_url   = https://<ref>.supabase.co/functions/v1/send-push
--   push_webhook_secret = shared secret, also set as the PUSH_WEBHOOK_SECRET function secret
-- Without them nothing is sent and job actions are unaffected.
--
-- Also fills three gaps in the notification trail:
--   * complete_job tells the worker to collect the cash (cash_awaiting_you),
--   * replace_worker / admin_job_replace_worker send the reopened job to matching workers again,
--   * submit_quote records which quote a quote_received row is about (payload.quote_id).
-- The four functions are the live DEV definitions (read 2026-11-07) with only those lines added.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------------------------------------------
-- Dispatch
-- ---------------------------------------------------------------------------------------------------------------

-- Posts a batch of notification ids to send-push. Never raises: a push problem must not undo a job action.
create or replace function private.post_push(p_ids uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_url text;
  v_secret text;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if v_url is null or v_secret is null then
    return;   -- push not configured on this project
  end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('ids', to_jsonb(p_ids)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'push dispatch failed: %', sqlerrm;
end;
$function$;

-- One request per statement, so post_job's fan-out to many workers is a single call.
create or replace function private.dispatch_push()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform private.post_push((select array_agg(id) from new_rows));
  return null;
end;
$function$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  referencing new table as new_rows
  for each statement
  execute function private.dispatch_push();

-- Safety net: rows the function never claimed (it was down, or the request was lost) are retried for an hour.
create or replace function private.retry_push()
 returns void
 language sql
 security definer
 set search_path to ''
as $function$
  select private.post_push((
    select array_agg(id) from (
      select id from public.notifications
      where push_sent_at is null
        and created_at between now() - interval '1 hour' and now() - interval '2 minutes'
      order by created_at
      limit 500
    ) pending
  ));
$function$;

select cron.schedule('dw-push-retry', '*/10 * * * *', 'select private.retry_push();');

revoke all on function private.post_push(uuid[]) from public;
revoke all on function private.dispatch_push() from public;
revoke all on function private.retry_push() from public;

-- ---------------------------------------------------------------------------------------------------------------
-- Device tokens: the app removes its own token on sign-out (register_device_token already exists).
-- ---------------------------------------------------------------------------------------------------------------

create or replace function public.unregister_device_token(p_token text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from public.device_tokens where user_id = v_uid and push_token = p_token;
end;
$function$;

revoke all on function public.unregister_device_token(text) from public, anon;
grant execute on function public.unregister_device_token(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Notification trail gaps
-- ---------------------------------------------------------------------------------------------------------------

-- Same matching rule as post_job (approved, active, category and phase), minus every worker the resident has
-- rejected or replaced on this job (they can never take it again, see express_interest / submit_quote).
create or replace function private.notify_matching_workers(p_job uuid)
 returns void
 language sql
 security definer
 set search_path to ''
as $function$
  insert into public.notifications (user_id, type, job_id, payload)
  select p.id, 'new_job', j.id, jsonb_build_object('title', j.title, 'phase', j.phase)
  from public.jobs j
  join public.profiles p on p.role = 'worker' and p.verification_status = 'approved' and p.account_status = 'active'
  where j.id = p_job
    and exists (select 1 from public.worker_categories wc where wc.worker_id = p.id and wc.category_id = j.category_id)
    and exists (select 1 from public.worker_areas wa where wa.worker_id = p.id and wa.phase = j.phase)
    and not exists (select 1 from public.quotes q where q.job_id = j.id and q.worker_id = p.id and q.status = 'rejected');
$function$;

revoke all on function private.notify_matching_workers(uuid) from public;

CREATE OR REPLACE FUNCTION public.complete_job(p_job_id uuid, p_bill_path text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.me('worker', false);
  v_job public.jobs;
  v_materials integer;
  v_bill text := nullif(trim(p_bill_path), '');
begin
  select * into v_job from public.jobs where id = p_job_id and accepted_worker_id = v_uid for update;
  if not found or v_job.status <> 'in_progress' then
    raise exception 'this job cannot be completed';
  end if;
  select materials into v_materials from public.quotes where id = v_job.accepted_quote_id;
  if coalesce(v_materials, 0) > 0 and v_bill is null then
    raise exception 'upload the material bill';
  end if;
  if v_bill is not null and split_part(v_bill, '/', 1) <> v_uid::text then
    raise exception 'invalid bill path';
  end if;
  if v_bill is not null
     and not exists (select 1 from storage.objects o where o.bucket_id = 'job-media' and o.name = v_bill) then
    raise exception 'invalid bill path';
  end if;
  update public.jobs set status = 'completed', completed_at = now(), material_bill_path = v_bill,
    stuck_since = null, stuck_reason = null
  where id = p_job_id;
  perform private.record(p_job_id, 'completed', v_uid);
  perform private.notify(v_job.resident_id, 'job_completed', p_job_id, jsonb_build_object('title', v_job.title));
  -- Push trail: the worker is told to collect the cash and record it.
  perform private.notify(v_uid, 'cash_awaiting_you', p_job_id, jsonb_build_object('title', v_job.title));
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_quote(p_job_id uuid, p_labour integer, p_visit_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_visit_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_materials integer DEFAULT 0, p_materials_note text DEFAULT NULL::text, p_other_amount integer DEFAULT 0, p_other_note text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_material_bill_path text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.me('worker');
  v_job public.jobs;
  v_id uuid;
  v_expiry integer := private.setting_int('job_expiry_hours', 24);
  v_bill text := nullif(btrim(p_material_bill_path), '');
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found or v_job.status not in ('interested', 'quoted')
     or not public.worker_matches_job(v_job.category_id, v_job.phase) then
    raise exception 'this job is not available for quotes';
  end if;
  if v_job.posted_at + make_interval(hours => v_expiry) < now() then
    raise exception 'this job has expired';
  end if;
  if not exists (select 1 from public.job_interests where job_id = p_job_id and worker_id = v_uid and withdrawn_at is null) then
    raise exception 'show interest in the job before sending a quote';
  end if;
  if exists (select 1 from public.quotes where job_id = p_job_id and worker_id = v_uid and status = 'rejected') then
    raise exception 'the resident did not accept your quote on this job';
  end if;
  if exists (select 1 from public.quotes where job_id = p_job_id and worker_id = v_uid and status = 'sent') then
    raise exception 'you already sent a quote; withdraw it first';
  end if;
  if v_bill is not null and split_part(v_bill, '/', 1) <> v_uid::text then
    raise exception 'invalid bill path';
  end if;

  insert into public.quotes (job_id, worker_id, labour, materials, materials_note, other_amount, other_note,
                             visit_start, visit_end, note, material_bill_path)
  values (p_job_id, v_uid, p_labour, coalesce(p_materials, 0), p_materials_note, coalesce(p_other_amount, 0),
          p_other_note, null, null, p_note,
          case when coalesce(p_materials, 0) > 0 then v_bill end)
  returning id into v_id;
  perform private.recompute_job_stage(p_job_id);
  perform private.record(p_job_id, 'quote_sent', v_uid, '{}'::jsonb, true);
  perform private.notify(v_job.resident_id, 'quote_received', p_job_id, jsonb_build_object('title', v_job.title, 'quote_id', v_id));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.replace_worker(p_job_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.me('resident', false);
  v_job public.jobs;
  v_worker uuid;
begin
  select * into v_job from public.jobs where id = p_job_id and resident_id = v_uid for update;
  if not found then
    raise exception 'job not found';
  end if;
  if v_job.status <> 'scheduled' then
    raise exception 'the worker can only be replaced before the work starts';
  end if;
  if exists (select 1 from public.cancellation_requests where job_id = p_job_id and status = 'pending') then
    raise exception 'a cancellation request is already waiting for review';
  end if;

  v_worker := v_job.accepted_worker_id;

  -- The replaced worker's quote is closed. Other quotes were set to 'not_selected' when this one was
  -- accepted; they stay closed, so workers quote again on the reopened job.
  update public.quotes
     set status = 'rejected', reject_reason = p_reason, decided_at = now()
   where id = v_job.accepted_quote_id;

  update public.jobs
     set status = 'open',
         accepted_quote_id = null, accepted_worker_id = null,
         scheduled_start = null, scheduled_end = null
   where id = p_job_id;

  -- The replaced worker must not count as interested any more, otherwise the stage below would
  -- still see their live interest. They also cannot come back: express_interest and submit_quote
  -- already refuse a worker who has a 'rejected' quote on the job (checked on DEV, 2026-11-02),
  -- which is exactly the status set above.
  update public.job_interests set withdrawn_at = now()
   where job_id = p_job_id and worker_id = v_worker and withdrawn_at is null;

  -- Back to 'open', or 'interested' if other workers still have a live interest in the job.
  perform private.recompute_job_stage(p_job_id);
  -- Push trail: the reopened job goes out again to matching workers, never to the replaced one.
  perform private.notify_matching_workers(p_job_id);

  if v_worker is not null then
    -- Re-uses the existing notification type so the worker app needs no change.
    perform private.notify(v_worker, 'quote_rejected', p_job_id, jsonb_build_object('title', v_job.title));
  end if;
    perform private.record(p_job_id, 'worker_replaced', v_uid, jsonb_build_object('reason', p_reason), true);
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
