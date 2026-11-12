import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@dha/supabase';
import { sessionCookie } from './lib/cookies';
import { ACTIVE_COOKIE, idleExpired, idleLimitMs, parseActive, shouldTouch, staleActive, touchIntervalMs } from './lib/idle';
import { contentSecurityPolicy, makeNonce } from './lib/security-headers';

// Runs before every page. Four jobs:
//  1. Give the page a fresh CSP nonce, so only Next.js's own scripts run (no inline script can be injected).
//  2. Keep the Supabase session cookie fresh (a Server Component cannot write cookies, so the refresh happens here).
//  3. Sign out anyone who has done nothing for 30 minutes (an HttpOnly activity cookie; Supabase's own session timebox needs a paid plan).
//  4. Send anyone who is not signed in to the sign-in page. This is only the first, cheap gate: every page and action
//     also calls requireSession() (layout and actions: requireAdmin()), and the database decides what an account may read or change (migration 0037).
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return new NextResponse('Portal is not configured.', { status: 500 });

  const nonce = makeNonce();
  const csp = contentSecurityPolicy(url, process.env.NODE_ENV !== 'production', nonce);
  // Next.js reads the nonce from the request's CSP header and stamps it on its own scripts.
  const forward = new Headers(request.headers);
  forward.set('x-nonce', nonce);
  forward.set('Content-Security-Policy', csp);
  const withCsp = (r: NextResponse) => {
    r.headers.set('Content-Security-Policy', csp);
    return r;
  };

  let response = withCsp(NextResponse.next({ request: { headers: forward } }));
  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = withCsp(NextResponse.next({ request: { headers: forward } }));
        for (const { name, value, options } of list) response.cookies.set(name, value, sessionCookie(options));
      },
    },
  });

  // Verifies the token locally and refreshes it when it is about to expire; only a refresh calls the auth server.
  const { data } = await supabase.auth.getClaims();
  const now = Date.now();
  const last = parseActive(request.cookies.get(ACTIVE_COOKIE)?.value);
  const signedIn = !!data?.claims?.sub;
  const limit = idleLimitMs(process.env.IDLE_LIMIT_SECONDS);
  if (signedIn && idleExpired(last, now, limit)) {
    await supabase.auth.signOut(); // ends the session on the server and clears the session cookies through setAll
    const redirect = withCsp(NextResponse.redirect(new URL('/signin?e=idle', request.url)));
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    redirect.cookies.set(ACTIVE_COOKIE, '', { ...sessionCookie(undefined), maxAge: 0 });
    return redirect;
  }
  // Public pages: sign-in, and the invitation page (the invited person has no account yet).
  const path = request.nextUrl.pathname;
  const isPublic = path === '/signin' || path.startsWith('/signin/') || path === '/accept-invite';
  const clearActive = staleActive(signedIn, last);
  if (!data?.claims?.sub && !isPublic) {
    const redirect = withCsp(NextResponse.redirect(new URL('/signin', request.url)));
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    if (clearActive) redirect.cookies.set(ACTIVE_COOKIE, '', { ...sessionCookie(undefined), maxAge: 0 });
    return redirect;
  }
  if (clearActive) response.cookies.set(ACTIVE_COOKIE, '', { ...sessionCookie(undefined), maxAge: 0 });
  if (signedIn && shouldTouch(last, now, touchIntervalMs(limit))) response.cookies.set(ACTIVE_COOKIE, String(now), { ...sessionCookie(undefined), maxAge: 30 * 24 * 60 * 60 });
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|dha-crest.png).*)'],
};
