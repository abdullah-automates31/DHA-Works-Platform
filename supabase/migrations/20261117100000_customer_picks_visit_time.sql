-- 0059 (owner decision 17 Nov): the CUSTOMER picks the visiting time, the worker only quotes a price and comes at it.
--
-- Before: the worker named the visit time inside the quote (accept_job / revise_quote took p_visit_start). Now the
-- visit time is always the one the customer chose when posting the job (jobs.preferred_date + jobs.window_from, Karachi
-- time); whatever time a worker app sends is ignored (the parameters stay so older worker builds keep working).
--   * The stored end is the start plus one hour (a placeholder: nobody decides an end time).
--   * A job with no date (an old "as soon as possible" job) is quoted without a time, as before, except for a busy
--     worker: a busy worker can only quote a job that has a booked time, so he is refused with a clear message.
--   * A visit time that has already passed cannot be quoted (the customer must post again).
-- accept_quote is unchanged: it books the quote's visit_start, which is now always the customer's time.

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
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.lock_worker_jobs(v_uid);
  v_busy := private.worker_has_job_in_progress(v_uid);
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

  -- The visit is the customer's chosen time. The worker cannot pick or change it.
  select vv.visit_start into v_start from private.job_visit(v_job) vv;
  if v_start is null and v_busy then
    raise exception 'this job has no visiting time, so you cannot take it while you are working on another job';
  end if;
  if v_start is not null and v_start <= now() then
    raise exception 'the visiting time the customer chose has already passed';
  end if;
  v_end := case when v_start is not null then v_start + interval '1 hour' end;

  update public.job_interests set withdrawn_at = now()
   where job_id = p_job_id and worker_id <> v_uid and withdrawn_at is null;

  insert into public.quotes (job_id, worker_id, labour, materials, materials_note, other_amount, note, status,
                             visit_start, visit_end, busy_eta_minutes, busy_eta_pending)
  values (p_job_id, v_uid, p_labour, coalesce(p_materials, 0), p_materials_note, 0, p_note, 'sent',
          v_start, v_end, case when v_busy then p_busy_eta_minutes end, false)
  returning id, total into v_quote_id, v_total;

  update public.jobs set status = 'quoted' where id = p_job_id;

  perform private.record(p_job_id, 'quote_sent', v_uid,
    jsonb_build_object('total', v_total, 'visit_start', v_start, 'visit_end', v_end), true);
  perform private.notify(v_job.resident_id, 'quote_received', p_job_id,
    jsonb_build_object('title', v_job.title, 'quote_id', v_quote_id, 'busy_eta_minutes', case when v_busy then p_busy_eta_minutes end));
  return v_quote_id;
end;
$function$;

-- revise_quote: the worker may change the price once; the visit stays the customer's time.
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
  v_start timestamptz;
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
  -- The visit is still the customer's time (it cannot have moved: the customer cannot edit a quoted job).
  select vv.visit_start into v_start from private.job_visit(v_job) vv;
  if v_start is not null and v_start <= now() then
    raise exception 'the visiting time the customer chose has already passed';
  end if;
  v_end := case when v_start is not null then v_start + interval '1 hour' end;

  update public.quotes
     set labour = p_labour, materials = coalesce(p_materials, 0), materials_note = p_materials_note, note = p_note,
         visit_start = v_start, visit_end = v_end, revision = 1, revised_at = now()
   where id = p_quote_id
  returning total into v_total;

  perform private.record(v_job_id, 'quote_revised', v_uid, jsonb_build_object(
    'old_total', v_old.total, 'total', v_total,
    'old_visit_start', v_old.visit_start, 'old_visit_end', v_old.visit_end,
    'visit_start', v_start, 'visit_end', v_end), true);
  perform private.notify(v_job.resident_id, 'quote_revised', v_job_id,
    jsonb_build_object('title', v_job.title, 'quote_id', p_quote_id));
end;
$function$;
