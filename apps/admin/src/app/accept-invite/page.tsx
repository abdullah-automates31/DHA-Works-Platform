import { SignInShell } from '@/components/SignInShell';
import { AcceptForm } from './AcceptForm';

/** Public on purpose: the invited person is not signed in yet. The one-time token in the link is what proves the invitation. */
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ email?: string; token?: string }> }) {
  const { email, token } = await searchParams;
  const ok = typeof email === 'string' && typeof token === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && /^[0-9a-f]{20,100}$/i.test(token);
  return (
    <SignInShell>
      <h2 className="h2" style={{ marginBottom: 8 }}>Create your staff account</h2>
      {ok ? (
        <AcceptForm email={email} token={token} />
      ) : (
        <div className="note red" role="alert">This invitation link is not complete. Ask the person who invited you to send it again.</div>
      )}
    </SignInShell>
  );
}
