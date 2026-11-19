// Changes the worker's profile picture from Settings. The file goes to the worker's own folder in the private
// worker-media bucket, then update_my_profile points avatar_path at it. The photo they sent for verification
// (verification_documents) is never touched, so staff keep what they approved. Injectable client for unit tests.
import { buildPath, checkFile } from '../documents/files.ts';

export type PhotoErrorKey = 'settings.errors.photoType' | 'settings.errors.photoSize' | 'settings.errors.network' | 'settings.errors.generic';
export type PhotoResult = { ok: true; path: string } | { ok: false; key: PhotoErrorKey };

type Err = { name?: string; message?: string; statusCode?: string | number } | null;
export type PhotoClient = {
  upload(path: string, bytes: ArrayBuffer, contentType: string): PromiseLike<{ error: Err }>;
  setAvatar(path: string): PromiseLike<{ error: Err }>;
};

function errorKey(error: Err): PhotoErrorKey {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (text.includes('exceeded') || text.includes('too large') || String(error?.statusCode) === '413') return 'settings.errors.photoSize';
  if (text.includes('network') || text.includes('fetch') || error?.name === 'TypeError') return 'settings.errors.network';
  return 'settings.errors.generic';
}

export async function saveProfilePhoto(
  client: PhotoClient,
  input: { userId: string; mime: string | null | undefined; bytes: ArrayBuffer; now?: number; random?: string },
): Promise<PhotoResult> {
  const check = checkFile('profile_photo', input.mime, input.bytes.byteLength);
  if (!check.ok) return { ok: false, key: check.reason === 'size' ? 'settings.errors.photoSize' : 'settings.errors.photoType' };
  const path = buildPath(input.userId, 'profile_photo', check.extension, input.now ?? Date.now(), input.random ?? Math.random().toString(16).slice(2, 10));
  try {
    const uploaded = await client.upload(path, input.bytes, input.mime ?? 'image/jpeg');
    if (uploaded.error) return { ok: false, key: errorKey(uploaded.error) };
    const saved = await client.setAvatar(path);
    if (saved.error) return { ok: false, key: errorKey(saved.error) };
    return { ok: true, path };
  } catch (thrown) {
    return { ok: false, key: errorKey({ name: thrown instanceof Error ? thrown.name : 'Error', message: 'network request failed' }) };
  }
}

/** A picture already in memory as a data link, so it can be shown before it is saved. */
export function toDataUri(bytes: ArrayBuffer, mime = 'image/jpeg'): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}
