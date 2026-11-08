import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@dha/supabase';

// Runs before every page. Two jobs:
//  1. Keep the Supabase session cookie fresh (a Server Component cannot write cookies, so the refresh happens here).
//  2. Send anyone who is not signed in to the sign-in page. This is only the first, cheap gate: every page and action
//     also calls requireSession() (layout and actions: requireAdmin()), and the database decides what an account may read or change (migration 0037).
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return new NextResponse('Portal is not configured.', { status: 500 });

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // Verifies the token locally and refreshes it when it is about to expire; only a refresh calls the auth server.
  const { data } = await supabase.auth.getClaims();
  // Public pages: sign-in, and the invitation page (the invited person has no account yet).
  const path = request.nextUrl.pathname;
  const isPublic = path === '/signin' || path.startsWith('/signin/') || path === '/accept-invite';
  if (!data?.claims?.sub && !isPublic) {
    const redirect = NextResponse.redirect(new URL('/signin', request.url));
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|dha-crest.png).*)'],
};
