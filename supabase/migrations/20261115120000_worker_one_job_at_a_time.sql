-- Migration 0056: a worker does one job at a time (owner decision, 15 Nov 2026).
--
-- Once a worker has STARTED a job (status 'in_progress', set by start_job) they cannot take or quote another until they
-- mark that job complete. Other jobs disappear from their feed, and accept_job (claim and quote), express_interest and
-- submit_quote refuse. Jobs that are only scheduled do not count, so a worker can still line up work for other days.
-- Quotes already sent stay as they are, and revise_quote is unchanged: nothing new is claimed. The block ends at Mark
-- complete (status 'completed'); recording the cash afterwards does not block new work.
--
-- Every function body below is the current one with a single guard added at the top.

create function private.worker_has_job_in_progress(p_worker uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.jobs j where j.accepted_worker_id = p_worker and j.status = 'in_progress')
$$;
-- A view runs the functions it calls with the rights of the person reading it, so the signed-in worker needs execute here
-- (the private schema is not exposed through the API, so this is not callable from the apps directly).
revoke all on function private.worker_has_job_in_progress(uuid) from public, anon;
grant execute on function private.worker_has_job_in_progress(uuid) to authenticated;


-- The feed: empty while the worker has a job in progress (columns exactly as before).
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
  and not exists (select 1 from public.quotes q2 where q2.job_id = j.id and q2.worker_id = (select auth.uid()))
  and not private.worker_has_job_in_progress((select auth.uid()));


-- accept_job: claim and quote
CREATE OR REPLACE FUNCTION public.accept_job(p_job_id uuid, p_labour integer, p_materials integer DEFAULT 0, p_materials_note text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_visit_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_visit_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.me('worker');
  v_job public.jobs;
  v_expiry integer := private.setting_int('job_expiry_hours', 24);
  v_quote_id uuid;
  v_total integer;
begin
  if private.worker_has_job_in_progress(v_uid) then
    raise exception 'finish the job you have started before taking another';
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
                             visit_start, visit_end)
  values (p_job_id, v_uid, p_labour, coalesce(p_materials, 0), p_materials_note, 0, p_note, 'sent',
          p_visit_start, p_visit_end)
  returning id, total into v_quote_id, v_total;

  update public.jobs set status = 'quoted' where id = p_job_id;

  perform private.record(p_job_id, 'quote_sent', v_uid,
    jsonb_build_object('total', v_total, 'visit_start', p_visit_start, 'visit_end', p_visit_end), true);
  perform private.notify(v_job.resident_id, 'quote_received', p_job_id,
    jsonb_build_object('title', v_job.title, 'quote_id', v_quote_id));
  return v_quote_id;
end;
$function$;


-- express_interest
CREATE OR REPLACE FUNCTION public.express_interest(p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := private.me('worker');
  v_job public.jobs;
  v_was_live boolean;
begin
  if private.worker_has_job_in_progress(v_uid) then
    raise exception 'finish the job you have started before taking another';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found or v_job.status not in ('open', 'interested', 'quoted')
     or not public.worker_matches_job(v_job.category_id, v_job.phase) then
    raise exception 'this job is not available';
  end if;
  if exists (select 1 from public.quotes where job_id = p_job_id and worker_id = v_uid and status = 'rejected') then
    raise exception 'the resident did not accept your quote on this job';
  end if;
  select (withdrawn_at is null) into v_was_live from public.job_interests where job_id = p_job_id and worker_id = v_uid;
  if v_was_live then
    return;   -- already interested
  end if;
  insert into public.job_interests (job_id, worker_id) values (p_job_id, v_uid)
  on conflict (job_id, worker_id) do update set withdrawn_at = null, created_at = now();
  perform private.recompute_job_stage(p_job_id);
  perform private.record(p_job_id, 'interest', v_uid, '{}'::jsonb, true);
  perform private.notify(v_job.resident_id, 'new_interest', p_job_id, jsonb_build_object('title', v_job.title));
end;
$function$;


-- submit_quote
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
  if private.worker_has_job_in_progress(v_uid) then
    raise exception 'finish the job you have started before taking another';
  end if;
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
