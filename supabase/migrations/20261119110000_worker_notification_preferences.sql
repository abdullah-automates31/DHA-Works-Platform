-- Migration 0065 (19 Nov): the worker app's Settings > Notifications screen gets switches that really work.
--
-- Before this, the only switch was worker_details.job_reminders (0058). Four more are added, one per kind of
-- notice a worker can turn off. They control PUSH only: the notice itself always appears in the in-app list, so
-- nothing is ever hidden from the worker, they just are not buzzed for it.
--
--   notify_new_jobs        'new_job'                          (a job in my trade and area was posted)
--   notify_job_updates     every other job notice             (quote accepted or not, replaced, cancelled, cash ...)
--   notify_report_updates  'report_*' except report_warning   (my report was received, is reviewed, is resolved)
--   notify_announcements   'staff_message'                    (a message from DHA staff)
--
-- Never switchable (account safety and things that need an answer): verification_decided, account_suspended,
-- account_reactivated, report_warning, busy_eta_needed, busy_eta_expired. job_reminder keeps its own switch.
--
-- How it is enforced: a BEFORE INSERT trigger on notifications. For a worker who switched a kind off it stamps
-- push_sent_at, which means "handled" to send-push and to the retry cron, so no push is made. No Edge Function
-- change is needed. Residents and staff are never touched.

alter table public.worker_details
  add column notify_new_jobs boolean not null default true,
  add column notify_job_updates boolean not null default true,
  add column notify_report_updates boolean not null default true,
  add column notify_announcements boolean not null default true;

comment on column public.worker_details.notify_new_jobs is 'Push for new jobs in my trade and area (the in-app notice always appears).';
comment on column public.worker_details.notify_job_updates is 'Push for job notices (quote accepted, replaced, cancelled, cash ...).';
comment on column public.worker_details.notify_report_updates is 'Push for updates on my reports (not warnings).';
comment on column public.worker_details.notify_announcements is 'Push for messages from DHA staff.';

create function public.set_notification_preference(p_key text, p_value boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker', false);
begin
  if p_value is null then
    raise exception 'choose on or off';
  end if;
  case p_key
    when 'new_jobs' then update public.worker_details set notify_new_jobs = p_value where profile_id = v_uid;
    when 'job_updates' then update public.worker_details set notify_job_updates = p_value where profile_id = v_uid;
    when 'report_updates' then update public.worker_details set notify_report_updates = p_value where profile_id = v_uid;
    when 'announcements' then update public.worker_details set notify_announcements = p_value where profile_id = v_uid;
    else raise exception 'unknown notification setting';
  end case;
end;
$$;
revoke all on function public.set_notification_preference(text, boolean) from public, anon;
grant execute on function public.set_notification_preference(text, boolean) to authenticated;

create function private.apply_push_preferences()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_wd public.worker_details;
begin
  if new.push_sent_at is not null then
    return new;
  end if;
  select wd.* into v_wd
  from public.worker_details wd
  join public.profiles p on p.id = wd.profile_id
  where wd.profile_id = new.user_id and p.role = 'worker';
  if not found then
    return new;
  end if;
  if (new.type = 'new_job' and not v_wd.notify_new_jobs)
     or (new.type = 'staff_message' and not v_wd.notify_announcements)
     or (new.type like 'report\_%' and new.type <> 'report_warning' and not v_wd.notify_report_updates)
     or (new.type not in ('new_job', 'staff_message', 'job_reminder', 'verification_decided', 'account_suspended',
                          'account_reactivated', 'report_warning', 'busy_eta_needed', 'busy_eta_expired')
         and new.type not like 'report\_%' and not v_wd.notify_job_updates) then
    new.push_sent_at := now();   -- handled: send-push and the retry cron skip it; the in-app notice stays
  end if;
  return new;
end;
$$;
revoke all on function private.apply_push_preferences() from public, anon, authenticated;

create trigger notifications_push_preferences
  before insert on public.notifications
  for each row execute function private.apply_push_preferences();

-- ---------------------------------------------------------------------------
-- Settings > Verification and documents: which documents the worker has sent, and when.
-- Since 0006 a worker cannot read their own verification_documents once the application is submitted ("no read-back"),
-- so the screen could not show a date. This returns ONLY the document type and the upload time (never the file path)
-- and the number of references, for the signed-in worker. The files themselves stay unreadable.
create function public.get_my_document_summary()
returns table (doc_type public.document_type, uploaded_at timestamptz, reference_count integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker', false);
  v_refs integer;
begin
  select count(*)::integer into v_refs from public.worker_references where worker_id = v_uid;
  return query
    select d.doc_type, d.uploaded_at, v_refs
    from public.verification_documents d
    where d.profile_id = v_uid
    order by d.doc_type;
  if not found then
    return query select null::public.document_type, null::timestamptz, v_refs;
  end if;
end;
$$;
revoke all on function public.get_my_document_summary() from public, anon;
grant execute on function public.get_my_document_summary() to authenticated;
