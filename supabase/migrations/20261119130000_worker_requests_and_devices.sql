-- Migration 0067 (19 Nov): worker requests (support, replace a document after approval, name and number change alerts)
-- and "my phones" with sign-out of the other phones. All for the worker app's Settings and the admin portal's Requests page.
--
-- One table, worker_requests, holds four kinds of item that staff must see:
--   support       a message from the worker; staff answer it (status open -> done, staff_reply). The answer reaches the worker as a notice.
--   document      a new CNIC / police certificate / photo from an APPROVED worker; staff approve or reject (reason needed).
--                 Approving swaps the verification file; rejecting keeps the old one. The worker is told either way.
--   name_change   written automatically when a worker changes their name (0066); staff mark it reviewed.
--   phone_change  written automatically when a worker's sign-in number moves (0066); staff mark it reviewed.
-- The table has no grants: the apps reach it only through the functions below (worker) and admin_* functions (staff).

create table public.worker_requests (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('support', 'document', 'name_change', 'phone_change')),
  status text not null default 'open' check (status in ('open', 'done', 'approved', 'rejected')),
  subject text check (char_length(subject) <= 80),
  body text check (char_length(body) <= 1000),
  doc_type public.document_type,
  storage_path text,
  old_value text,
  new_value text,
  staff_reply text check (char_length(staff_reply) <= 1000),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind <> 'document' or (doc_type is not null and storage_path is not null))
);
alter table public.worker_requests enable row level security;   -- no policy and no grant: closed to every app role
create index worker_requests_worker_idx on public.worker_requests (worker_id, created_at desc);
create index worker_requests_open_idx on public.worker_requests (status, kind, created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- Name and number changes now leave a request for staff (replaces 0066's functions, same behaviour plus the row).
create or replace function public.change_my_name(p_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker', false);
  v_new text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_old text;
begin
  if char_length(v_new) = 0 or char_length(v_new) > 100 or v_new !~ '[[:alpha:]]' then
    raise exception 'enter your full name';
  end if;
  select full_name into v_old from public.profiles where id = v_uid;
  if v_old is not distinct from v_new then
    return;
  end if;
  update public.profiles set full_name = v_new where id = v_uid;
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  values (v_uid, 'worker_changed_name', 'profiles', v_uid::text,
          jsonb_build_object('full_name', v_old), jsonb_build_object('full_name', v_new));
  insert into public.worker_requests (worker_id, kind, old_value, new_value) values (v_uid, 'name_change', v_old, v_new);
end;
$$;

create or replace function public.sync_profile_phone()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if nullif(old.phone, '') is not null and nullif(new.phone, '') is not null and new.phone is distinct from old.phone then
    update public.profiles set phone = '+' || new.phone where id = new.id;
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    values (new.id, 'worker_changed_phone', 'profiles', new.id::text,
            jsonb_build_object('phone', '+' || old.phone), jsonb_build_object('phone', '+' || new.phone));
    insert into public.worker_requests (worker_id, kind, old_value, new_value)
    select new.id, 'phone_change', '+' || old.phone, '+' || new.phone
    where exists (select 1 from public.profiles where id = new.id and role = 'worker');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Worker: support message, document update, my requests
create function public.submit_support_request(p_subject text, p_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker', false);
  v_subject text := btrim(coalesce(p_subject, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if char_length(v_subject) < 3 or char_length(v_subject) > 80 then
    raise exception 'write a short title of 3 to 80 characters';
  end if;
  if char_length(v_body) < 5 or char_length(v_body) > 1000 then
    raise exception 'describe the problem in 5 to 1000 characters';
  end if;
  if (select count(*) from public.worker_requests where worker_id = v_uid and kind = 'support' and status = 'open') >= 3 then
    raise exception 'you already have 3 open messages; wait for DHA to answer';
  end if;
  if (select count(*) from public.worker_requests where worker_id = v_uid and kind = 'support' and created_at > now() - interval '1 day') >= 5 then
    raise exception 'you sent 5 messages today; try again tomorrow';
  end if;
  insert into public.worker_requests (worker_id, kind, subject, body) values (v_uid, 'support', v_subject, v_body) returning id into v_id;
  return v_id;
end;
$$;

create function public.submit_document_update(p_type public.document_type, p_path text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker', false);
  v_status public.verification_status;
  v_id uuid;
begin
  select verification_status into v_status from public.profiles where id = v_uid;
  if v_status is distinct from 'approved' then
    raise exception 'use the application screens until DHA staff approve you';
  end if;
  if p_path is null or p_path not like v_uid::text || '/update-%' or p_path like '%..%' or char_length(p_path) > 300 then
    raise exception 'invalid file path';
  end if;
  if (select count(*) from public.worker_requests where worker_id = v_uid and kind = 'document' and created_at > now() - interval '1 day') >= 6 then
    raise exception 'too many document updates today; try again tomorrow';
  end if;
  -- a newer file for the same document replaces the one still waiting
  delete from public.worker_requests where worker_id = v_uid and kind = 'document' and status = 'open' and doc_type = p_type;
  insert into public.worker_requests (worker_id, kind, doc_type, storage_path, subject)
  values (v_uid, 'document', p_type, p_path, p_type::text) returning id into v_id;
  return v_id;
end;
$$;

create function public.my_requests(p_limit integer default 30)
returns table (id uuid, kind text, status text, subject text, body text, doc_type public.document_type,
               staff_reply text, created_at timestamptz, decided_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker', false);
begin
  return query
    select r.id, r.kind, r.status, r.subject, r.body, r.doc_type, r.staff_reply, r.created_at, r.decided_at
      from public.worker_requests r
     where r.worker_id = v_uid and r.kind in ('support', 'document')
     order by r.created_at desc
     limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- the identity bucket accepts an approved worker's NEW file, but only a clearly named update file
drop policy identity_owner_upload on storage.objects;
create policy identity_owner_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'identity'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.profiles p
                where p.id = (select auth.uid())
                  and (p.verification_status in ('incomplete', 'needs_changes')
                       or (p.verification_status = 'approved' and p.role = 'worker' and storage.filename(name) like 'update-%')))
    and public.can_upload_media('identity')
  );

-- ---------------------------------------------------------------------------------------------------------------
-- Staff
create function public.admin_requests_list(p_kind text default null, p_status text default 'open', p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if p_kind is not null and p_kind not in ('support', 'document', 'name_change', 'phone_change', 'changes') then
    raise exception 'unknown kind';
  end if;
  if p_status is not null and p_status not in ('open', 'closed') then
    raise exception 'status must be open or closed';
  end if;
  with m as (
    select r.*, p.full_name as worker_name, p.phone as worker_phone
      from public.worker_requests r join public.profiles p on p.id = r.worker_id
     where (p_kind is null or r.kind = p_kind or (p_kind = 'changes' and r.kind in ('name_change', 'phone_change')))
       and (p_status is null or (p_status = 'open' and r.status = 'open') or (p_status = 'closed' and r.status <> 'open'))
  ), pg as (
    select * from m order by (status = 'open') desc, created_at desc, id limit v_limit offset v_offset
  )
  select (select count(*) from m),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', pg.id, 'worker_id', pg.worker_id, 'worker_name', pg.worker_name, 'worker_phone', pg.worker_phone,
           'kind', pg.kind, 'status', pg.status, 'subject', pg.subject, 'body', pg.body, 'doc_type', pg.doc_type,
           'storage_path', pg.storage_path, 'old_value', pg.old_value, 'new_value', pg.new_value,
           'staff_reply', pg.staff_reply, 'created_at', pg.created_at, 'decided_at', pg.decided_at)
           order by (pg.status = 'open') desc, pg.created_at desc, pg.id), '[]'::jsonb)
    into v_total, v_rows from pg;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

create function public.admin_requests_counts()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
    'open', count(*) filter (where status = 'open'),
    'support', count(*) filter (where status = 'open' and kind = 'support'),
    'document', count(*) filter (where status = 'open' and kind = 'document'),
    'changes', count(*) filter (where status = 'open' and kind in ('name_change', 'phone_change')))
    from public.worker_requests);
end;
$$;

create function public.admin_request_reply(p_id uuid, p_reply text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_reply text := btrim(coalesce(p_reply, ''));
  v_r public.worker_requests;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if char_length(v_reply) < 2 or char_length(v_reply) > 1000 then
    raise exception 'write an answer of 2 to 1000 characters';
  end if;
  select * into v_r from public.worker_requests where id = p_id for update;
  if not found or v_r.kind <> 'support' then
    raise exception 'request not found';
  end if;
  if v_r.status <> 'open' then
    raise exception 'this message was already answered';
  end if;
  update public.worker_requests set status = 'done', staff_reply = v_reply, decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform private.notify(v_r.worker_id, 'staff_message', null, jsonb_build_object('text', 'DHA answered "' || v_r.subject || '": ' || v_reply));
  insert into public.audit_log (actor_id, action, table_name, record_id, reason)
  values (auth.uid(), 'support_answered', 'worker_requests', p_id::text, left(v_reply, 200));
end;
$$;

create function public.admin_request_decide(p_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_r public.worker_requests;
  v_label text;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'choose approve or reject';
  end if;
  if p_decision = 'reject' and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'write the reason for the worker (at least 3 characters)';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'the reason is too long';
  end if;
  select * into v_r from public.worker_requests where id = p_id for update;
  if not found or v_r.kind <> 'document' then
    raise exception 'request not found';
  end if;
  if v_r.status <> 'open' then
    raise exception 'this request was already decided';
  end if;
  v_label := case v_r.doc_type when 'cnic_front' then 'CNIC (front)' when 'cnic_back' then 'CNIC (back)'
                               when 'police_cert' then 'police certificate' else 'profile photo' end;
  if p_decision = 'approve' then
    insert into public.verification_documents (profile_id, doc_type, storage_path)
    values (v_r.worker_id, v_r.doc_type, v_r.storage_path)
    on conflict (profile_id, doc_type) do update set storage_path = excluded.storage_path, uploaded_at = now();
    if v_r.doc_type = 'profile_photo' then
      update public.profiles set avatar_path = v_r.storage_path where id = v_r.worker_id;
    end if;
    update public.worker_requests set status = 'approved', staff_reply = v_reason, decided_by = auth.uid(), decided_at = now() where id = p_id;
    perform private.notify(v_r.worker_id, 'staff_message', null, jsonb_build_object('text', 'DHA approved your new ' || v_label || '.'));
  else
    update public.worker_requests set status = 'rejected', staff_reply = v_reason, decided_by = auth.uid(), decided_at = now() where id = p_id;
    perform private.notify(v_r.worker_id, 'staff_message', null, jsonb_build_object('text', 'DHA did not accept your new ' || v_label || ': ' || v_reason));
  end if;
  insert into public.audit_log (actor_id, action, table_name, record_id, reason)
  values (auth.uid(), 'document_update_' || p_decision, 'worker_requests', p_id::text, v_reason);
end;
$$;

create function public.admin_request_ack(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  update public.worker_requests set status = 'done', decided_by = auth.uid(), decided_at = now()
   where id = p_id and kind in ('name_change', 'phone_change') and status = 'open';
  if not found then
    raise exception 'request not found';
  end if;
  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (auth.uid(), 'change_reviewed', 'worker_requests', p_id::text);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Worker: my phones and sign-out of the other phones
create function public.my_sessions()
returns table (id uuid, created_at timestamptz, last_active timestamptz, user_agent text, is_current boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker', false);
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  return query
    select s.id, s.created_at, coalesce(s.refreshed_at, s.updated_at, s.created_at), left(s.user_agent, 120), (s.id = v_sid)
      from auth.sessions s
     where s.user_id = v_uid and (s.not_after is null or s.not_after > now())
     order by (s.id = v_sid) desc, coalesce(s.refreshed_at, s.updated_at, s.created_at) desc;
end;
$$;

create function public.sign_out_other_sessions(p_keep_token text default null)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker', false);
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_n integer;
begin
  if v_sid is null then
    raise exception 'sign in again first';
  end if;
  with d as (delete from auth.sessions where user_id = v_uid and id <> v_sid returning 1)
  select count(*)::integer into v_n from d;
  -- the other phones must stop receiving pushes too: keep only this phone's registration
  delete from public.device_tokens where user_id = v_uid and push_token is distinct from p_keep_token;
  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (v_uid, 'worker_signed_out_other_phones', 'profiles', v_uid::text, jsonb_build_object('sessions', v_n));
  return v_n;
end;
$$;

-- grants: apps get exactly these functions
revoke all on function public.submit_support_request(text, text), public.submit_document_update(public.document_type, text),
  public.my_requests(integer), public.my_sessions(), public.sign_out_other_sessions(text),
  public.admin_requests_list(text, text, integer, integer), public.admin_requests_counts(),
  public.admin_request_reply(uuid, text), public.admin_request_decide(uuid, text, text), public.admin_request_ack(uuid)
  from public, anon;
grant execute on function public.submit_support_request(text, text), public.submit_document_update(public.document_type, text),
  public.my_requests(integer), public.my_sessions(), public.sign_out_other_sessions(text),
  public.admin_requests_list(text, text, integer, integer), public.admin_requests_counts(),
  public.admin_request_reply(uuid, text), public.admin_request_decide(uuid, text, text), public.admin_request_ack(uuid)
  to authenticated;
