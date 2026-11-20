import { headers } from 'next/headers';
import { SignInShell } from '@/components/SignInShell';
import { ForgotForm } from './ForgotForm';

export const metadata = { title: 'Reset password' };

export default async function ForgotPage() {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
  return (
    <SignInShell>
      <ForgotForm siteKey={siteKey} nonce={nonce} />
    </SignInShell>
  );
}
