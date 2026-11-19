-- Migration 0064: Settings page v2 (admin portal A14), release 1.
--
-- Owner request 19 Nov (professional Settings page). Everything here backs a control that really changes behavior, or a
-- read-only view of data that already exists. No existing rule or workflow changes.
--
--   admin_rules_get()                  the editable rules with default, allowed range and who last changed them
--   admin_rules_save(group, values)    saves one section ("jobs" or "workers") after validating every value; audited
--   admin_audit_list(...)              the audit log with filters (admin, action, dates) and paging; read-only
--   admin_staff_activity()             per admin: last sign-in, active sessions, last activity, IP of the latest session
--   admin_signout_other_admins(text)   ends every other admin session (this one stays); needs the words SIGN OUT; audited
--   admin_system_status()              database size, storage use per bucket, push backlog, last scheduled-job runs
--
-- The rules are the app_settings keys the database already reads (private.setting_int, get_setting):
--   jobs:    job_expiry_hours, job_expiry_reminder_hours, max_job_photos, stuck_scheduled_hours,
--            stuck_in_progress_hours, stuck_cash_hours
--   workers: top_rated_min_jobs, top_rated_min_rating
-- The helpline number, the report window and the review window keep their own save (admin_save_settings, 0042).
-- Defaults are the seeded values of 20261027000002: 24, 20, 6, 24, 48, 48, 10 and 4.5 (the owner's decisions).
--
-- Not here on purpose (owner, 19 Nov): staff roles, and anything the apps do not read yet (maintenance mode, disabling
-- registrations, app versions, force update, announcements, feature flags, store links). Those come once the apps honor them.

-- The list of editable rules: one place for names, defaults and limits (the portal reads them through admin_rules_get).
create function private.rule_registry()
returns table (key text, grp text, label text, def numeric, lo numeric, hi numeric, is_int boolean, ord integer)
language sql immutable set search_path = ''
as $$
  select * from (values
    ('job_expiry_hours',         'jobs',    'Open jobs expire after (hours)',                      24::numeric,  6::numeric, 168::numeric, true,  1),
    ('job_expiry_reminder_hours','jobs',    'Reminder to the resident after (hours)',              20::numeric,  1::numeric, 167::numeric, true,  2),
    ('max_job_photos',           'jobs',    'Photos per job (maximum)',                             6::numeric,  1::numeric,  10::numeric, true,  3),
    ('stuck_scheduled_hours',    'jobs',    'Scheduled job counts as stuck after (hours)',         24::numeric,  1::numeric, 168::numeric, true,  4),
    ('stuck_in_progress_hours',  'jobs',    'Job in progress counts as stuck after (hours)',       48::numeric,  1::numeric, 336::numeric, true,  5),
    ('stuck_cash_hours',         'jobs',    'Cash not recorded counts as stuck after (hours)',     48::numeric,  1::numeric, 336::numeric, true,  6),
    ('top_rated_min_jobs',       'workers', 'Completed jobs needed for Top rated',                 10::numeric,  1::numeric, 500::numeric, true,  1),
    ('top_rated_min_rating',     'workers', 'Average rating needed for Top rated',                4.5::numeric,  1::numeric,   5::numeric, false, 2)
  ) as t(key, grp, label, def, lo, hi, is_int, ord);
$$;
revoke all on function private.rule_registry() from public, anon, authenticated;

-- Indexes for the audit viewer ---------------------------------------------------------------------------------------
create index if not exists audit_log_created_idx on public.audit_log (created_at desc, id desc);
create index if not exists audit_log_actor_created_idx on public.audit_log (actor_id, created_at desc);

-- admin_rules_get ------------------------------------------------------------------------------------------------------
create function public.admin_rules_get()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_object_agg(g.grp, g.items), '{}'::jsonb)
            from (select r.grp,
                         jsonb_agg(jsonb_build_object(
                           'key', r.key, 'label', r.label, 'value', coalesce((s.value #>> '{}')::numeric, r.def), 'default', r.def,
                           'min', r.lo, 'max', r.hi, 'integer', r.is_int,
                           'changed_at', case when s.updated_by is null then null else s.updated_at end,
                           'changed_by', p.full_name) order by r.ord) as items
                    from private.rule_registry() r
                    left join public.app_settings s on s.key = r.key
                    left join public.profiles p on p.id = s.updated_by
                   group by r.grp) g);
end;
$$;

-- admin_rules_save -----------------------------------------------------------------------------------------------------
create function public.admin_rules_save(p_group text, p_values jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_new numeric;
  v_cur numeric;
  v_old_json jsonb := '{}'::jsonb;
  v_new_json jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if p_group is null or p_group not in ('jobs', 'workers') then
    raise exception 'unknown settings section';
  end if;
  if jsonb_typeof(p_values) is distinct from 'object' then
    raise exception 'send the settings as one set of values';
  end if;
  if exists (select 1 from jsonb_object_keys(p_values) k
              where k not in (select key from private.rule_registry() where grp = p_group)) then
    raise exception 'unknown setting';
  end if;
  if (select count(*) from jsonb_object_keys(p_values)) <> (select count(*) from private.rule_registry() where grp = p_group) then
    raise exception 'send every setting of this section';
  end if;

  for r in select * from private.rule_registry() where grp = p_group order by ord loop
    if jsonb_typeof(p_values -> r.key) is distinct from 'number' then
      raise exception '% must be a number', r.label;
    end if;
    v_new := (p_values ->> r.key)::numeric;
    if v_new < r.lo or v_new > r.hi then
      raise exception '% must be between % and %', r.label, trim_scale(r.lo), trim_scale(r.hi);
    end if;
    if r.is_int and v_new <> trunc(v_new) then
      raise exception '% must be a whole number', r.label;
    end if;
    if not r.is_int and v_new <> round(v_new, 1) then
      raise exception '% can have one decimal at most', r.label;
    end if;
  end loop;
  if p_group = 'jobs' and (p_values ->> 'job_expiry_reminder_hours')::numeric >= (p_values ->> 'job_expiry_hours')::numeric then
    raise exception 'the reminder must come before the job expires';
  end if;

  for r in select * from private.rule_registry() where grp = p_group order by ord loop
    v_new := (p_values ->> r.key)::numeric;
    select coalesce((s.value #>> '{}')::numeric, r.def) into v_cur from public.app_settings s where s.key = r.key;
    v_cur := coalesce(v_cur, r.def);
    if v_cur <> v_new then
      insert into public.app_settings (key, value, updated_by)
      values (r.key, case when r.is_int then to_jsonb(v_new::integer) else to_jsonb(v_new) end, v_uid)
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
      v_old_json := v_old_json || jsonb_build_object(r.key, v_cur);
      v_new_json := v_new_json || jsonb_build_object(r.key, v_new);
    end if;
  end loop;

  if v_new_json <> '{}'::jsonb then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    values (v_uid, 'rules_saved', 'app_settings', p_group, v_old_json, v_new_json);
  end if;
  return jsonb_build_object('changed', (select count(*) from jsonb_object_keys(v_new_json)));
end;
$$;

-- admin_audit_list -----------------------------------------------------------------------------------------------------
create function public.admin_audit_list(
  p_actor uuid default null,
  p_action text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_from timestamptz := case when p_from is null then null else p_from::timestamp at time zone 'Asia/Karachi' end;
  v_to timestamptz := case when p_to is null then null else (p_to + 1)::timestamp at time zone 'Asia/Karachi' end;
  v_action text := nullif(btrim(coalesce(p_action, '')), '');
  v_total integer;
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;

  with m as (
    select a.id, a.created_at, a.actor_id, a.action, a.table_name, a.record_id, a.old_data, a.new_data, a.reason
      from public.audit_log a
     where (p_actor is null or a.actor_id = p_actor)
       and (v_action is null or a.action = v_action)
       and (v_from is null or a.created_at >= v_from)
       and (v_to is null or a.created_at < v_to)
  ), pg as (
    select * from m order by created_at desc, id desc limit v_limit offset v_offset
  )
  select (select count(*) from m),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', pg.id, 'at', pg.created_at, 'actor_id', pg.actor_id, 'actor', p.full_name, 'action', pg.action,
           'table', pg.table_name, 'record', pg.record_id, 'old', pg.old_data, 'new', pg.new_data, 'reason', pg.reason)
           order by pg.created_at desc, pg.id desc), '[]'::jsonb)
    into v_total, v_rows
    from pg left join public.profiles p on p.id = pg.actor_id;

  return jsonb_build_object(
    'total', v_total,
    'rows', v_rows,
    'actions', (select coalesce(jsonb_agg(x.action order by x.action), '[]'::jsonb) from (select distinct action from public.audit_log) x),
    'admins', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name, p.id), '[]'::jsonb)
                 from public.profiles p where p.role = 'admin'));
end;
$$;

-- admin_staff_activity -------------------------------------------------------------------------------------------------
create function public.admin_staff_activity()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', p.id, 'last_sign_in_at', u.last_sign_in_at, 'active_sessions', coalesce(s.n, 0),
                   'last_active_at', s.last_at, 'last_ip', s.ip) order by p.created_at, p.id), '[]'::jsonb)
            from public.profiles p
            left join auth.users u on u.id = p.id
            left join lateral (
              select count(*) as n,
                     max(coalesce(x.refreshed_at, x.updated_at, x.created_at)) as last_at,
                     (array_agg(host(x.ip) order by coalesce(x.refreshed_at, x.updated_at, x.created_at) desc))[1] as ip
                from auth.sessions x
               where x.user_id = p.id and (x.not_after is null or x.not_after > now())) s on true
           where p.role = 'admin');
end;
$$;

-- admin_signout_other_admins -------------------------------------------------------------------------------------------
create function public.admin_signout_other_admins(p_confirm text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'SIGN OUT' then
    raise exception 'type SIGN OUT to confirm';
  end if;
  with d as (
    delete from auth.sessions s using public.profiles p
     where s.user_id = p.id and p.role = 'admin' and s.id is distinct from v_sid
    returning s.id)
  select count(*) into v_n from d;
  insert into public.audit_log (actor_id, action, table_name, new_data)
  values (v_uid, 'admins_signed_out', 'profiles', jsonb_build_object('sessions_ended', v_n));
  return jsonb_build_object('ended', v_n);
end;
$$;

-- admin_system_status --------------------------------------------------------------------------------------------------
create function public.admin_system_status()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cron jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', j.jobname, 'last_run_at', d.start_time, 'status', d.status) order by j.jobname), '[]'::jsonb)
      into v_cron
      from cron.job j
      left join lateral (select start_time, status from cron.job_run_details where jobid = j.jobid order by start_time desc limit 1) d on true
     where j.jobname like 'dw-%';
  exception when others then
    v_cron := null;   -- the scheduler is not readable here: the portal says so instead of guessing
  end;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'storage', (select coalesce(jsonb_agg(jsonb_build_object('bucket', t.bucket_id, 'objects', t.n, 'bytes', t.b) order by t.bucket_id), '[]'::jsonb)
                  from (select bucket_id, count(*) as n, coalesce(sum((metadata ->> 'size')::bigint), 0) as b
                          from storage.objects group by bucket_id) t),
    'push', jsonb_build_object(
      'waiting_24h', (select count(*) from public.notifications where push_sent_at is null and created_at > now() - interval '24 hours'),
      'last_sent_at', (select max(push_sent_at) from public.notifications)),
    'active_admins', (select count(*) from public.profiles where role = 'admin' and account_status = 'active'),
    'cron', v_cron);
end;
$$;

-- Grants: staff (signed-in) only; each function checks is_admin() itself ---------------------------------------------
revoke all on function
  public.admin_rules_get(),
  public.admin_rules_save(text, jsonb),
  public.admin_audit_list(uuid, text, date, date, integer, integer),
  public.admin_staff_activity(),
  public.admin_signout_other_admins(text),
  public.admin_system_status()
from public, anon;
grant execute on function
  public.admin_rules_get(),
  public.admin_rules_save(text, jsonb),
  public.admin_audit_list(uuid, text, date, date, integer, integer),
  public.admin_staff_activity(),
  public.admin_signout_other_admins(text),
  public.admin_system_status()
to authenticated;
