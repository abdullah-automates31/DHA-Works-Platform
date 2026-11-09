import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useLiveRefresh } from '@/features/live/useLiveRefresh';
import { supabase } from '@/lib/supabase';

import { MY_JOB_COLUMNS, toMyJob } from './useMyJobs';
import { jobKind, type MyJob } from './rules';

export type StatusExtras = {
  interestAt: string | null;
  quoteAt: string | null;
  quoteTotal: number | null;
  materials: number; // materials in this worker's quote (a bill is needed to complete when above zero)
  cashAmount: number | null; // what the worker recorded, once recorded
  cashDue: number | null; // the agreed amount from the accepted quote
  cancelRequestId: string | null; // this worker's pending cancellation request, if any (to withdraw it)
  quoteRevision: number; // 0 = the sent quote can still be changed once (0044)
  quoteStatus: string | null;
  visitStart: string | null; // the worker's window from their quote (0044); the booking once accepted
  visitEnd: string | null;
};

export type JobStatusState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error' }
  | { status: 'ready'; job: MyJob; extras: StatusExtras };

async function fetchStatus(id: string): Promise<JobStatusState> {
  const base = await supabase.from('worker_jobs').select(MY_JOB_COLUMNS).eq('id', id).maybeSingle();
  if (base.error) return { status: 'error' };
  if (!base.data) return { status: 'unavailable' };
  const job = toMyJob(base.data as never);
  if (jobKind(job) === 'not_chosen') return { status: 'unavailable' }; // a rejected job cannot be opened

  // The worker's own interest, quote and cash row (row-level security lets them read only their own).
  const [interest, quote, cash, cancel] = await Promise.all([
    supabase.from('job_interests').select('created_at').eq('job_id', id).maybeSingle(),
    supabase.from('quotes').select('created_at, total, materials, status, revision, visit_start, visit_end').eq('job_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('cash_records').select('worker_amount, agreed_amount').eq('job_id', id).maybeSingle(),
    supabase.from('cancellation_requests').select('id, requester_role').eq('job_id', id).eq('status', 'pending').maybeSingle(),
  ]);
  // Do not guess when an extra read failed: without the quote the screen would skip the bill prompt, and without
  // the cash row it would offer the write-once form again. A reload that fails keeps the screen already shown.
  if (interest.error || quote.error || cash.error || cancel.error) return { status: 'error' };
  if (cash.data?.worker_amount !== null && cash.data?.worker_amount !== undefined) job.cashRecorded = true;
  return {
    status: 'ready',
    job,
    extras: {
      interestAt: interest.data?.created_at ?? null,
      quoteAt: quote.data?.created_at ?? null,
      quoteTotal: quote.data?.total ?? null,
      materials: quote.data?.materials ?? 0,
      cashAmount: cash.data?.worker_amount ?? null,
      cashDue: cash.data?.agreed_amount ?? job.myQuoteTotal,
      cancelRequestId: cancel.data?.requester_role === 'worker' ? cancel.data.id : null,
      quoteRevision: quote.data?.revision ?? 0,
      quoteStatus: quote.data?.status ?? null,
      // Once booked the job's own window is the truth; before that the quote's offer.
      visitStart: job.scheduledStart ?? quote.data?.visit_start ?? null,
      visitEnd: job.scheduledEnd ?? quote.data?.visit_end ?? null,
    },
  };
}

export function useJobStatus(id: string): { state: JobStatusState; reload: () => Promise<void> } {
  const [state, setState] = useState<JobStatusState>({ status: 'loading' });

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void fetchStatus(id).then((next) => {
        if (active) setState((current) => (next.status === 'error' && current.status === 'ready' ? current : next));
      });
      return () => {
        active = false;
      };
    }, [id]),
  );

  const reload = useCallback(async () => {
    const next = await fetchStatus(id);
    setState((current) => (next.status === 'error' && current.status === 'ready' ? current : next));
  }, [id]);

  useLiveRefresh(() => void reload());

  return { state, reload };
}
