-- Migration 0063: the admin dashboard (A02), second version, plus a "stage" filter on the jobs list.
--
-- Owner request 18 Nov (dashboard content requirements). Read-only; no table, rule or workflow changes.
--
-- admin_dashboard(p_range) replaces admin_dashboard(). Verified admin only (is_admin()), one round trip, no audit row
-- (a summary, not a record view; same as 0040). Two kinds of numbers:
--   * current state, never filtered by the period: applications waiting, open reports, jobs in progress, jobs by
--     stage, the "needs attention" list;
--   * the period ('today' = since midnight Karachi time, '7d' / '30d' / '90d' = the last 7 / 30 / 90 days): jobs
--     posted and completed, new workers and residents, reports filed and resolved, and the recent activity list.
-- The old keys stay (jobs_today, stages, attention fields), so a portal that still calls admin_dashboard() keeps working
-- during a deploy.
--
-- Needs attention (at most 15; priority first, then oldest):
--   urgent  unsafe reports
--   high    poor-work reports; suspended workers who still hold a scheduled or in-progress job (one row per job)
--   normal  other open reports, stuck jobs, cancellation requests waiting for staff
--   low     applications waiting for review
-- Recent activity (at most 20, newest first, within the period), from existing records only: registrations
-- (profiles.created_at), verification decisions, job events (posted, quote accepted, completed, cancelled,
-- cancelled by staff, cancellation declined), reports filed and resolved, account suspensions and reactivations
-- (audit_log). Names and record codes only: never a phone number or CNIC.
--
-- admin_jobs_list gains p_stage ('open' = open/interested/quoted, 'scheduled' = accepted/scheduled, 'cash_collected' =
-- cash_collected/reviewed), so a dashboard stage opens a list with the same number of jobs. Everything else is as in
-- 20261113110000.

-- Indexes for the period figures and the activity list ---------------------------------------------------------------
create index if not exists job_events_created_idx on public.job_events (created_at desc);
create index if not exists audit_log_action_created_idx on public.audit_log (action, created_at desc);
create index if not exists reports_resolved_idx on public.reports (resolved_at) where resolved_at is not null;
create index if not exists profiles_created_idx on public.profiles (created_at desc);
create index if not exists verification_decisions_decided_idx on public.verification_decisions (decided_at desc);

-- admin_dashboard ------------------------------------------------------------------------------------------------------
drop function public.admin_dashboard();

create function public.admin_dashboard(p_range text default 'today')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today timestamptz := (date_trunc('day', now() at time zone 'Asia/Karachi')) at time zone 'Asia/Karachi';
  v_from timestamptz;
  v_out jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  v_from := case coalesce(p_range, 'today')
              when 'today' then v_today
              when '7d' then now() - interval '7 days'
              when '30d' then now() - interval '30 days'
              when '90d' then now() - interval '90 days'
            end;
  if v_from is null then
    raise exception 'unknown period' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'range', coalesce(p_range, 'today'),
    'from', v_from,
    'workers_pending', (select jsonb_build_object('count', count(*), 'oldest_since', min(coalesce(verification_updated_at, created_at)))
                          from public.profiles where role = 'worker' and verification_status = 'pending'),
    'residents_pending', (select jsonb_build_object('count', count(*), 'oldest_since', min(coalesce(verification_updated_at, created_at)))
                            from public.profiles where role = 'resident' and verification_status = 'pending'),
    'reports_open', (select jsonb_build_object('count', count(*),
                                               'unsafe', count(*) filter (where kind = 'unsafe'),
                                               'high', count(*) filter (where kind = 'poor_work'))
                       from public.reports where status <> 'resolved'),
    'jobs_today', (select jsonb_build_object(
                     'count', count(*) filter (where posted_at >= v_today and status <> 'draft'),
                     'in_progress', count(*) filter (where status = 'in_progress'))
                     from public.jobs),
    'stages', (select jsonb_build_object(
                 'open', count(*) filter (where status in ('open', 'interested', 'quoted')),
                 'scheduled', count(*) filter (where status in ('accepted', 'scheduled')),
                 'in_progress', count(*) filter (where status = 'in_progress'),
                 'completed', count(*) filter (where status = 'completed'),
                 'cash_collected', count(*) filter (where status in ('cash_collected', 'reviewed')),
                 'disputed', count(*) filter (where status = 'disputed'),
                 'cancelled', count(*) filter (where status = 'cancelled'),
                 'expired', count(*) filter (where status = 'expired'))
                 from public.jobs),
    'period', jsonb_build_object(
      'jobs_posted', (select count(*) from public.jobs where status <> 'draft' and posted_at >= v_from),
      'jobs_completed', (select count(distinct job_id) from public.job_events where event_type = 'completed' and created_at >= v_from),
      'workers_registered', (select count(*) from public.profiles where role = 'worker' and created_at >= v_from),
      'residents_registered', (select count(*) from public.profiles where role = 'resident' and created_at >= v_from),
      'reports_filed', (select count(*) from public.reports where created_at >= v_from),
      'reports_resolved', (select count(*) from public.reports where resolved_at >= v_from)),
    'attention', (select coalesce(jsonb_agg(to_jsonb(a) - 'rank' order by a.rank, a.since, a.id), '[]'::jsonb)
                    from (
                      select * from (
                        -- reports: unsafe = urgent, poor work = high, the rest = normal
                        select r.id::text as id,
                               case when r.kind = 'unsafe' then 'unsafe' else 'report' end as kind,
                               case r.kind when 'unsafe' then 0 when 'poor_work' then 1 else 2 end as rank,
                               case r.kind when 'unsafe' then 'urgent' when 'poor_work' then 'high' else 'normal' end as priority,
                               r.code as ref,
                               r.code || ' · ' || replace(r.kind::text, '_', ' ') as title,
                               j.code || ' · ' || j.title || ' · Phase ' || j.phase as detail,
                               coalesce(rp.full_name, 'Someone') || ' about ' || coalesce(ap.full_name, 'someone') as person,
                               case r.status when 'new' then 'New' else 'In review' end as status,
                               r.created_at as since
                          from public.reports r
                          join public.jobs j on j.id = r.job_id
                          left join public.profiles rp on rp.id = r.reporter_id
                          left join public.profiles ap on ap.id = r.against_id
                         where r.status <> 'resolved'
                        union all
                        -- a suspended worker who still holds a booked or running job
                        select j.id::text, 'suspended_active', 1, 'high', j.code,
                               coalesce(w.full_name, 'A worker') || ' is suspended but still has ' || j.code,
                               j.title || ' · Phase ' || j.phase,
                               coalesce(w.full_name, 'Worker') || ' · for ' || coalesce(rp.full_name, 'a resident'),
                               case j.status when 'in_progress' then 'In progress' else 'Scheduled' end,
                               coalesce(w.suspended_at, j.updated_at)
                          from public.jobs j
                          join public.profiles w on w.id = j.accepted_worker_id
                          left join public.profiles rp on rp.id = j.resident_id
                         where w.account_status = 'suspended' and j.status in ('accepted', 'scheduled', 'in_progress')
                        union all
                        select j.id::text, 'stuck', 2, 'normal', j.code,
                               j.code || ' looks stuck',
                               j.title || ' · ' || coalesce(j.stuck_reason, 'no update'),
                               coalesce(rp.full_name, 'Resident') || coalesce(' · ' || w.full_name, ''),
                               case j.status when 'in_progress' then 'In progress' when 'completed' then 'Completed' else 'Scheduled' end,
                               j.stuck_since
                          from public.jobs j
                          left join public.profiles rp on rp.id = j.resident_id
                          left join public.profiles w on w.id = j.accepted_worker_id
                         where j.stuck_since is not null and j.status in ('scheduled', 'in_progress', 'completed')
                        union all
                        select c.id::text, 'cancellation', 2, 'normal', j.code,
                               'Cancellation requested for ' || j.code,
                               j.title || ' · ' || replace(c.reason_code::text, '_', ' '),
                               coalesce(q.full_name, 'Someone') || ' (' || c.requester_role::text || ')',
                               'Waiting for staff',
                               c.created_at
                          from public.cancellation_requests c
                          join public.jobs j on j.id = c.job_id
                          left join public.profiles q on q.id = c.requester_id
                         where c.status = 'pending'
                        union all
                        select p.id::text, p.role::text, 3, 'low', coalesce(p.full_name, 'An applicant'),
                               coalesce(p.full_name, 'An applicant') || ' is waiting for review',
                               initcap(p.role::text) || ' application',
                               initcap(p.role::text),
                               'Waiting',
                               coalesce(p.verification_updated_at, p.created_at)
                          from public.profiles p
                         where p.role in ('worker', 'resident') and p.verification_status = 'pending'
                      ) u
                      order by u.rank, u.since, u.id
                      limit 15
                    ) a),
    'attention_total', (select (select count(*) from public.reports where status <> 'resolved')
                             + (select count(*) from public.jobs j join public.profiles w on w.id = j.accepted_worker_id
                                 where w.account_status = 'suspended' and j.status in ('accepted', 'scheduled', 'in_progress'))
                             + (select count(*) from public.jobs where stuck_since is not null and status in ('scheduled', 'in_progress', 'completed'))
                             + (select count(*) from public.cancellation_requests where status = 'pending')
                             + (select count(*) from public.profiles where role in ('worker', 'resident') and verification_status = 'pending')),
    'activity', (select coalesce(jsonb_agg(to_jsonb(e) order by e.at desc, e.ref), '[]'::jsonb)
                   from (
                     select * from (
                       select 'registered' as kind, p.role::text as link, p.id::text as link_id,
                              'New ' || p.role::text || ' registered' as text,
                              coalesce(p.full_name, 'No name yet') as ref, p.created_at as at
                         from public.profiles p
                        where p.role in ('worker', 'resident') and p.created_at >= v_from
                       union all
                       select 'verified', p.role::text, p.id::text,
                              initcap(p.role::text) || ' ' || case v.decision when 'approve' then 'approved'
                                                                              when 'ask_for_changes' then 'asked for changes'
                                                                              when 'visit_hq' then 'asked to visit HQ'
                                                                              else 'rejected' end,
                              coalesce(p.full_name, 'Applicant'), v.decided_at
                         from public.verification_decisions v
                         join public.profiles p on p.id = v.profile_id
                        where v.decided_at >= v_from
                       union all
                       select case when e.event_type in ('cancelled', 'cancelled_by_staff', 'cancellation_declined') then 'cancellation' else 'job' end,
                              'job', j.id::text,
                              case e.event_type when 'posted' then 'Job posted'
                                                when 'quote_accepted' then 'Quote accepted, job booked'
                                                when 'completed' then 'Job marked complete'
                                                when 'cancelled' then 'Job cancelled by the resident'
                                                when 'cancelled_by_staff' then 'Job cancelled by staff'
                                                else 'Cancellation request declined' end,
                              j.code || ' · ' || j.title, e.created_at
                         from public.job_events e
                         join public.jobs j on j.id = e.job_id
                        where e.created_at >= v_from
                          and e.event_type in ('posted', 'quote_accepted', 'completed', 'cancelled', 'cancelled_by_staff', 'cancellation_declined')
                       union all
                       select 'report', 'report', r.id::text,
                              'Report filed: ' || replace(r.kind::text, '_', ' '),
                              r.code || ' · ' || j.code, r.created_at
                         from public.reports r join public.jobs j on j.id = r.job_id
                        where r.created_at >= v_from
                       union all
                       select 'report', 'report', r.id::text,
                              'Report resolved' || case r.action when 'warning' then ' with a warning'
                                                                 when 'suspend' then ' and the account suspended'
                                                                 else '' end,
                              r.code || ' · ' || j.code, r.resolved_at
                         from public.reports r join public.jobs j on j.id = r.job_id
                        where r.resolved_at >= v_from
                       union all
                       select 'account', 'user', p.id::text,
                              initcap(p.role::text) || case a.action when 'account_suspended' then ' suspended' else ' reactivated' end,
                              coalesce(p.full_name, 'Account'), a.created_at
                         from public.audit_log a
                         join public.profiles p on p.id::text = a.record_id
                        where a.action in ('account_suspended', 'account_reactivated') and a.table_name = 'profiles'
                          and a.created_at >= v_from
                     ) x
                     order by x.at desc, x.ref
                     limit 20
                   ) e)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.admin_dashboard(text) from public, anon;
grant execute on function public.admin_dashboard(text) to authenticated;

-- admin_jobs_list with p_stage -----------------------------------------------------------------------------------------
drop function public.admin_jobs_list(public.job_status, smallint, smallint, boolean, text, integer, integer);

create function public.admin_jobs_list(
  p_status public.job_status default null,
  p_phase smallint default null,
  p_category smallint default null,
  p_today boolean default false,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0,
  p_stage text default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_today timestamptz := (date_trunc('day', now() at time zone 'Asia/Karachi')) at time zone 'Asia/Karachi';
  v_stage public.job_status[];
  v_like text;
  v_total integer;
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  v_stage := case p_stage
               when 'open' then array['open', 'interested', 'quoted']::public.job_status[]
               when 'scheduled' then array['accepted', 'scheduled']::public.job_status[]
               when 'cash_collected' then array['cash_collected', 'reviewed']::public.job_status[]
             end;
  if p_stage is not null and v_stage is null then
    raise exception 'unknown stage' using errcode = '22023';
  end if;
  v_like := private.like_pattern(p_search);

  with m as (
    select j.id, j.code, j.title, j.status, j.phase, j.updated_at, c.name as category,
           rp.full_name as resident_name, wp.full_name as worker_name,
           coalesce((select q.total from public.quotes q where q.id = j.accepted_quote_id),
                    (select q.total from public.quotes q where q.job_id = j.id and q.status = 'sent' order by q.created_at desc limit 1)) as quote_total,
           (select count(*) from public.reports r where r.job_id = j.id and r.status <> 'resolved') as open_reports,
           exists (select 1 from public.cancellation_requests x where x.job_id = j.id and x.status = 'pending') as cancel_pending,
           j.under_review_reason
      from public.jobs j
      join public.categories c on c.id = j.category_id
      join public.profiles rp on rp.id = j.resident_id
      left join public.profiles wp on wp.id = j.accepted_worker_id
     where j.status <> 'draft'
       and (p_status is null or j.status = p_status)
       and (v_stage is null or j.status = any (v_stage))
       and (p_phase is null or j.phase = p_phase)
       and (p_category is null or j.category_id = p_category)
       and (not coalesce(p_today, false) or coalesce(j.posted_at, j.created_at) >= v_today)
       and (v_like is null or j.id in (
                    select s.id from public.jobs s where s.code ilike v_like
                    union select s.id from public.jobs s where s.title ilike v_like
                    union select s.id from public.jobs s join public.profiles p on p.id = s.resident_id where p.full_name ilike v_like
                    union select s.id from public.jobs s join public.profiles p on p.id = s.accepted_worker_id where p.full_name ilike v_like))
  ), pg as (
    select * from m order by updated_at desc, id limit v_limit offset v_offset
  )
  select (select count(*) from m),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', pg.id, 'code', pg.code, 'title', pg.title, 'status', pg.status, 'phase', pg.phase, 'category', pg.category,
           'updated_at', pg.updated_at, 'resident_name', pg.resident_name, 'worker_name', pg.worker_name,
           'quote_total', pg.quote_total, 'open_reports', pg.open_reports, 'cancel_pending', pg.cancel_pending,
           'under_review_reason', pg.under_review_reason)
           order by pg.updated_at desc, pg.id), '[]'::jsonb)
    into v_total, v_rows
    from pg;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

revoke all on function public.admin_jobs_list(public.job_status, smallint, smallint, boolean, text, integer, integer, text) from public, anon;
grant execute on function public.admin_jobs_list(public.job_status, smallint, smallint, boolean, text, integer, integer, text) to authenticated;
