import { requireAdmin } from '@/lib/auth';
import { safePath } from '@/lib/json';

// A profile picture for the portal, staff only. The file name is new for every upload, so the answer can be kept by the
// browser for a week: the same address always means the same picture, and a changed picture has a new address.
// Only image types are passed on, with nosniff and a locked-down policy, so a stored file can never run as a page.
const IMAGE = /^image\/(jpeg|png|webp)$/;

export async function GET(request: Request) {
  const { supabase } = await requireAdmin();
  const path = new URL(request.url).searchParams.get('p');
  if (!safePath(path)) return new Response('Not found', { status: 404 });

  const { data, error } = await supabase.storage.from('worker-media').download(path);
  if (error || !data) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, max-age=60' } });
  const type = data.type.toLowerCase();
  if (!IMAGE.test(type)) return new Response('Not found', { status: 404 });

  return new Response(data, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'private, max-age=604800, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}
