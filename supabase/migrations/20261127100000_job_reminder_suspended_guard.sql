-- The one-hour visit reminder (0058) must not reach a suspended worker.
-- Suspended workers get no push for anything (see the dues and notice rules), and the sweep was the one place that
-- still reminded them. Only the sweep changes: the rest of the rule (the switch, once per visit, the hour window) stays.
-- Found by supabase/tests/job_reminder_sweep.test.sql (26 Nov, E2E review of the reminder feature).

create or replace function private.send_job_reminders()
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
      join public.profiles p on p.id = j.accepted_worker_id
      join public.quotes q on q.id = j.accepted_quote_id
     where j.status = 'scheduled'
       and j.worker_reminded_at is null
       and wd.job_reminders
       -- a suspended worker gets no push and cannot read notices: no reminder either (stays unsent until reinstated)
       and p.account_status = 'active'
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
