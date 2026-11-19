import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type Trade = { id: number; name: string };
export type WorkData =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      trades: Trade[];
      selected: number[];
      years: number | null;
      fee: number | null;
      voicePath: string | null;
      voiceUrl: string | null;
      about: string;
    };

export async function fetchWork(): Promise<WorkData> {
  // RLS: categories are readable by every signed-in user; the worker's own choices and details only by them.
  // One join: every active trade, with this worker's own choice nested inside it (an empty list when not chosen).
  const [categories, details] = await Promise.all([
    supabase.from('categories').select('id, name, worker_categories(category_id)').eq('active', true).order('sort'),
    supabase.from('worker_details').select('experience_years, visit_fee, voice_intro_path, about').maybeSingle(),
  ]);
  if (categories.error || details.error) return { status: 'error' };
  const voicePath = details.data?.voice_intro_path ?? null;
  let voiceUrl: string | null = null;
  if (voicePath) {
    const signed = await supabase.storage.from('worker-media').createSignedUrl(voicePath, 3600);
    voiceUrl = signed.data?.signedUrl ?? null;
  }
  const fee = details.data?.visit_fee ?? null;
  return {
    status: 'ready',
    trades: (categories.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    selected: (categories.data ?? []).filter((c) => c.worker_categories.length > 0).map((c) => c.id),
    years: details.data?.experience_years ?? null,
    // The database default is 0 ("no visit fee"); show a field as empty rather than a fee the worker never entered.
    fee: fee === 0 ? null : fee,
    voicePath,
    voiceUrl,
    about: details.data?.about ?? '',
  };
}

export function useWork(): WorkData {
  const [data, setData] = useState<WorkData>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    void fetchWork().then((next) => {
      if (active) setData(next);
    });
    return () => {
      active = false;
    };
  }, []);
  return data;
}
