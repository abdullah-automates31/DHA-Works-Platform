import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@dha/supabase';
import { PAGE_SIZE, type JobFilter, type JobStage } from '../../lib/format.ts';
import { safePath } from '../../lib/json.ts';
import { parseCancellations, parseJobCounts, parseJobDetail, parseJobs, type JobDetail } from './parse.ts';

type Client = SupabaseClient<Database>;

export async function loadJobCounts(supabase: Client) {
  const { data } = await supabase.rpc('admin_jobs_counts');
  return parseJobCounts(data);
}

export async function loadJobs(supabase: Client, o: { status: JobFilter | null; stage?: JobStage | null; phase: number | null; category: number | null; today: boolean; q: string; page: number }) {
  const { data, error } = await supabase.rpc('admin_jobs_list', {
    p_status: o.status ?? undefined, p_phase: o.phase ?? undefined, p_category: o.category ?? undefined, p_today: o.today,
    p_search: o.q || undefined, p_limit: PAGE_SIZE, p_offset: (o.page - 1) * PAGE_SIZE, p_stage: o.stage ?? undefined,
  });
  return { ok: !error, list: parseJobs(error ? null : data) };
}

export async function loadJobDetail(supabase: Client, id: string): Promise<JobDetail | null> {
  const { data, error } = await supabase.rpc('admin_job_detail', { p_job: id });
  return error ? null : parseJobDetail(data);
}

/** Five-minute links to the job photos and the voice note. */
export async function jobMediaUrls(supabase: Client, paths: string[]): Promise<Record<string, string>> {
  const ok = paths.filter(safePath);
  if (ok.length === 0) return {};
  const { data } = await supabase.storage.from('job-media').createSignedUrls(ok, 300);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

export async function loadCancellations(supabase: Client, status: 'pending' | 'all', pageNo: number) {
  const { data, error } = await supabase.rpc('admin_cancellations_list', { p_status: status, p_limit: PAGE_SIZE, p_offset: (pageNo - 1) * PAGE_SIZE });
  return { ok: !error, list: parseCancellations(error ? null : data) };
}

export async function loadFilterOptions(supabase: Client) {
  const [phases, categories] = await Promise.all([
    supabase.from('service_areas').select('phase').order('phase'),
    supabase.from('categories').select('id, name').order('sort'),
  ]);
  return {
    phases: (phases.data ?? []).map((p) => p.phase),
    categories: (categories.data ?? []).map((c) => ({ id: c.id, name: c.name })),
  };
}
