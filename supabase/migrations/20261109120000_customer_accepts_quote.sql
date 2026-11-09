-- 0043: the customer accepts the worker's price (Shariq, 9 Nov; answers OPEN-QUESTIONS "who picks the worker" point 2).
--
-- Before: accept_job (0031) quoted, accepted and scheduled in one step, so the customer was never asked.
-- Now:    a worker claims an open job with a price -> the job is 'quoted' and locked to that one worker (their quote
--         is 'sent'). The customer then decides:
--           accept_quote  -> 'scheduled' at the customer's own date and time (cash amount set here now)
--           reject_quote  -> the customer app calls this "Replace worker": that worker is excluded, the job reopens
--           cancel_job    -> the job closes
--         After acceptance nothing changes: replace_worker / request_cancellation as before.
--
-- Lock: a 'quoted' job takes no second claim (accept_job needs open or interested) and leaves the worker feed.
-- Privacy is unchanged: accepted_worker_id stays empty until the customer accepts, so the worker sees no resident
-- name, phone or plot before that.

-- ---------------------------------------------------------------------------
-- accept_job: claim with a price; the customer still has to accept
-- ---------------------------------------------------------------------------
create or replace function public.accept_job(
  p_job_id uuid,
  p_labour integer,
  p_materials integer default 0,
  p_materials_note text default null,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker');
  v_job public.jobs;
  v_expiry integer := private.setting_int('job_expiry_hours', 24);
  v_quote_id uuid;
  v_total integer;
begin
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

  update public.job_interests set withdrawn_at = now()
   where job_id = p_job_id and worker_id <> v_uid and withdrawn_at is null;

  insert into public.quotes (job_id, worker_id, labour, materials, materials_note, other_amount, note, status)
  values (p_job_id, v_uid, p_labour, coalesce(p_materials, 0), p_materials_note, 0, p_note, 'sent')
  returning id, total into v_quote_id, v_total;

  update public.jobs set status = 'quoted' where id = p_job_id;

  perform private.record(p_job_id, 'quote_sent', v_uid, jsonb_build_object('total', v_total), true);
  perform private.notify(v_job.resident_id, 'quote_received', p_job_id,
    jsonb_build_object('title', v_job.title, 'quote_id', v_quote_id));
  return v_quote_id;
end;
$$;

revoke all on function public.accept_job(uuid, integer, integer, text, text) from public, anon;
grant execute on function public.accept_job(uuid, integer, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_quote: same as 0025, plus the stale cash row of a replaced worker is cleared first
-- ---------------------------------------------------------------------------
create or replace function public.accept_quote(p_quote_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
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
  -- Lock the job first so two concurrent accepts serialise; the second sees a changed status.
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
  if not exists (select 1 from public.profiles
                 where id = v_quote.worker_id and verification_status = 'approved' and account_status = 'active') then
    raise exception 'this worker is no longer available';
  end if;

  select vv.visit_start, vv.visit_end into v_start, v_end from private.job_visit(v_job) vv;

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

  perform private.record(v_job_id, 'quote_accepted', v_uid, jsonb_build_object('total', v_quote.total), true);
  perform private.record(v_job_id, 'scheduled', v_uid, jsonb_build_object('start', v_start, 'end', v_end));
  perform private.notify(v_quote.worker_id, 'quote_accepted', v_job_id,
    jsonb_build_object('title', v_job.title, 'start', v_start));
end;
$$;

-- ---------------------------------------------------------------------------
-- worker_feed: a quoted job is locked to one worker, so it leaves the feed (columns exactly as 0029)
-- ---------------------------------------------------------------------------
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
