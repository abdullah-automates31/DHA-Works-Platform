-- Migration 0054: staff can let a rejected applicant apply again.
--
-- A rejected application used to be final: the worker (or resident) saw "not approved" for good. Now a verified admin who has
-- typed a fresh code can reopen it. The application goes back to 'needs_changes', which both apps already handle: the person
-- sees the reason staff wrote, can fix their details and documents, and sends the application again (it then waits as
-- 'pending' for a normal decision). Nothing is deleted; documents, references and earlier decisions stay.
--
-- No new enum value is needed (a new value could not be used in the same migration): the decision row is recorded as
-- 'ask_for_changes', the audit row is 'verification_reopened', and the person gets the usual 'verification_decided' notice.

create function public.admin_reopen_rejected(p_profile uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if p_profile = v_uid then
    raise exception 'you cannot decide on your own account';
  end if;
  select * into v_p from public.profiles where id = p_profile and role in ('worker', 'resident') for update;
  if not found then
    raise exception 'no such application';
  end if;
  if v_p.verification_status <> 'rejected' then
    raise exception 'only a rejected application can be opened again';
  end if;
  if v_p.account_status <> 'active' then
    raise exception 'this account is suspended';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'write a reason the applicant will see';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'the reason is too long (500 characters at most)';
  end if;

  insert into public.verification_decisions (profile_id, decision, reason, checklist, decided_by)
  values (p_profile, 'ask_for_changes', v_reason, '{}'::jsonb, v_uid);
  update public.profiles
     set verification_status = 'needs_changes', verification_reason = v_reason, verification_updated_at = now()
   where id = p_profile;
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data, reason)
  values (v_uid, 'verification_reopened', 'profiles', p_profile::text,
          jsonb_build_object('status', v_p.verification_status), jsonb_build_object('status', 'needs_changes'), v_reason);
  perform private.notify(p_profile, 'verification_decided', null,
    jsonb_build_object('decision', 'ask_for_changes', 'reason', v_reason));
end;
$$;

revoke all on function public.admin_reopen_rejected(uuid, text) from public, anon;
grant execute on function public.admin_reopen_rejected(uuid, text) to authenticated;
