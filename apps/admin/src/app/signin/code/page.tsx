import { redirect } from 'next/navigation';
import { SignInShell } from '@/components/SignInShell';
import { parseStatus } from '@/lib/status';
import { createClient } from '@/lib/supabase/server';
import { CodeForm } from './CodeForm';

/** Sign-in step 2: the code from the authenticator app. An account with no authenticator yet goes to the setup page. */
export default async function CodePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/signin');
  const { data: status } = await supabase.rpc('admin_session_status');
  const s = parseStatus(status);
  if (s === 'not_admin') redirect('/signin?e=notadmin');
  if (s === 'verified') redirect('/dashboard');
  const { data: totp } = await supabase.rpc('admin_totp_status');
  if (totp !== 'enrolled') redirect('/signin/enroll');
  return (
    <SignInShell>
      <CodeForm />
    </SignInShell>
  );
}
