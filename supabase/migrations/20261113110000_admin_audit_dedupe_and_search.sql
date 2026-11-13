-- 0050: quieter audit trail for detail views, and an index-friendly jobs search (audit 13 Nov 2026, findings 7a and 7c).
--
--   * The user, verification and report detail screens wrote one audit row on every view, so a reload (or a refresh of
--     a page left open) filled the log with duplicates. A view is now recorded once per person, record and 10 minutes.
--     Actions (decisions, notes, suspensions) are unaffected: only the *_viewed rows are de-duplicated.
--   * The jobs search matched code, title and both names with one OR across joined tables, which no index can serve.
--     It is now four small searches (code; title; resident name; worker name) combined by id, each of which can use a
--     trigram index, and the three indexes below are created for them (pg_trgm). Results are unchanged.
-- Functions are re-created exactly as they are today apart from those two changes; signatures and grants are unchanged.

create extension if not exists pg_trgm with schema extensions;
create index if not exists jobs_code_trgm_idx on public.jobs using gin (code extensions.gin_trgm_ops);
create index if not exists jobs_title_trgm_idx on public.jobs using gin (title extensions.gin_trgm_ops);
create index if not exists profiles_full_name_trgm_idx on public.profiles using gin (full_name extensions.gin_trgm_ops);

-- admin_user_detail (was in 20261107000042_admin_users_reviews_settings.sql)
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
    'account_status', v_p.account_status, 'suspended_at', v_p.suspended_at, 'suspension_reason', v_p.suspension_reason,
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

-- admin_verification_detail (was in 20261107000038_admin_verification.sql)
create or replace function public.admin_verification_detail(p_profile uuid)
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
  select * into v_p from public.profiles where id = p_profile and role in ('worker', 'resident');
  if not found or v_p.verification_status = 'incomplete' then
    raise exception 'no such application';
  end if;

  v_out := jsonb_build_object(
    'id', v_p.id, 'role', v_p.role, 'full_name', v_p.full_name, 'phone', v_p.phone, 'email', v_p.email,
    'gender', v_p.gender, 'date_of_birth', v_p.date_of_birth,
    'cnic_masked', case when v_p.cnic is null then null else left(v_p.cnic, 5) || '-*******-' || right(v_p.cnic, 1) end,
    'status', v_p.verification_status, 'reason', v_p.verification_reason,
    'submitted_at', v_p.verification_updated_at, 'created_at', v_p.created_at, 'avatar_path', v_p.avatar_path,
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('type', d.doc_type, 'path', d.storage_path, 'uploaded_at', d.uploaded_at)
                                            order by d.doc_type), '[]'::jsonb)
                    from public.verification_documents d where d.profile_id = p_profile),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('decision', x.decision, 'reason', x.reason, 'decided_at', x.decided_at,
                                                            'decided_by_name', (select full_name from public.profiles where id = x.decided_by))
                                          order by x.decided_at desc), '[]'::jsonb)
                  from public.verification_decisions x where x.profile_id = p_profile));

  if v_p.role = 'worker' then
    v_out := v_out || jsonb_build_object(
      'worker', (select jsonb_build_object('experience_years', w.experience_years, 'about', w.about, 'voice_intro_path', w.voice_intro_path)
                   from public.worker_details w where w.profile_id = p_profile),
      'categories', (select coalesce(jsonb_agg(c.name order by c.sort), '[]'::jsonb)
                       from public.worker_categories wc join public.categories c on c.id = wc.category_id where wc.worker_id = p_profile),
      'phases', (select coalesce(jsonb_agg(wa.phase order by wa.phase), '[]'::jsonb) from public.worker_areas wa where wa.worker_id = p_profile),
      'references', (select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'phone', r.phone, 'address', r.address)), '[]'::jsonb)
                       from public.worker_references r where r.worker_id = p_profile));
  else
    v_out := v_out || jsonb_build_object(
      'addresses', (select coalesce(jsonb_agg(jsonb_build_object('label', a.label, 'phase', a.phase, 'lane', a.lane, 'plot_no', a.plot_no, 'floor', a.floor)
                                              order by a.is_default desc, a.created_at), '[]'::jsonb)
                      from public.addresses a where a.resident_id = p_profile));
  end if;

  insert into public.audit_log (actor_id, action, table_name, record_id)
    select auth.uid(), 'verification_viewed', 'profiles', p_profile::text
     where not exists (select 1 from public.audit_log a
                        where a.table_name = 'profiles' and a.record_id = p_profile::text
                          and a.actor_id = auth.uid() and a.action = 'verification_viewed'
                          and a.created_at > now() - interval '10 minutes');
  return v_out;
end;
$$;

-- admin_report_detail (was in 20261107000041_admin_operations.sql)
create or replace function public.admin_report_detail(p_report uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.reports;
  v_j public.jobs;
  v_out jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  select * into v_r from public.reports where id = p_report;
  if not found then
    raise exception 'no such case';
  end if;
  select * into v_j from public.jobs where id = v_r.job_id;

  v_out := jsonb_build_object(
    'report', jsonb_build_object(
      'id', v_r.id, 'code', v_r.code, 'kind', v_r.kind, 'status', v_r.status, 'action', v_r.action,
      'action_reason', v_r.action_reason, 'reason_text', v_r.reason_text, 'system_generated', v_r.system_generated,
      'created_at', v_r.created_at, 'resolved_at', v_r.resolved_at, 'assigned_to', v_r.assigned_to,
      'assigned_to_name', (select full_name from public.profiles where id = v_r.assigned_to)),
    'reporter', (select jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'role', v_r.reporter_role, 'phone', p.phone, 'account_status', p.account_status,
        'detail', case when v_r.reporter_role = 'worker'
                       then (select string_agg(c.name, ', ' order by c.sort) from public.worker_categories wc
                               join public.categories c on c.id = wc.category_id where wc.worker_id = p.id)
                       else 'Phase ' || v_j.phase || ', ' || v_j.lane end)
                   from public.profiles p where p.id = v_r.reporter_id),
    'against', (select jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'role', p.role, 'phone', p.phone, 'account_status', p.account_status,
        'detail', case when p.role = 'worker'
                       then (select string_agg(c.name, ', ' order by c.sort) from public.worker_categories wc
                               join public.categories c on c.id = wc.category_id where wc.worker_id = p.id)
                       else 'Phase ' || v_j.phase || ', ' || v_j.lane end)
                  from public.profiles p where p.id = v_r.against_id),
    'job', jsonb_build_object(
      'id', v_j.id, 'code', v_j.code, 'title', v_j.title, 'status', v_j.status, 'phase', v_j.phase, 'lane', v_j.lane,
      'plot_no', (select plot_no from public.job_private where job_id = v_j.id),
      'started_at', v_j.started_at,
      'quote_total', (select total from public.quotes where id = v_j.accepted_quote_id)),
    'photos', (select coalesce(jsonb_agg(storage_path order by id), '[]'::jsonb) from public.report_photos where report_id = p_report),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'note', n.note, 'created_at', n.created_at,
                                                          'author_name', (select full_name from public.profiles where id = n.author_id))
                                       order by n.created_at), '[]'::jsonb)
                from public.report_notes n where n.report_id = p_report),
    'calls', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'called_id', c.called_id, 'called_name', (select full_name from public.profiles where id = c.called_id),
                                                          'outcome', c.outcome, 'called_at', c.called_at,
                                                          'called_by_name', (select full_name from public.profiles where id = c.called_by))
                                       order by c.called_at), '[]'::jsonb)
                from public.report_calls c where c.report_id = p_report));

  insert into public.audit_log (actor_id, action, table_name, record_id)
    select auth.uid(), 'report_viewed', 'reports', p_report::text
     where not exists (select 1 from public.audit_log a
                        where a.table_name = 'reports' and a.record_id = p_report::text
                          and a.actor_id = auth.uid() and a.action = 'report_viewed'
                          and a.created_at > now() - interval '10 minutes');
  return v_out;
end;
$$;

-- admin_jobs_list (was in 20261107000041_admin_operations.sql)
create or replace function public.admin_jobs_list(
  p_status public.job_status default null,
  p_phase smallint default null,
  p_category smallint default null,
  p_today boolean default false,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_today timestamptz := (date_trunc('day', now() at time zone 'Asia/Karachi')) at time zone 'Asia/Karachi';
  v_like text;
  v_total integer;
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
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
