-- 0076 (22 Nov 2026): fix for 0075. Saving DHA's accounts failed from the admin portal with "That could not be saved":
-- calls through the API run under the safeupdate extension, which refuses a DELETE with no WHERE clause, and
-- admin_dues_pay_accounts_save replaced the list with a bare "delete from public.dues_pay_accounts". The database tests
-- run as the admin connection, where that check is not loaded, so they passed. Only the delete line changes.

create or replace function public.admin_dues_pay_accounts_save(p_accounts jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_new jsonb;
  v_item jsonb;
  v_i integer := 0;
  v_method text;
  v_label text;
  v_title text;
  v_number text;
begin
  if not public.is_admin() then
    raise exception 'not available' using errcode = '42501';
  end if;
  -- changing where workers send money is a sensitive change
  if not private.admin_fresh() then
    raise exception 'confirm with a new code' using errcode = 'P0001';
  end if;
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'array' then
    raise exception 'send the accounts as a list';
  end if;
  if jsonb_array_length(p_accounts) > 6 then
    raise exception 'at most 6 accounts';
  end if;

  v_old := public.admin_dues_pay_accounts();
  -- the API role refuses a DELETE without a WHERE clause (safeupdate), so the whole list is matched explicitly
  delete from public.dues_pay_accounts where id is not null;
  for v_item in select * from jsonb_array_elements(p_accounts) loop
    v_i := v_i + 1;
    v_method := lower(btrim(coalesce(v_item ->> 'method', '')));
    v_label := nullif(btrim(coalesce(v_item ->> 'label', '')), '');
    v_title := btrim(coalesce(v_item ->> 'title', ''));
    v_number := btrim(coalesce(v_item ->> 'number', ''));
    if v_method not in ('jazzcash', 'easypaisa', 'bank', 'sadapay', 'nayapay', 'raast', 'other') then
      raise exception 'account %: choose how workers pay', v_i;
    end if;
    if char_length(v_title) < 1 or char_length(v_title) > 60 then
      raise exception 'account %: enter the account title (up to 60 characters)', v_i;
    end if;
    if char_length(v_number) < 3 or char_length(v_number) > 40 then
      raise exception 'account %: enter the number (3 to 40 characters)', v_i;
    end if;
    if v_label is not null and char_length(v_label) > 40 then
      raise exception 'account %: the name is too long (40 characters)', v_i;
    end if;
    insert into public.dues_pay_accounts (position, method, label, account_title, account_number)
    values (v_i, v_method, v_label, v_title, v_number);
  end loop;
  v_new := public.admin_dues_pay_accounts();
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  values (v_uid, 'dues_pay_accounts_saved', 'dues_pay_accounts', 'all', jsonb_build_object('accounts', v_old), jsonb_build_object('accounts', v_new));
end;
$$;
