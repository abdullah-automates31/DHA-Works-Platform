import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useLiveRefresh } from '@/features/live/useLiveRefresh';
import { supabase } from '@/lib/supabase';

import { parseMyDues, type MyDues } from './rules';

export type DuesState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; dues: MyDues };

// My Dues for the signed-in worker (my_dues, migration 0071). It also works for a suspended worker, who pays here to be
// reactivated. The database returns the latest 50 dues and 30 payments at most, so there is nothing to page. It reloads each
// time the screen comes to the front and when a DHA notice arrives (a payment decided, a due added, a warning).
export function useMyDues() {
  const [state, setState] = useState<DuesState>({ status: 'loading' });

  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_dues', { p_limit: 50 });
    const dues = error ? null : parseMyDues(data);
    // a failed reload keeps what is already on screen
    setState((current) => (dues ? { status: 'ready', dues } : current.status === 'ready' ? current : { status: 'error' }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  useLiveRefresh(() => void reload());

  return { state, reload };
}
