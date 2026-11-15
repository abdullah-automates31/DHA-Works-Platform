import { redirect } from 'next/navigation';
import { SignInShell } from '@/components/SignInShell';
import { parseStatus } from '@/lib/status';
import { createClient } from '@/lib/supabase/server';
import { CodeForm } from './CodeForm';

export default async function CodePage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/signin');
  const { data: status } = await supabase.rpc('admin_session_status');
  const s = parseStatus(status);
  if (s === 'not_admin') redirect('/signin?e=notadmin');
  if (s === 'verified') redirect('/dashboard');
  const { s: flag } = await searchParams;
  return (
    <SignInShell>
      <CodeForm notSent={flag === 'notsent'} />
    </SignInShell>
  );
}
