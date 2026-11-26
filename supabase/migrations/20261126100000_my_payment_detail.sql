-- Migration 0081: one payment in full, for the worker's "My Dues" payment detail screen (owner request, 26 Nov 2026).
--
-- Tapping a payment card in My Dues opens the payment: how it was paid, when it was sent and decided, the reason when it was not
-- accepted, the screenshot the worker sent, and WHICH DUES IT PAID (job, when and where, how much of the fee it covered).
--
-- Nothing is stored per due (see private.dues_rows): all confirmed payments are pooled and clear the oldest dues first. So "what this
-- payment paid" is worked out here with the same rule, from running totals:
--   * confirmed payments are laid end to end in the order they were sent (created_at, id); the payment owns its own stretch;
--   * non-waived dues are laid end to end oldest first (accrued_at, id); a due owns its own stretch;
--   * the overlap of the payment's stretch with a due's stretch is what the payment paid of that due;
--   * whatever lies beyond the last due is credit.
-- A pending payment is shown as a projection ("once confirmed it goes to your oldest dues first"): it is laid after all confirmed
-- payments and after pending ones sent before it. A rejected payment paid nothing. Waiving a due later can change the list, because
-- the list is always worked out from today's dues.
--
-- Worker only (a suspended worker too, who pays from this screen). A worker reads only their own payments; a payment that is not
-- theirs looks the same as one that does not exist. The screenshot PATH is returned because it is the worker's own file (bucket
-- dues-proof, own folder: policy dues_proof_read) and the app needs it for a short-lived link. The customer's name, phone and address
-- are not part of it (phase and lane only), and the automatic screenshot check (0080) is never shown to workers.

create function public.my_payment_detail(p_payment uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  p public.dues_payments;
  v_start bigint;
  v_end bigint;
  v_dues_total bigint;
  v_covers jsonb;
begin
  if v_uid is null or not exists (select 1 from public.profiles pr where pr.id = v_uid and pr.role = 'worker') then
    raise exception 'not available' using errcode = '42501';
  end if;
  select * into p from public.dues_payments d where d.id = p_payment and d.worker_id = v_uid;
  if not found then
    raise exception 'this payment was not found';
  end if;

  select coalesce(sum(wd.amount), 0) into v_dues_total
    from public.worker_dues wd where wd.worker_id = v_uid and wd.waived_at is null;

  -- where this payment's stretch starts in the pool (null: it paid nothing)
  if p.status = 'confirmed' then
    select coalesce(sum(d.amount), 0) into v_start
      from public.dues_payments d
     where d.worker_id = v_uid and d.status = 'confirmed' and (d.created_at, d.id) < (p.created_at, p.id);
  elsif p.status = 'pending' then
    select coalesce(sum(d.amount) filter (where d.status = 'confirmed'), 0)
         + coalesce(sum(d.amount) filter (where d.status = 'pending' and (d.created_at, d.id) < (p.created_at, p.id)), 0)
      into v_start
      from public.dues_payments d where d.worker_id = v_uid;
  end if;
  v_end := v_start + p.amount;

  if v_start is not null then
    with d as (
      select wd.id, wd.job_id, wd.amount, wd.due_at, wd.accrued_at,
             coalesce(sum(wd.amount) over (order by wd.accrued_at, wd.id rows between unbounded preceding and 1 preceding), 0) as s
        from public.worker_dues wd
       where wd.worker_id = v_uid and wd.waived_at is null
    )
    select jsonb_agg(jsonb_build_object(
             'due_id', d.id, 'job_id', j.id, 'code', j.code, 'title', j.title, 'phase', j.phase, 'lane', j.lane,
             'completed_at', j.completed_at, 'fee', d.amount, 'covered', (least(v_end, d.s + d.amount) - greatest(v_start, d.s))::integer,
             'accrued_at', d.accrued_at, 'due_at', d.due_at) order by d.s)
      into v_covers
      from d join public.jobs j on j.id = d.job_id
     where least(v_end, d.s + d.amount) > greatest(v_start, d.s);
  end if;

  return jsonb_build_object(
    'payment', jsonb_build_object(
      'id', p.id, 'amount', p.amount, 'method', p.method, 'reference', p.reference, 'status', p.status,
      'created_at', p.created_at, 'decided_at', p.decided_at, 'reason', p.decision_reason,
      'by_staff', p.created_by <> v_uid, 'proof_path', p.proof_path),
    'covers', coalesce(v_covers, '[]'::jsonb),
    'credit', case when v_start is null then 0 else greatest(0, v_end - greatest(v_start, v_dues_total))::integer end,
    'projected', p.status = 'pending');
end;
$$;
revoke all on function public.my_payment_detail(uuid) from public, anon;
grant execute on function public.my_payment_detail(uuid) to authenticated;
