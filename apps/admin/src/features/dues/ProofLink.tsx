import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@dha/supabase';

/** Short-lived (5 minutes) private links for the payment screenshots shown on a page. Only paths of the safe shape are signed. */
export async function signedProofUrls(supabase: SupabaseClient<Database>, paths: (string | null)[]): Promise<Record<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => typeof p === 'string'))];
  const urls: Record<string, string> = {};
  if (wanted.length === 0) return urls;
  const { data } = await supabase.storage.from('dues-proof').createSignedUrls(wanted, 300);
  for (const item of data ?? []) if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  return urls;
}

/** The screenshot the worker attached: a small picture that opens full size in a new tab. */
export function ProofLink({ url, small }: { url: string | null; small?: boolean }) {
  if (!url) return small ? null : <div className="mut" style={{ fontSize: 12.5 }}>No screenshot attached.</div>;
  const size = small ? 56 : 110;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="doc" style={{ width: size, height: size, overflow: 'hidden', display: 'block', marginTop: small ? 6 : 0 }} aria-label="Open the payment screenshot full size">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Payment screenshot" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </a>
  );
}
