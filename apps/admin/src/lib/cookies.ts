import type { CookieOptions } from '@supabase/ssr';

/**
 * Session cookies are for the server only: the portal has no browser-side Supabase client, so page scripts never need
 * to read them. HttpOnly keeps a script injected into a page from stealing the session; Secure (outside local
 * development) keeps them off plain HTTP; SameSite=Lax stops other sites from sending them with cross-site posts.
 */
export function sessionCookie(options: CookieOptions | undefined): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}
