import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@dha/supabase';
import { sessionCookie } from '../cookies.ts';
import { publicEnv } from '../env.ts';

/** A Supabase client that acts as the signed-in staff member (their cookies, their JWT). Never the service role. */
export async function createClient() {
  const { url, anonKey } = publicEnv();
  const store = await cookies();
  return createServerClient<Database>(url, anonKey, {
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
