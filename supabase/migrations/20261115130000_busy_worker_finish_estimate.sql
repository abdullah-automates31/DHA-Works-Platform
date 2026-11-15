-- Migration 0057: a worker who is in the middle of a job may take another one, and tells the customer how long the current
-- job will take (owner decision, 15 Nov 2026; replaces the hard block of 0056).
--
-- Flow: the worker claims a job (accept_job) while a job of theirs is in progress. The system notices, keeps the quote
-- back (busy_eta_pending) and sends the worker a 'busy_eta_needed' notice. The worker opens the job and types how long
-- the current job will still take (set_busy_eta, 5 minutes to 3 days). Only then does the customer get the quote, with that
-- time (resident_quotes.busy_eta_minutes, and busy_eta_minutes in the quote_received notice). The customer waits, or
-- rejects the quote, or replaces the worker before the work starts. A free worker sends nothing extra.
--
-- A quote that waits for the estimate is hidden from the customer, cannot be accepted or revised, and is withdrawn after
-- 30 minutes without an answer (the job opens again and the worker is told), so a worker cannot hold a job without answering.
-- accept_job still takes an optional p_busy_eta_minutes for a caller that already knows it (then nothing waits).
--
-- Also: start_job refuses a second job in progress, and a per-worker lock makes "start a job" and "claim another" run one
-- after the other. express_interest and submit_quote (old paths the apps do not use) still refuse a busy worker (0056).

alter table public.quotes add column busy_eta_minutes integer;
alter table public.quotes add column busy_eta_pending boolean not null default false;
alter table public.quotes add constraint quotes_busy_eta_range check (busy_eta_minutes is null or busy_eta_minutes between 5 and 4320);
alter table public.quotes add constraint quotes_busy_eta_one_state check (not busy_eta_pending or busy_eta_minutes is null);
comment on column public.quotes.busy_eta_minutes is 'Minutes the worker said the job they were already doing would still take when they sent this quote (null when they were free).';
comment on column public.quotes.busy_eta_pending is 'True while the worker owes the estimate: the customer does not see the quote yet.';
grant select (busy_eta_minutes, busy_eta_pending) on public.quotes to authenticated;

create function private.lock_worker_jobs(p_worker uuid)
returns void
language sql security definer set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('worker-one-job:' || p_worker::text, 0))
$$;
revoke all on function private.lock_worker_jobs(uuid) from public, anon;
grant execute on function private.lock_worker_jobs(uuid) to authenticated;

-- The feed shows jobs to a busy worker again (columns exactly as before 0056).
create or replace view public.worker_feed with (security_invoker = false) as
select j.id, j.code, j.status, j.title, j.description, j.category_id, c.name as category_name,
  j.phase, j.lane, j.urgency, j.preferred_date, j.window_from, j.window_to, j.voice_note_path, j.posted_at,
  j.posted_at + make_interval(hours => private.setting_int('job_expiry_hours', 24)) as expires_at,
  (select count(*) from public.job_interests i where i.job_id = j.id and i.withdrawn_at is null) as interest_count,
  (select count(*) from public.job_views v where v.job_id = j.id) as viewed_count,
  (select count(*) from public.job_photos p where p.job_id = j.id) as photo_count,
  (select p.storage_path from public.job_photos p where p.job_id = j.id order by p.sort limit 1) as thumb_path,
  (select count(*) from public.quotes q where q.job_id = j.id and q.status = 'sent') as quote_count,
  (select array_agg(t.storage_path order by t.sort)
     from (select p.storage_path, p.sort from public.job_photos p where p.job_id = j.id order by p.sort limit 2) t) as thumb_paths
from public.jobs j
join public.categories c on c.id = j.category_id
where j.status in ('open', 'interested')
  and j.posted_at > now() - make_interval(hours => (select private.setting_int('job_expiry_hours', 24)))
  and (select public.is_active_approved('worker'))
  and j.category_id in (select wc.category_id from public.worker_categories wc where wc.worker_id = (select auth.uid()))
  and j.phase in (select wa.phase from public.worker_areas wa where wa.worker_id = (select auth.uid()))
  and not exists (select 1 from public.job_interests i2 where i2.job_id = j.id and i2.worker_id = (select auth.uid()))
  and not exists (select 1 from public.quotes q2 where q2.job_id = j.id and q2.worker_id = (select auth.uid()));

-- The customer cannot read a quote row that still waits for the estimate, not even straight from the table (the view above
-- already hides it). The worker and staff keep their access.
drop policy quotes_read on public.quotes;
create policy quotes_read on public.quotes for select to authenticated
  using (worker_id = (select auth.uid()) or (public.is_job_owner(job_id) and not busy_eta_pending) or public.is_admin());

-- The customer's quotes: one more column at the end, and a quote that still waits for the estimate is not shown.
create or replace view public.resident_quotes with (security_invoker = false) as
SELECT q.id,
    q.job_id,
    q.status,
    q.labour,
    q.materials,
    q.materials_note,
    q.other_amount,
    q.other_note,
    q.total,
    q.visit_start,
    q.visit_end,
    q.note,
    q.created_at,
    q.worker_id,
    p.full_name AS worker_name,
    p.avatar_path,
    wd.rating_avg,
    wd.rating_count,
    wd.jobs_done,
    wd.experience_years,
    wd.visit_fee,
    wd.voice_intro_path,
    wd.jobs_done >= private.setting_int('top_rated_min_jobs'::text, 10) AND wd.rating_avg >= ((get_setting('top_rated_min_rating'::text) #>> '{}'::text[])::numeric) AS is_top_rated,
        CASE
            WHEN q.status = 'accepted'::quote_status THEN p.phone
            ELSE NULL::text
        END AS worker_phone,
    wd.about AS worker_about,
    q.material_bill_path,
    q.revision,
    q.busy_eta_minutes
   FROM quotes q
     JOIN jobs j ON j.id = q.job_id
     JOIN profiles p ON p.id = q.worker_id
     JOIN worker_details wd ON wd.profile_id = q.worker_id
  WHERE j.resident_id = (( SELECT auth.uid() AS uid)) AND NOT q.busy_eta_pending AND (q.status = ANY (ARRAY['sent'::quote_status, 'accepted'::quote_status, 'rejected'::quote_status, 'not_selected'::quote_status]));

-- set_busy_eta: the worker says how long the current job will take; the customer is told now.
create function public.set_busy_eta(p_quote_id uuid, p_minutes integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker');
  v_job_id uuid;
  v_job public.jobs;
  v_q public.quotes;
begin
  select job_id into v_job_id from public.quotes where id = p_quote_id and worker_id = v_uid;
  if v_job_id is null then
    raise exception 'quote not found';
  end if;
  select * into v_job from public.jobs where id = v_job_id for update;
  select * into v_q from public.quotes where id = p_quote_id for update;
  if v_q.status <> 'sent' or not v_q.busy_eta_pending then
    raise exception 'there is nothing to answer on this quote';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 4320 then
    raise exception 'the time left on your current job must be between 5 minutes and 3 days';
  end if;

  update public.quotes set busy_eta_minutes = p_minutes, busy_eta_pending = false where id = p_quote_id;
  perform private.record(v_job_id, 'quote_sent', v_uid,
    jsonb_build_object('total', v_q.total, 'visit_start', v_q.visit_start, 'visit_end', v_q.visit_end, 'busy_eta_minutes', p_minutes), true);
  perform private.notify(v_job.resident_id, 'quote_received', v_job_id,
    jsonb_build_object('title', v_job.title, 'quote_id', p_quote_id, 'busy_eta_minutes', p_minutes));
end;
$$;
revoke all on function public.set_busy_eta(uuid, integer) from public, anon;
grant execute on function public.set_busy_eta(uuid, integer) to authenticated;

-- A quote that waited 30 minutes for the estimate is withdrawn: the job opens again and the worker is told.
create function private.expire_busy_eta()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    update public.quotes q set status = 'withdrawn', busy_eta_pending = false, decided_at = now()
     where q.busy_eta_pending and q.status = 'sent' and q.created_at < now() - interval '30 minutes'
    returning q.id, q.job_id, q.worker_id
  loop
    perform private.recompute_job_stage(r.job_id);
    perform private.notify(r.worker_id, 'busy_eta_expired', r.job_id,
      jsonb_build_object('title', (select j.title from public.jobs j where j.id = r.job_id)));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.expire_busy_eta() from public, anon, authenticated;
select cron.schedule('dw-busy-eta-expiry', '*/5 * * * *', 'select private.expire_busy_eta();');

-- accept_job: no refusal for a busy worker; the old signature goes (old worker builds that send seven named arguments still work).
drop function public.accept_job(uuid, integer, integer, text, text, timestamptz, timestamptz);
create function public.accept_job(p_job_id uuid, p_labour integer, p_materials integer DEFAULT 0, p_materials_note text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_visit_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_visit_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_busy_eta_minutes integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_busy boolean;
  v_pending boolean;
  v_uid uuid := private.me('worker');
  v_job public.jobs;
  v_expiry integer := private.setting_int('job_expiry_hours', 24);
  v_quote_id uuid;
  v_total integer;
begin
  perform private.lock_worker_jobs(v_uid);
  -- A worker in the middle of a job may still take this one. The quote then waits for the worker to say how long the
  -- current job will take (set_busy_eta); the customer is told only after that.
  v_busy := private.worker_has_job_in_progress(v_uid);
  if p_busy_eta_minutes is not null and (p_busy_eta_minutes < 5 or p_busy_eta_minutes > 4320) then
    raise exception 'the time left on your current job must be between 5 minutes and 3 days';
  end if;
  v_pending := v_busy and p_busy_eta_minutes is null;
  -- One unanswered quote at a time: otherwise a busy worker could hold many jobs for 30 minutes each without answering.
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
  -- Old worker builds send no window; a new build always sends both.
  if p_visit_start is not null or p_visit_end is not null then
    perform private.check_visit_window(p_visit_start, p_visit_end);
  end if;

  update public.job_interests set withdrawn_at = now()
   where job_id = p_job_id and worker_id <> v_uid and withdrawn_at is null;

  insert into public.quotes (job_id, worker_id, labour, materials, materials_note, other_amount, note, status,
                             visit_start, visit_end, busy_eta_minutes, busy_eta_pending)
  values (p_job_id, v_uid, p_labour, coalesce(p_materials, 0), p_materials_note, 0, p_note, 'sent',
          p_visit_start, p_visit_end, case when v_busy then p_busy_eta_minutes end, v_pending)
  returning id, total into v_quote_id, v_total;

  update public.jobs set status = 'quoted' where id = p_job_id;

  if v_pending then
    -- Tell the worker to say how long the current job will take; the customer hears nothing yet.
    perform private.notify(v_uid, 'busy_eta_needed', p_job_id, jsonb_build_object('title', v_job.title, 'quote_id', v_quote_id));
  else
    perform private.record(p_job_id, 'quote_sent', v_uid,
      jsonb_build_object('total', v_total, 'visit_start', p_visit_start, 'visit_end', p_visit_end), true);
    perform private.notify(v_job.resident_id, 'quote_received', p_job_id,
      jsonb_build_object('title', v_job.title, 'quote_id', v_quote_id, 'busy_eta_minutes', case when v_busy then p_busy_eta_minutes end));
  end if;
  return v_quote_id;
end;
$function$;

revoke all on function public.accept_job(uuid, integer, integer, text, text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.accept_job(uuid, integer, integer, text, text, timestamptz, timestamptz, integer) to authenticated;

-- accept_quote: a quote still waiting for the estimate cannot be accepted.
CREATE OR REPLACE FUNCTION public.accept_quote(p_quote_id uuid, p_revision smallint DEFAULT NULL::smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.me('resident');
  v_job_id uuid;
  v_job public.jobs;
  v_quote public.quotes;
  v_start timestamptz;
  v_end timestamptz;
  r record;
begin
  select job_id into v_job_id from public.quotes where id = p_quote_id;
  if v_job_id is null then
    raise exception 'quote not found';
  end if;
  -- Lock the job first so two concurrent accepts (or an accept and a revise) serialise.
  select * into v_job from public.jobs where id = v_job_id and resident_id = v_uid for update;
  if not found then
    raise exception 'quote not found';
  end if;
  if v_job.status not in ('interested', 'quoted') then
    raise exception 'this job can no longer accept a quote';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id;
  if v_quote.status <> 'sent' then
    raise exception 'this quote is no longer available';
  end if;
  if v_quote.busy_eta_pending then
    raise exception 'the worker has not said yet how long their current job will take';
  end if;
  if p_revision is not null and v_quote.revision <> p_revision then
    raise exception 'the worker changed the quote';
  end if;
  if not exists (select 1 from public.profiles
                 where id = v_quote.worker_id and verification_status = 'approved' and account_status = 'active') then
    raise exception 'this worker is no longer available';
  end if;

  -- The worker's window is the booking; quotes from before 0044 have none and fall back to the customer's day.
  if v_quote.visit_start is not null then
    v_start := v_quote.visit_start;
    v_end := v_quote.visit_end;
  else
    select vv.visit_start, vv.visit_end into v_start, v_end from private.job_visit(v_job) vv;
  end if;

  update public.quotes set status = 'accepted', decided_at = now() where id = p_quote_id;
  for r in
    update public.quotes set status = 'not_selected', decided_at = now()
    where job_id = v_job_id and status = 'sent' and id <> p_quote_id
    returning worker_id
  loop
    perform private.notify(r.worker_id, 'quote_not_selected', v_job_id, jsonb_build_object('title', v_job.title));
  end loop;

  update public.jobs set status = 'scheduled', accepted_quote_id = p_quote_id, accepted_worker_id = v_quote.worker_id,
    scheduled_start = v_start, scheduled_end = v_end
  where id = v_job_id;
  -- After "Replace worker" the earlier worker's cash row is still there (agreed_amount is write-once). Nobody can have
  -- entered an amount on a job that never started, so the stale row is replaced.
  delete from public.cash_records
   where job_id = v_job_id and worker_amount is null and resident_amount is null;
  insert into public.cash_records (job_id, agreed_amount) values (v_job_id, v_quote.total);

  perform private.record(v_job_id, 'quote_accepted', v_uid,
    jsonb_build_object('total', v_quote.total, 'revision', v_quote.revision), true);
  perform private.record(v_job_id, 'scheduled', v_uid, jsonb_build_object('start', v_start, 'end', v_end));
  perform private.notify(v_quote.worker_id, 'quote_accepted', v_job_id,
    jsonb_build_object('title', v_job.title, 'start', v_start));
end;
$function$;

-- reject_quote: nor can the customer reject one they cannot see yet.
CREATE OR REPLACE FUNCTION public.reject_quote(p_quote_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.me('resident');
  v_job_id uuid;
  v_job public.jobs;
  v_quote public.quotes;
begin
  select job_id into v_job_id from public.quotes where id = p_quote_id;
  select * into v_job from public.jobs where id = v_job_id and resident_id = v_uid for update;
  if not found then
    raise exception 'quote not found';
  end if;
  if v_job.status not in ('interested', 'quoted') then
    raise exception 'this job can no longer change quotes';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id;
  if v_quote.status <> 'sent' then
    raise exception 'this quote is no longer available';
  end if;
  if v_quote.busy_eta_pending then
    raise exception 'quote not found';
  end if;
  update public.quotes set status = 'rejected', reject_reason = p_reason, decided_at = now() where id = p_quote_id;
  perform private.recompute_job_stage(v_job_id);
  perform private.record(v_job_id, 'quote_rejected', v_uid, '{}'::jsonb, true);
  perform private.notify(v_quote.worker_id, 'quote_rejected', v_job_id, jsonb_build_object('title', v_job.title));
end;
$function$;

-- revise_quote: not while the estimate is still owed.
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
  perform private.check_visit_window(p_visit_start, p_visit_end);

  update public.quotes
     set labour = p_labour, materials = coalesce(p_materials, 0), materials_note = p_materials_note, note = p_note,
         visit_start = p_visit_start, visit_end = p_visit_end, revision = 1, revised_at = now()
   where id = p_quote_id
  returning total into v_total;

  perform private.record(v_job_id, 'quote_revised', v_uid, jsonb_build_object(
    'old_total', v_old.total, 'total', v_total,
    'old_visit_start', v_old.visit_start, 'old_visit_end', v_old.visit_end,
    'visit_start', p_visit_start, 'visit_end', p_visit_end), true);
  perform private.notify(v_job.resident_id, 'quote_revised', v_job_id,
    jsonb_build_object('title', v_job.title, 'quote_id', p_quote_id));
end;
$function$;

-- start_job: one job in progress at a time.
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
  if exists (select 1 from public.jobs j where j.accepted_worker_id = v_uid and j.status = 'in_progress' and j.id <> p_job_id) then
    raise exception 'finish the job you have started before starting another';
  end if;
  select * into v_job from public.jobs where id = p_job_id and accepted_worker_id = v_uid for update;
  if not found or v_job.status <> 'scheduled' then
    raise exception 'this job cannot be started';
  end if;
  update public.jobs set status = 'in_progress', started_at = now(), stuck_since = null, stuck_reason = null
  where id = p_job_id;
  perform private.record(p_job_id, 'started', v_uid);
  perform private.notify(v_job.resident_id, 'job_started', p_job_id, jsonb_build_object('title', v_job.title));
end;
$function$;
