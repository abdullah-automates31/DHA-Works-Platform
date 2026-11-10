-- 0047: the material bill is attached while the job is in progress, between "Start job" and "Mark complete"
-- (user, 11 Nov). Narrows 0045, which also allowed it while the job was only quoted or scheduled. A quote with
-- materials above 0 still needs a bill before complete_job succeeds (unchanged); the bill can be attached at any
-- moment of that window, and replaced until the job is completed.

create or replace function public.attach_material_bill(p_job_id uuid, p_bill_path text)
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
  select * into v_quote from public.quotes
   where id = v_job.accepted_quote_id and worker_id = v_uid and status = 'accepted'
   for update;
  if not found or v_job.status <> 'in_progress' then
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
