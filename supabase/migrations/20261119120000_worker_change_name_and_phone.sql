-- Migration 0066 (19 Nov): a worker can change their name and sign-in phone number from Settings (owner decision, 19 Nov).
--
-- Two earlier rules are relaxed, each with its own safeguard:
--
--  1. Phone (0034 "no change-number feature", Shariq 6 Nov). A WORKER'S sign-in number may now change, but only through
--     the normal code flow: the app asks for the new number (auth.updateUser), a code is sent to the NEW number, and
--     the number changes only when that code is confirmed. The lock keeps these rules for everyone:
--       - a customer or staff account stays locked exactly as before;
--       - a number never changes to empty;
--       - a worker's number may only become the number a code was sent to (old.phone_change), never an arbitrary value;
--       - the profile's contact phone follows the new number at once, and the change is written to the audit log.
--  2. Name. update_my_profile still locks name after approval. A new function change_my_name lets an approved worker
--     change it; every change is written to the audit log with the old and new name, so staff can compare it with the
--     CNIC (admin portal > Settings > Audit log).

create or replace function public.lock_login_phone()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_worker boolean := exists (select 1 from public.profiles where id = old.id and role = 'worker');
begin
  if nullif(old.phone, '') is not null and new.phone is distinct from old.phone then
    if not v_worker
       or nullif(new.phone, '') is null
       or new.phone is distinct from nullif(old.phone_change, '') then
      raise exception 'the sign-in number cannot be changed' using errcode = 'P0001';
    end if;
  end if;
  if nullif(new.phone_change, '') is not null and new.phone_change is distinct from old.phone_change and not v_worker then
    raise exception 'the sign-in number cannot be changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- After a confirmed change the contact phone on the profile follows, and the move is recorded.
create function public.sync_profile_phone()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if nullif(old.phone, '') is not null and nullif(new.phone, '') is not null and new.phone is distinct from old.phone then
    update public.profiles set phone = '+' || new.phone where id = new.id;
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    values (new.id, 'worker_changed_phone', 'profiles', new.id::text,
            jsonb_build_object('phone', '+' || old.phone), jsonb_build_object('phone', '+' || new.phone));
  end if;
  return new;
end;
$$;
revoke all on function public.sync_profile_phone() from public, anon, authenticated;
grant execute on function public.sync_profile_phone() to supabase_auth_admin;

create trigger sync_profile_phone
  after update of phone on auth.users
  for each row execute function public.sync_profile_phone();

create function public.change_my_name(p_name text)
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
end;
$$;
revoke all on function public.change_my_name(text) from public, anon;
grant execute on function public.change_my_name(text) to authenticated;
