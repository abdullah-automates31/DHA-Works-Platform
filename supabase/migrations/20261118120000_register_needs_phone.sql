-- 0062: only a phone-verified account may register as a resident or worker (audit, 18 Nov 2026).
--
-- Audit finding: email sign-up is on (staff invites need it: the portal's accept-invite page calls auth.signUp with
-- an email). register_profile let such an email account type any phone number and become a resident or worker
-- applicant with a number it never proved. Both phone apps sign in by phone OTP only, so the fix is here: an account
-- without a confirmed phone is refused. A stray email account can still exist, but it has no profile, so it can read
-- or do nothing (every policy and function needs a profile). Same body as 0033 otherwise.

create or replace function public.register_profile(
  p_role public.user_role,
  p_full_name text,
  p_phone text,
  p_gender public.gender default null,
  p_date_of_birth date default null,
  p_cnic text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_auth_phone text;
  v_phone_ok boolean;
  v_email text;
  v_phone text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_role not in ('resident', 'worker') then
    raise exception 'only resident and worker accounts can be registered here';
  end if;

  select nullif(phone, ''), phone_confirmed_at is not null, email into v_auth_phone, v_phone_ok, v_email
    from auth.users where id = v_uid;
  if v_auth_phone is null or not coalesce(v_phone_ok, false) then
    raise exception 'sign in with your phone number first' using errcode = 'P0001';
  end if;

  -- Two requests for the same user (double tap, retry, second device) queue here, so only the first one inserts.
  perform pg_advisory_xact_lock(hashtextextended('register_profile:' || v_uid::text, 0));
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile already exists';
  end if;

  -- The contact phone is always the number that signed in (p_phone is ignored).
  v_phone := '+' || v_auth_phone;

  begin
    insert into public.profiles (id, role, full_name, email, phone, gender, date_of_birth, cnic)
    values (v_uid, p_role, nullif(trim(p_full_name), ''), v_email, v_phone, p_gender, p_date_of_birth,
            nullif(trim(p_cnic), ''));
    if p_role = 'worker' then
      insert into public.worker_details (profile_id) values (v_uid);
    end if;
  exception when unique_violation then
    -- Either this user's own row appeared in the meantime, or the CNIC / phone belongs to another account.
    if exists (select 1 from public.profiles where id = v_uid) then
      raise exception 'profile already exists';
    end if;
    raise;
  end;

  insert into public.audit_log (actor_id, action, table_name, record_id)
  values (v_uid, 'register_profile', 'profiles', v_uid::text);
end;
$$;
