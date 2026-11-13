import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@dha/supabase';
import { sessionCookie } from '../cookies.ts';
import { publicEnv } from '../env.ts';
import { timeoutFetch } from '../timeout-fetch.ts';

/** A Supabase client that acts as the signed-in staff member (their cookies, their JWT). Never the service role. */
export async function createClient() {
  const { url, anonKey } = publicEnv();
  const store = await cookies();
  return createServerClient<Database>(url, anonKey, {
    // Every database, auth and storage call gives up after 15 seconds instead of holding the page open.
    global: { fetch: timeoutFetch() },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, sessionCookie(options));
        } catch {
          // Called from a Server Component: the cookie refresh is handled by the proxy instead.
        }
      },
    },
  });
}
