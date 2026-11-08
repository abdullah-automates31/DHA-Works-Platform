import { cache } from 'react';
import { redirect } from 'next/navigation';
import { parseStatus } from './status.ts';
import { createClient } from './supabase/server.ts';

/**
 * The signed-in session, checked without any network call: getClaims verifies the token signature locally (the project
 * signs with an asymmetric key). Portal pages use this so they start loading their data at once. They do not need the
 * database check first, because every admin function runs is_admin() itself and refuses a password-only session; the
 * shared layout (and every action) runs requireAdmin() below, which redirects before anything is shown.
 */
export const requireSession = cache(async function requireSession() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) redirect('/signin');
  return { supabase, user: { id: sub, email: typeof data?.claims?.email === 'string' ? data.claims.email : null } };
});

/**
 * The full check, used by the layout and by every action. A password alone is not enough: the database must report this
 * very session as verified (migration 0037). Anything unexpected is treated as "not an admin". The database rules
 * (is_admin) are the real gate; this is the first, friendly one. A revoked or suspended session is caught here.
 */
export const requireAdmin = cache(async function requireAdmin() {
  const session = await requireSession();
  const { data: status } = await session.supabase.rpc('admin_session_status');
  const s = parseStatus(status);
  if (s === 'not_admin') redirect('/signin?e=notadmin');
  if (s === 'needs_code') redirect('/signin/code');
  return session;
});
