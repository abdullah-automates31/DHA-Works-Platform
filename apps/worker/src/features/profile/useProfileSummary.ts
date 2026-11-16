import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useLiveRefresh } from '@/features/live/useLiveRefresh';
import { supabase } from '@/lib/supabase';

import { parseEarnings, type Earnings } from './summary';

export type Trade = { id: number; name: string };
export type ProfileSummary =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; earnings: Earnings; available: boolean; reminders: boolean; trades: Trade[]; mine: number[] };

async function fetchSummary(): Promise<ProfileSummary> {
  // Everything is the signed-in worker's own data (row-level security, and get_my_earnings reads the caller only).
  // The trades come as one join: every active trade with this worker's own choice nested inside it.
  const [earnings, details, categories] = await Promise.all([
    supabase.rpc('get_my_earnings'),
    supabase.from('worker_details').select('available_today, job_reminders').maybeSingle(),
    supabase.from('categories').select('id, name, worker_categories(category_id)').eq('active', true).order('sort'),
  ]);
  if (earnings.error || details.error || categories.error) return { status: 'error' };
  return {
    status: 'ready',
    earnings: parseEarnings(earnings.data),
    available: details.data?.available_today !== false,
    reminders: details.data?.job_reminders !== false,
    trades: (categories.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    mine: (categories.data ?? []).filter((c) => c.worker_categories.length > 0).map((c) => c.id),
  };
}

export function useProfileSummary() {
  const [data, setData] = useState<ProfileSummary>({ status: 'loading' });

  const load = useCallback(async () => {
    const next = await fetchSummary();
    setData((current) => (next.status === 'error' && current.status === 'ready' ? current : next));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useLiveRefresh(() => void load());

  /** Optimistic: the switch moves at once and goes back if the server refuses. */
  const setAvailable = useCallback(async (value: boolean): Promise<boolean> => {
    setData((current) => (current.status === 'ready' ? { ...current, available: value } : current));
    const { error } = await supabase.rpc('set_available_today', { p_value: value });
    if (error) {
      setData((current) => (current.status === 'ready' ? { ...current, available: !value } : current));
      return false;
    }
    return true;
  }, []);

  const setReminders = useCallback(async (value: boolean): Promise<boolean> => {
    setData((current) => (current.status === 'ready' ? { ...current, reminders: value } : current));
    const { error } = await supabase.rpc('set_job_reminders', { p_value: value });
    if (error) {
      setData((current) => (current.status === 'ready' ? { ...current, reminders: !value } : current));
      return false;
    }
    return true;
  }, []);

  const saveTrades = useCallback(
    async (ids: number[]): Promise<boolean> => {
      const { error } = await supabase.rpc('set_my_categories', { p_category_ids: ids });
      if (error) return false;
      await load();
      return true;
    },
    [load],
  );

  return { data, reload: load, setAvailable, setReminders, saveTrades };
}
