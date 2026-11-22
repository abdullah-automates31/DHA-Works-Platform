import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';

import { parseDueDetail, type DueDetail } from './rules';

export type DueDetailState = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ready'; detail: DueDetail };

// One due in full (my_due_detail, migration 0074): the job behind it, what was quoted, the fee, what the worker earned and how
// much of it is paid. Reloads each time the screen comes to the front (after paying, a confirmation changes it).
export function useDueDetail(id: string) {
  const [state, setState] = useState<DueDetailState>({ status: 'loading' });

  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_due_detail', { p_due: id });
    if (error) {
      // a due that is not this worker's (or was removed) is a plain refusal; anything else is a failed load
      setState((current) => (error.message.includes('not found') ? { status: 'missing' } : current.status === 'ready' ? current : { status: 'error' }));
      return;
    }
    const detail = parseDueDetail(data);
    setState((current) => (detail ? { status: 'ready', detail } : current.status === 'ready' ? current : { status: 'error' }));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { state, reload };
}
