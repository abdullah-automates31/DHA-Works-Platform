import { cookies } from 'next/headers';
import { ACTIVE_COOKIE } from './idle.ts';
import { sessionCookie } from './cookies.ts';

/** Records "active now" for a session that has just signed in. The proxy ends any signed-in session that has no such cookie. */
export async function startActivity(): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_COOKIE, String(Date.now()), { ...sessionCookie(undefined), maxAge: 30 * 24 * 60 * 60 });
}
