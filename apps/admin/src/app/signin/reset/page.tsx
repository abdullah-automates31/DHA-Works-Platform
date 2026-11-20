import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignInShell } from '@/components/SignInShell';
import { cleanEmail } from '@/features/auth/messages';
import { RESET_COOKIE } from '@/features/auth/reset';
import { ResetForm } from './ResetForm';

export const metadata = { title: 'Choose a new password' };

export default async function ResetPage() {
  const email = cleanEmail((await cookies()).get(RESET_COOKIE)?.value);
  if (!email) redirect('/signin/forgot'); // no code was asked for in this browser
  return (
    <SignInShell>
      <ResetForm email={email} />
    </SignInShell>
  );
}
