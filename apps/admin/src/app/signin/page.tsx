import { headers } from 'next/headers';
import { SignInShell } from '@/components/SignInShell';
import { SignInForm } from './SignInForm';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
  return (
    <SignInShell>
      {e === 'invited' ? <div className="note g" role="status" style={{ marginBottom: 12 }}>Your account is ready. Sign in with your email and password. A code is emailed to you on the next step.</div> : null}
      {e === 'idle' ? <div className="note g" role="status" style={{ marginBottom: 12 }}>You were signed out after 30 minutes without activity. Sign in again to continue.</div> : null}
      <SignInForm notAdmin={e === 'notadmin'} siteKey={siteKey} nonce={nonce} />
    </SignInShell>
  );
}
