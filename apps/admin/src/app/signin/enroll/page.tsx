import { redirect } from 'next/navigation';
import { SignInShell } from '@/components/SignInShell';
import { parseStatus } from '@/lib/status';
import { createClient } from '@/lib/supabase/server';
import { EnrollForm } from './EnrollForm';

/**
 * Set up (or replace) the authenticator app. Step 1 proves the mailbox with an emailed code; step 2 shows a QR code and
 * checks the first code from the app. Someone who knows only the password cannot get past step 1.
 */
export const metadata = { title: 'Set up your authenticator' };

export default async function EnrollPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/signin');
  const { data: status } = await supabase.rpc('admin_session_status');
  const s = parseStatus(status);
  if (s === 'not_admin') redirect('/signin?e=notadmin');
  if (s === 'verified') redirect('/dashboard');
  const [{ data: proven }, { data: totp }, { s: flag }] = await Promise.all([supabase.rpc('admin_enroll_proof_status'), supabase.rpc('admin_totp_status'), searchParams]);
  return (
    <SignInShell>
      <EnrollForm proven={proven === true} replacing={totp === 'enrolled'} notSent={flag === 'notsent'} />
    </SignInShell>
  );
}
