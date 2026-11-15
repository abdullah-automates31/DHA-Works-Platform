import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type JobInProgress = { id: string; title: string };

/**
 * The job this worker has started and not yet marked complete, or null. While there is one, the database hides every new
 * job from the feed and refuses new quotes (migration 0056), so the Open jobs screen explains it instead of looking empty.
 * One small read of the worker's own jobs; it runs again each time the screen is shown.
 */
export function useJobInProgress(): JobInProgress | null {
  const [job, setJob] = useState<JobInProgress | null>(null);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void supabase
        .from('worker_jobs')
        .select('id, title')
        .eq('is_mine', true)
        .eq('status', 'in_progress')
        .limit(1)
        .then(({ data, error }) => {
          if (!live || error) return;
          const row = data?.[0];
          setJob(row?.id ? { id: row.id, title: row.title ?? '' } : null);
        });
      return () => {
        live = false;
      };
    }, []),
  );
  return job;
}
