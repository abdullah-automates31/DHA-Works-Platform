-- Migration 0058: owner notes of 16 Nov 2026 (replaces the "wait and give a finish time" part of 0057).
--
--  1. A worker who has a job IN PROGRESS may start another job only when it is for the SAME customer on the SAME day.
--     Parallel jobs of different customers (or on different days) are refused by start_job.
--  2. A busy worker may still accept (claim) and quote a new job, but the quote must carry a visit day and time, so the
--     job is booked for that time once the customer accepts. It is never an ASAP job. The quote is no longer held back
--     to ask for a finish time (0057); the customer sees it at once. set_busy_eta and the 30-minute expiry stay in the
--     database for a quote that is still waiting from before this change; nothing creates a new waiting quote.
--  3. One visit time: the worker (and the customer) choose a day and ONE visiting time, not a from/to window. The
--     visit_end column stays (the customer app reads it); when only a start is sent, the end is one hour later.
--  4. Job reminders: a switch on the worker's profile (worker_details.job_reminders, on by default) and a reminder
--     notice one hour before a scheduled visit (private.send_job_reminders, every 5 minutes, once per job).

-- ---------------------------------------------------------------------------
-- 4a. switch + once-only marker
-- ---------------------------------------------------------------------------
alter table public.worker_details add column job_reminders boolean not null default true;
comment on column public.worker_details.job_reminders is 'The worker wants a reminder one hour before a scheduled visit (profile switch).';
alter table public.jobs add column worker_reminded_at timestamptz;
comment on column public.jobs.worker_reminded_at is 'When the worker was sent the one-hour reminder for this visit (null = not yet / switched off / booked inside the hour).';

create function public.set_job_reminders(p_value boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_value is null then
    raise exception 'choose on or off';
  end if;
  update public.worker_details set job_reminders = p_value where profile_id = (select private.me('worker', false));
end;
$$;
revoke all on function public.set_job_reminders(boolean) from public, anon;
grant execute on function public.set_job_reminders(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4b. the reminder sweep
-- ---------------------------------------------------------------------------
create function private.send_job_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select j.id, j.title, j.accepted_worker_id, j.scheduled_start
      from public.jobs j
      join public.worker_details wd on wd.profile_id = j.accepted_worker_id
      join public.quotes q on q.id = j.accepted_quote_id
     where j.status = 'scheduled'
       and j.worker_reminded_at is null
       and wd.job_reminders
       and j.scheduled_start is not null
       and j.scheduled_start > now()
       and j.scheduled_start <= now() + interval '1 hour'
       -- a visit booked less than an hour ahead is not reminded: the worker has just agreed to it
       and j.scheduled_start - interval '1 hour' >= coalesce(q.decided_at, '-infinity'::timestamptz)
     for update of j skip locked
  loop
    update public.jobs set worker_reminded_at = now() where id = r.id;
    perform private.notify(r.accepted_worker_id, 'job_reminder', r.id,
      jsonb_build_object('title', r.title, 'start', r.scheduled_start));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.send_job_reminders() from public, anon, authenticated;
select cron.schedule('dw-job-reminders', '*/5 * * * *', 'select private.send_job_reminders();');

-- A visit that moves (the customer replaces the worker, or the job is booked again) is reminded again.
create function private.reset_job_reminder()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.scheduled_start is distinct from old.scheduled_start or new.accepted_worker_id is distinct from old.accepted_worker_id then
    new.worker_reminded_at := null;
  end if;
  return new;
end;
$$;
create trigger jobs_reset_job_reminder before update on public.jobs
  for each row execute function private.reset_job_reminder();

-- ---------------------------------------------------------------------------
-- 1. start_job: another job in progress only for the same customer on the same day
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_job(p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.me('worker', false);
  v_job public.jobs;
begin
  perform private.lock_worker_jobs(v_uid);
  select * into v_job from public.jobs where id = p_job_id and accepted_worker_id = v_uid for update;
  if not found or v_job.status <> 'scheduled' then
    raise exception 'this job cannot be started';
  end if;
  -- Jobs of one customer on one day may run side by side; anything else waits until the current job is finished.
  if exists (
    select 1 from public.jobs o
     where o.accepted_worker_id = v_uid and o.status = 'in_progress' and o.id <> p_job_id
       and (o.resident_id <> v_job.resident_id
            or (o.scheduled_start at time zone 'Asia/Karachi')::date is distinct from (v_job.scheduled_start at time zone 'Asia/Karachi')::date)
  ) then
    raise exception 'finish your current job before starting a job for another customer or on another day';
  end if;
  update public.jobs set status = 'in_progress', started_at = now(), stuck_since = null, stuck_reason = null
  where id = p_job_id;
  perform private.record(p_job_id, 'started', v_uid);
  perform private.notify(v_job.resident_id, 'job_started', p_job_id, jsonb_build_object('title', v_job.title));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2 + 3. accept_job: a busy worker must name the visit time; one time is enough
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_job(p_job_id uuid, p_labour integer, p_materials integer DEFAULT 0, p_materials_note text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_visit_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_visit_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_busy_eta_minutes integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_busy boolean;
  v_uid uuid := private.me('worker');
  v_job public.jobs;
  v_expiry integer := private.setting_int('job_expiry_hours', 24);
  v_quote_id uuid;
  v_total integer;
  v_end timestamptz;
begin
  perform private.lock_worker_jobs(v_uid);
  v_busy := private.worker_has_job_in_progress(v_uid);
  -- A busy worker can only accept and quote for a booked time, never "as soon as possible".
  if v_busy and p_visit_start is null then
    raise exception 'choose the day and time you will visit';
  end if;
  if p_busy_eta_minutes is not null and (p_busy_eta_minutes < 5 or p_busy_eta_minutes > 4320) then
    raise exception 'the time left on your current job must be between 5 minutes and 3 days';
  end if;
  -- One unanswered quote from before 0058 at a time (nothing creates a new one any more).
  if exists (select 1 from public.quotes where worker_id = v_uid and busy_eta_pending and status = 'sent') then
    raise exception 'tell the customer how long your current job will take on your other quote first';
  end if;
  -- Lock the job first: two workers claiming at the same moment serialise here and the second one finds it quoted.
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found
     or v_job.status not in ('open', 'interested')
     or v_job.accepted_worker_id is not null
     or exists (select 1 from public.quotes where job_id = p_job_id and status = 'sent')
     or not public.worker_matches_job(v_job.category_id, v_job.phase) then
    raise exception 'this job is not available';
  end if;
  if v_job.posted_at + make_interval(hours => v_expiry) < now() then
    raise exception 'this job has expired';
  end if;
  -- A worker the customer replaced (or rejected) on this job can never take it again.
  if exists (select 1 from public.quotes where job_id = p_job_id and worker_id = v_uid and status = 'rejected') then
    raise exception 'the resident did not accept your quote on this job';
  end if;
  if coalesce(p_labour, 0) < 0 or coalesce(p_materials, 0) < 0 then
    raise exception 'amounts cannot be negative';
  end if;
  if coalesce(p_labour, 0) + coalesce(p_materials, 0) <= 0 then
    raise exception 'enter a price';
  end if;
  -- One visit time: an end that is not sent is one hour after the start. Old builds send no window at all.
  if p_visit_end is not null and p_visit_start is null then
    raise exception 'choose when you will come';
  end if;
  v_end := case when p_visit_start is not null then coalesce(p_visit_end, p_visit_start + interval '1 hour') end;
  if p_visit_start is not null then
    perform private.check_visit_window(p_visit_start, v_end);
  end if;

  update public.job_interests set withdrawn_at = now()
   where job_id = p_job_id and worker_id <> v_uid and withdrawn_at is null;

  insert into public.quotes (job_id, worker_id, labour, materials, materials_note, other_amount, note, status,
                             visit_start, visit_end, busy_eta_minutes, busy_eta_pending)
  values (p_job_id, v_uid, p_labour, coalesce(p_materials, 0), p_materials_note, 0, p_note, 'sent',
          p_visit_start, v_end, case when v_busy then p_busy_eta_minutes end, false)
  returning id, total into v_quote_id, v_total;

  update public.jobs set status = 'quoted' where id = p_job_id;

  perform private.record(p_job_id, 'quote_sent', v_uid,
    jsonb_build_object('total', v_total, 'visit_start', p_visit_start, 'visit_end', v_end), true);
  perform private.notify(v_job.resident_id, 'quote_received', p_job_id,
    jsonb_build_object('title', v_job.title, 'quote_id', v_quote_id, 'busy_eta_minutes', case when v_busy then p_busy_eta_minutes end));
  return v_quote_id;
end;
$function$;

-- revise_quote: same one-time rule
CREATE OR REPLACE FUNCTION public.revise_quote(p_quote_id uuid, p_labour integer, p_materials integer DEFAULT 0, p_materials_note text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_visit_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_visit_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.me('worker');
  v_job_id uuid;
  v_job public.jobs;
  v_old public.quotes;
  v_total integer;
  v_end timestamptz;
begin
  select job_id into v_job_id from public.quotes where id = p_quote_id and worker_id = v_uid;
  if v_job_id is null then
    raise exception 'quote not found';
  end if;
  -- Same lock order as accept_quote (job, then quote), so a revise and an accept never deadlock; whichever runs
  -- second sees the other's result.
  select * into v_job from public.jobs where id = v_job_id for update;
  select * into v_old from public.quotes where id = p_quote_id for update;
  if v_old.status <> 'sent' or v_job.status <> 'quoted' then
    raise exception 'the customer already decided on your quote';
  end if;
  if v_old.busy_eta_pending then
    raise exception 'tell the customer how long your current job will take first';
  end if;
  if v_old.revision >= 1 then
    raise exception 'you have already changed this quote once';
  end if;
  if coalesce(p_labour, 0) < 0 or coalesce(p_materials, 0) < 0 then
    raise exception 'amounts cannot be negative';
  end if;
  if coalesce(p_labour, 0) + coalesce(p_materials, 0) <= 0 then
    raise exception 'enter a price';
  end if;
  if p_visit_start is null then
    raise exception 'choose when you will come';
  end if;
  v_end := coalesce(p_visit_end, p_visit_start + interval '1 hour');
  perform private.check_visit_window(p_visit_start, v_end);

  update public.quotes
     set labour = p_labour, materials = coalesce(p_materials, 0), materials_note = p_materials_note, note = p_note,
         visit_start = p_visit_start, visit_end = v_end, revision = 1, revised_at = now()
   where id = p_quote_id
  returning total into v_total;

  perform private.record(v_job_id, 'quote_revised', v_uid, jsonb_build_object(
    'old_total', v_old.total, 'total', v_total,
    'old_visit_start', v_old.visit_start, 'old_visit_end', v_old.visit_end,
    'visit_start', p_visit_start, 'visit_end', v_end), true);
  perform private.notify(v_job.resident_id, 'quote_revised', v_job_id,
    jsonb_build_object('title', v_job.title, 'quote_id', p_quote_id));
end;
$function$;
