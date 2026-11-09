-- 0045: the worker can attach the material bill at any time until the job is completed, and the customer sees it in
-- "view quote" (Shariq, 10 Nov). This changes the 3 Nov rule (0026) "the bill is uploaded only at Complete Job":
--
--   * attach_material_bill(job, path): the worker files (or replaces) the bill photo of THEIR quote while the job is
--     quoted, scheduled or in progress. The photo is stored on quotes.material_bill_path, which the customer already
--     reads through resident_quotes.material_bill_path and the job-media read rule (0024), so "view quote" can show it
--     as soon as the customer app draws it. A bill that is filed cannot be deleted through storage (0030).
--   * complete_job keeps the bill rule (a quote with materials above 0 needs a bill) but accepts a bill that was
--     attached earlier: p_bill_path stays optional. A bill given at completion replaces the attached one, so the
--     quote and the job always point at the same final file.
--   * No new column, no new notification type: the customer's open screen shows the bill on its next load.

create function public.attach_material_bill(p_job_id uuid, p_bill_path text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker', false);
  v_job public.jobs;
  v_quote public.quotes;
  v_bill text := nullif(btrim(p_bill_path), '');
begin
  if v_bill is null then
    raise exception 'upload the material bill';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'this job cannot take a bill';
  end if;
  -- The worker's own live quote on this job: sent (the customer has not decided yet) or accepted.
  select * into v_quote from public.quotes
   where job_id = p_job_id and worker_id = v_uid and status in ('sent', 'accepted')
   order by created_at desc limit 1
   for update;
  if not found or v_job.status not in ('interested', 'quoted', 'scheduled', 'in_progress') then
    raise exception 'this job cannot take a bill';
  end if;
  if coalesce(v_quote.materials, 0) <= 0 then
    raise exception 'this quote has no materials';
  end if;
  if split_part(v_bill, '/', 1) <> v_uid::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'job-media' and o.name = v_bill) then
    raise exception 'invalid bill path';
  end if;

  update public.quotes set material_bill_path = v_bill where id = v_quote.id;
  perform private.record(p_job_id, 'bill_attached', v_uid,
    jsonb_build_object('quote_id', v_quote.id, 'replaced', v_quote.material_bill_path is not null), true);
end;
$$;

revoke all on function public.attach_material_bill(uuid, text) from public, anon;
grant execute on function public.attach_material_bill(uuid, text) to authenticated;

-- complete_job as in 0030/20261107100229, plus: a bill attached earlier counts, and a bill given now is filed on the
-- quote too.
create or replace function public.complete_job(p_job_id uuid, p_bill_path text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.me('worker', false);
  v_job public.jobs;
  v_materials integer;
  v_quote_bill text;
  v_bill text := nullif(trim(p_bill_path), '');
begin
  select * into v_job from public.jobs where id = p_job_id and accepted_worker_id = v_uid for update;
  if not found or v_job.status <> 'in_progress' then
    raise exception 'this job cannot be completed';
  end if;
  select materials, material_bill_path into v_materials, v_quote_bill
    from public.quotes where id = v_job.accepted_quote_id;
  v_bill := coalesce(v_bill, v_quote_bill);
  if coalesce(v_materials, 0) > 0 and v_bill is null then
    raise exception 'upload the material bill';
  end if;
  if v_bill is not null and split_part(v_bill, '/', 1) <> v_uid::text then
    raise exception 'invalid bill path';
  end if;
  if v_bill is not null
     and not exists (select 1 from storage.objects o where o.bucket_id = 'job-media' and o.name = v_bill) then
    raise exception 'invalid bill path';
  end if;
  update public.jobs set status = 'completed', completed_at = now(), material_bill_path = v_bill,
    stuck_since = null, stuck_reason = null
  where id = p_job_id;
  if v_bill is not null then
    update public.quotes set material_bill_path = v_bill where id = v_job.accepted_quote_id;
  end if;
  perform private.record(p_job_id, 'completed', v_uid);
  perform private.notify(v_job.resident_id, 'job_completed', p_job_id, jsonb_build_object('title', v_job.title));
  -- Push trail: the worker is told to collect the cash and record it.
  perform private.notify(v_uid, 'cash_awaiting_you', p_job_id, jsonb_build_object('title', v_job.title));
end;
$$;
