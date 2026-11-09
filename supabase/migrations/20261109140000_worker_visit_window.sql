-- 0044: the worker proposes the visit window and may change their quote once (Shariq, 9 Nov). Supersedes the 3 Nov
-- rule "the customer controls the schedule" (0025): the customer's preferred day is now a request, the worker's
-- window is the offer, and accepting the quote books that window, for ASAP and dated jobs alike.
--
--   * quotes.revision (0 or 1) and quotes.revised_at: a quote can be changed once, while it is still 'sent'.
--   * accept_job takes p_visit_start / p_visit_end. They default to null for one release so the worker build that
--     predates this keeps working; when given, both are required, in the future, start < end, at most 12 hours.
--   * revise_quote: the worker changes price and/or window once, before the customer accepts. The resident gets
--     'quote_revised' (push) and their open screen refetches through the notifications realtime feed.
--   * accept_quote takes p_revision: when the worker changed the quote after the customer's screen loaded it, the
--     accept is refused so nobody agrees to a price or time they did not see. Null skips the check (old builds).
--     The job is booked at the quote's window; private.job_visit stays the fallback for quotes without one.
--   * resident_quotes and worker_jobs gain the revision (appended, existing column order kept).

alter table public.quotes
  add column revision smallint not null default 0 check (revision between 0 and 1),
  add column revised_at timestamptz;

-- ---------------------------------------------------------------------------
-- shared window check
-- ---------------------------------------------------------------------------
create function private.check_visit_window(p_start timestamptz, p_end timestamptz)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if p_start is null or p_end is null then
    raise exception 'choose when you will come';
  end if;
  if p_start <= now() then
    raise exception 'the visit must be in the future';
  end if;
  if p_end <= p_start then
    raise exception 'the visit must end after it starts';
  end if;
  if p_end - p_start > interval '12 hours' then
    raise exception 'the visit window can be at most 12 hours';
  end if;
end;
$$;
revoke all on function private.check_visit_window(timestamptz, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- accept_job: claim with a price and the visit window
-- ---------------------------------------------------------------------------
drop function public.accept_job(uuid, integer, integer, text, text);

create function public.accept_job(
  p_job_id uuid,
  p_labour integer,
  p_materials integer default 0,
  p_materials_note text default null,
  p_note text default null,
  p_visit_start timestamptz default null,
  p_visit_end timestamptz default null
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
$$;

revoke all on function public.accept_job(uuid, integer, integer, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.accept_job(uuid, integer, integer, text, text, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- revise_quote: the worker changes price and/or window once, before the customer accepts
-- ---------------------------------------------------------------------------
create function public.revise_quote(
  p_quote_id uuid,
  p_labour integer,
  p_materials integer default 0,
  p_materials_note text default null,
  p_note text default null,
  p_visit_start timestamptz default null,
  p_visit_end timestamptz default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
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
$$;

revoke all on function public.revise_quote(uuid, integer, integer, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.revise_quote(uuid, integer, integer, text, text, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- accept_quote: refuses a quote that changed after the customer saw it; books the worker's window
-- ---------------------------------------------------------------------------
drop function public.accept_quote(uuid);

create function public.accept_quote(p_quote_id uuid, p_revision smallint default null)
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
$$;

revoke all on function public.accept_quote(uuid, smallint) from public, anon;
grant execute on function public.accept_quote(uuid, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- views: the revision goes last (a view cannot gain a column in the middle)
-- ---------------------------------------------------------------------------
create or replace view public.resident_quotes with (security_invoker = false) as
select q.id, q.job_id, q.status, q.labour, q.materials, q.materials_note, q.other_amount, q.other_note,
  q.total, q.visit_start, q.visit_end, q.note, q.created_at,
  q.worker_id, p.full_name as worker_name, p.avatar_path,
  wd.rating_avg, wd.rating_count, wd.jobs_done, wd.experience_years, wd.visit_fee, wd.voice_intro_path,
  (wd.jobs_done >= private.setting_int('top_rated_min_jobs', 10)
   and wd.rating_avg >= (public.get_setting('top_rated_min_rating') #>> '{}')::numeric) as is_top_rated,
  case when q.status = 'accepted' then p.phone end as worker_phone,
  wd.about as worker_about,
  q.material_bill_path,
  q.revision
from public.quotes q
join public.jobs j on j.id = q.job_id
join public.profiles p on p.id = q.worker_id
join public.worker_details wd on wd.profile_id = q.worker_id
where j.resident_id = (select auth.uid())
  and q.status in ('sent', 'accepted', 'rejected', 'not_selected');

-- worker_jobs: as in 0027, plus my_quote_revision (0 = may still change the quote once)
create or replace view public.worker_jobs with (security_invoker = false) as
select j.id, j.code,
  case when rj.hidden then 'open'::public.job_status else j.status end as status,
  j.title,
  case when rj.hidden then null else j.description end as description,
  j.category_id, c.name as category_name,
  j.phase,
  case when rj.hidden then null else j.lane end as lane,
  j.urgency,
  case when rj.hidden then null else j.voice_note_path end as voice_note_path,
  j.posted_at,
  case when rj.hidden then null else j.scheduled_start end as scheduled_start,
  case when rj.hidden then null else j.scheduled_end end as scheduled_end,
  case when rj.hidden then null else j.started_at end as started_at,
  case when rj.hidden then null else j.completed_at end as completed_at,
  case when rj.hidden then null else j.stuck_since end as stuck_since,
  case when rj.hidden then null else j.under_review_reason end as under_review_reason,
  (j.accepted_worker_id = (select auth.uid())) as is_mine,
  mq.id as my_quote_id, mq.status as my_quote_status, mq.total as my_quote_total,
  case when j.accepted_worker_id = (select auth.uid()) then rp.full_name end as resident_name,
  case when j.accepted_worker_id = (select auth.uid()) then jp.resident_phone end as resident_phone,
  case when j.accepted_worker_id = (select auth.uid()) then jp.plot_no end as plot_no,
  case when j.accepted_worker_id = (select auth.uid()) then jp.floor end as floor,
  (not rj.hidden and exists (select 1 from public.cancellation_requests r where r.job_id = j.id and r.status = 'pending')) as cancellation_pending,
  case when rj.hidden then null else j.preferred_date end as preferred_date,
  case when rj.hidden then null else j.window_from end as window_from,
  case when rj.hidden then null else j.window_to end as window_to,
  (j.accepted_worker_id = (select auth.uid())
    and exists (select 1 from public.cash_records cr where cr.job_id = j.id and cr.worker_amount is not null)) as cash_recorded,
  mq.revision as my_quote_revision
from public.jobs j
join public.categories c on c.id = j.category_id
left join lateral (
  select q.id, q.status, q.total, q.revision from public.quotes q
  where q.job_id = j.id and q.worker_id = (select auth.uid()) order by q.created_at desc limit 1
) mq on true
cross join lateral (select public.worker_is_rejected_on(j.id) as hidden) rj
left join public.job_private jp on jp.job_id = j.id and j.accepted_worker_id = (select auth.uid())
left join public.profiles rp on rp.id = j.resident_id and j.accepted_worker_id = (select auth.uid())
where (j.status <> 'cancelled' or rj.hidden)
  and j.id in (
    select x.id from public.jobs x where x.accepted_worker_id = (select auth.uid())
    union
    select q2.job_id from public.quotes q2 where q2.worker_id = (select auth.uid())
    union
    select i2.job_id from public.job_interests i2 where i2.worker_id = (select auth.uid())
  )
  and (j.accepted_worker_id = (select auth.uid())
       or mq.id is not null
       or exists (select 1 from public.job_interests i where i.job_id = j.id and i.worker_id = (select auth.uid())));
