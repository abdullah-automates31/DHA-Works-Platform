-- Migration 0074: one due in full, for the worker's "My Dues" detail screen (owner request, 22 Nov 2026).
--
-- Tapping a due card in My Dues opens the job behind it: what the job was and where, when it was completed, what the worker
-- quoted, the DHA fee, what they earned, how much of the due is paid and how much is left. Worker only (a suspended worker too,
-- who pays from this screen); a worker can read only their own dues, and a due that is not theirs looks the same as one that
-- does not exist. The customer's name, phone and address are not part of it (phase and lane only).

create function public.my_due_detail(p_due uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r record;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'worker') then
    raise exception 'not available' using errcode = '42501';
  end if;
  select d.id, d.job_id, d.quote_id, d.amount, d.accrued_at, d.due_at, d.waive_reason, x.paid, x.remaining, x.waived
    into r
    from public.worker_dues d
    join private.dues_rows(v_uid) x on x.due_id = d.id
   where d.id = p_due and d.worker_id = v_uid;
  if not found then
    raise exception 'this due was not found';
  end if;
  return jsonb_build_object(
    'due', jsonb_build_object(
      'id', r.id, 'fee', r.amount, 'paid', r.paid, 'remaining', r.remaining, 'accrued_at', r.accrued_at, 'due_at', r.due_at,
      'status', case when r.waived then 'waived' when r.remaining = 0 then 'paid' when r.due_at < now() then 'overdue' else 'due' end,
      'waive_reason', r.waive_reason),
    'job', (select jsonb_build_object('id', j.id, 'code', j.code, 'title', j.title, 'description', j.description, 'category', c.name,
                                      'phase', j.phase, 'lane', j.lane, 'completed_at', j.completed_at, 'scheduled_start', j.scheduled_start)
              from public.jobs j join public.categories c on c.id = j.category_id where j.id = r.job_id),
    'money', (select jsonb_build_object('labour', q.labour, 'materials', q.materials, 'total', q.total, 'fee', q.dha_fee,
                                        'earned', q.total - q.dha_fee, 'cash_recorded', cr.worker_amount, 'cash_recorded_at', cr.worker_recorded_at)
                from public.quotes q left join public.cash_records cr on cr.job_id = r.job_id where q.id = r.quote_id),
    'owed_total', (private.dues_summary(v_uid) ->> 'owed')::integer);
end;
$$;
revoke all on function public.my_due_detail(uuid) from public, anon;
grant execute on function public.my_due_detail(uuid) to authenticated;
