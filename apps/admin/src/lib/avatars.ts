// Profile pictures in the portal. A picture is served through /avatar (same origin, staff only), not through a signed
// storage link: a signed link changes on every page load, so the browser could never keep the picture, and it expires
// while a page is open (a broken image). A picture's file name is new for every upload, so /avatar?p=<path> can be cached
// for a long time without ever showing an old picture.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@dha/supabase';
import { isUuid, safePath } from './json.ts';

/** The address the browser loads a picture from, or null when the path is missing or looks odd. */
export function avatarSrc(path: string | null | undefined): string | null {
  return safePath(path) ? `/avatar?p=${encodeURIComponent(path)}` : null;
}

/** profiles.avatar_path for the people on one page, in a single read (staff can read every profile). */
export async function loadAvatarPaths(supabase: SupabaseClient<Database>, ids: readonly (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => isUuid(id)))];
  if (unique.length === 0) return {};
  const { data } = await supabase.from('profiles').select('id, avatar_path').in('id', unique);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.avatar_path && safePath(row.avatar_path)) out[row.id] = row.avatar_path;
  return out;
}

/** Same, but already turned into addresses: `{ [profileId]: '/avatar?p=...' }`. */
export async function loadAvatarSrcs(supabase: SupabaseClient<Database>, ids: readonly (string | null | undefined)[]): Promise<Record<string, string>> {
  const paths = await loadAvatarPaths(supabase, ids);
  const out: Record<string, string> = {};
  for (const [id, path] of Object.entries(paths)) {
    const src = avatarSrc(path);
    if (src) out[id] = src;
  }
  return out;
}
