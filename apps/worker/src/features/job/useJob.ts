import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { jobKind, type JobKind } from '@/features/myjobs/rules';
import { URL_TTL_SECONDS, signedUrlMap } from '@/lib/signedUrls';
import { supabase } from '@/lib/supabase';

import { whenPill } from '@/features/feed/format';

import { standingFromMyJob, type Standing } from './detail';

export type JobDetail = {
  id: string;
  code: string;
  title: string;
  description: string;
  categoryName: string;
  phase: number;
  lane: string;
  urgency: string;
  when: string; // the date and time the CUSTOMER asked for, as a pill
  preferred: { date: string | null; from: string | null; to: string | null }; // the same, raw (to start the worker's window there)
  postedAt: string | null;
  photos: string[]; // signed URLs, in the order the resident added them
  hasVoiceNote: boolean;
  voiceUrl: string | null;
  others: number | null; // other workers interested (only known for jobs this worker has not engaged with)
  quotes: number | null;
  standing: Standing;
  kind: JobKind | null; // the worker's own stage on the job (null for a job not engaged with yet)
};

export type JobState =
  | { status: 'loading' }
  | { status: 'unavailable' } // not found, expired, taken or not matching this worker: the database hides it
  | { status: 'error' }
  | { status: 'ready'; job: JobDetail };

async function fetchJob(id: string): Promise<JobState> {
  // 1) A job the worker has not engaged with: worker_feed (matching trade and phase, not expired). It carries no
  //    resident name, phone, plot or address, so nothing private can reach this screen.
  //
  // The three reads below depend only on the job id, so they run side by side instead of one after another. Which
  // answer is used is decided afterwards, exactly as before: the feed first, then the worker's own jobs.
  const [feed, mine, photoRows] = await Promise.all([
    supabase
      .from('worker_feed')
      .select('id, code, title, description, category_name, phase, lane, urgency, preferred_date, window_from, window_to, posted_at, voice_note_path, interest_count, quote_count')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('worker_jobs')
      .select('id, code, title, description, category_name, phase, lane, urgency, preferred_date, window_from, window_to, posted_at, voice_note_path, status, my_quote_status, is_mine')
      .eq('id', id)
      .maybeSingle(),
    supabase.from('job_photos').select('storage_path, sort').eq('job_id', id).order('sort'),
  ]);
  if (feed.error) return { status: 'error' };

  let base: Omit<JobDetail, 'photos' | 'voiceUrl'> | null = null;
  let voicePath: string | null = null;

  if (feed.data) {
    voicePath = feed.data.voice_note_path;
    base = {
      id: feed.data.id ?? id,
      code: feed.data.code ?? '',
      title: feed.data.title ?? '',
      description: feed.data.description ?? '',
      categoryName: feed.data.category_name ?? '',
      phase: feed.data.phase ?? 0,
      lane: feed.data.lane ?? '',
      urgency: feed.data.urgency ?? 'asap',
      when: whenPill({ urgency: feed.data.urgency ?? 'asap', preferredDate: feed.data.preferred_date, windowFrom: feed.data.window_from, windowTo: feed.data.window_to, postedAt: feed.data.posted_at }).text,
      postedAt: feed.data.posted_at,
      preferred: { date: feed.data.preferred_date ?? null, from: feed.data.window_from ?? null, to: feed.data.window_to ?? null },
      hasVoiceNote: Boolean(voicePath),
      others: feed.data.interest_count ?? 0,
      quotes: feed.data.quote_count ?? 0,
      standing: 'none',
      kind: null,
    };
  } else {
    // 2) A job this worker already engaged with (interest or quote): worker_jobs.
    if (mine.error) return { status: 'error' };
    if (!mine.data) return { status: 'unavailable' };
    // A job the customer rejected this worker on shows nothing at all: the database already blanks its details.
    if (jobKind({ status: mine.data.status ?? '', isMine: mine.data.is_mine, myQuoteStatus: mine.data.my_quote_status }) === 'not_chosen') return { status: 'unavailable' };
    voicePath = mine.data.voice_note_path;
    base = {
      id: mine.data.id ?? id,
      code: mine.data.code ?? '',
      title: mine.data.title ?? '',
      description: mine.data.description ?? '',
      categoryName: mine.data.category_name ?? '',
      phase: mine.data.phase ?? 0,
      lane: mine.data.lane ?? '',
      urgency: mine.data.urgency ?? 'asap',
      when: whenPill({ urgency: mine.data.urgency ?? 'asap', preferredDate: mine.data.preferred_date, windowFrom: mine.data.window_from, windowTo: mine.data.window_to, postedAt: mine.data.posted_at }).text,
      postedAt: mine.data.posted_at,
      preferred: { date: mine.data.preferred_date ?? null, from: mine.data.window_from ?? null, to: mine.data.window_to ?? null },
      hasVoiceNote: Boolean(voicePath),
      others: null,
      quotes: null,
      standing: standingFromMyJob({ status: mine.data.status ?? '', myQuoteStatus: mine.data.my_quote_status }),
      kind: jobKind({ status: mine.data.status ?? '', isMine: mine.data.is_mine, myQuoteStatus: mine.data.my_quote_status }),
    };
  }

  // Photos and the voice note are signed for an hour (private bucket). A problem here never hides the job.
  // The photos and the voice note are signed together (two storage calls at once).
  const photoPaths = photoRows.error ? [] : (photoRows.data ?? []).map((r) => r.storage_path);
  const [byPath, voiceUrl] = await Promise.all([
    signedUrlMap('job-media', photoPaths),
    voicePath ? supabase.storage.from('job-media').createSignedUrl(voicePath, URL_TTL_SECONDS).then((s) => s.data?.signedUrl ?? null) : Promise.resolve(null),
  ]);
  const photos = photoPaths.map((p) => byPath.get(p)).filter((u): u is string => Boolean(u));

  return { status: 'ready', job: { ...base, photos, voiceUrl } };
}

export function useJob(id: string): { state: JobState; reload: () => Promise<void> } {
  const [state, setState] = useState<JobState>({ status: 'loading' });

  // Loads when the screen opens and again when it is shown after returning (for example from the quote screen).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void fetchJob(id).then((next) => {
        if (active) setState((current) => (next.status === 'error' && current.status === 'ready' ? current : next));
      });
      return () => {
        active = false;
      };
    }, [id]),
  );

  const reload = useCallback(async () => {
    setState({ status: 'loading' });
    setState(await fetchJob(id));
  }, [id]);

  return { state, reload };
}

/** Counts the view once per worker (the database ignores repeats). Failures are silent: a view is only a statistic. */
export async function recordJobView(id: string): Promise<void> {
  try {
    await supabase.rpc('record_job_view', { p_job_id: id });
  } catch {
    // nothing to do
  }
}
