-- Worker-only cash (Shariq, 9 Nov 2026). The customer app no longer confirms cash: the worker's Record cash
-- (record_cash_worker) closes the job as cash_collected straight away, and the resident is asked to rate.
--   * private.settle_cash settles on the worker's amount alone. matched stays true unless a resident amount
--     from the old two-sided flow exists and differs (get_my_earnings counts matched rows only).
--   * confirm_cash_resident is retired: it now refuses with a clear message for any old client.
--   * Jobs already waiting on the resident (completed, worker amount in) are settled now.

create or replace function private.settle_cash(p_job uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_cash public.cash_records;
  v_job public.jobs;
begin
  select * into v_cash from public.cash_records where job_id = p_job;
  if v_cash.worker_amount is null then
    return;
  end if;
  select * into v_job from public.jobs where id = p_job for update;
  if v_job.status <> 'completed' then
    return;
  end if;

  -- The worker's amount is final. The gap against the quote stays on cash_records for staff; the resident
  -- can still file a report or rate the worker low.
  update public.cash_records
     set matched = (resident_amount is null or resident_amount = worker_amount),
         quote_difference = worker_amount - agreed_amount
   where job_id = p_job;
  update public.jobs set status = 'cash_collected', stuck_since = null, stuck_reason = null where id = p_job;
  update public.worker_details set jobs_done = jobs_done + 1 where profile_id = v_job.accepted_worker_id;
  perform private.record(p_job, 'cash_collected', null,
    jsonb_build_object('worker_amount', v_cash.worker_amount, 'difference', v_cash.worker_amount - v_cash.agreed_amount));
  perform private.notify(v_job.resident_id, 'rate_worker', p_job, jsonb_build_object('title', v_job.title));
  perform private.notify(v_job.accepted_worker_id, 'cash_collected', p_job, jsonb_build_object('title', v_job.title));
end;
$$;

-- Kept with the same signature and grants so an old customer build gets a readable refusal, not a 404.
create or replace function public.confirm_cash_resident(p_job_id uuid, p_amount integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'the worker confirms the cash; you can rate the worker once they do';
end;
$$;

update public.app_settings
   set description = 'Completed job whose worker has not recorded the cash after this many hours is stuck.'
 where key = 'stuck_cash_hours';

-- Jobs stuck on the old rule: the worker recorded cash and the resident never confirmed.
do $$
declare
  r record;
begin
  for r in
    select j.id
      from public.jobs j
      join public.cash_records c on c.job_id = j.id
     where j.status = 'completed' and c.worker_amount is not null
  loop
    perform private.settle_cash(r.id);
  end loop;
end $$;
