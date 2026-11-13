import { SignInShell } from '@/components/SignInShell';
import { AcceptForm } from './AcceptForm';

/**
 * Public on purpose: the invited person is not signed in yet. The one-time token proves the invitation. New links carry
 * it after the "#" (the browser never sends that to the server, so it stays out of logs); the form reads it there. An
 * older link with "?token=" still works until its invitation expires.
 */
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ email?: string; token?: string }> }) {
  const { email, token } = await searchParams;
  const emailOk = typeof email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const legacyToken = typeof token === 'string' && /^[0-9a-f]{20,100}$/i.test(token) ? token : null;
  return (
    <SignInShell>
      <h2 className="h2" style={{ marginBottom: 8 }}>Create your staff account</h2>
      {emailOk ? (
        <AcceptForm email={email} legacyToken={legacyToken} />
      ) : (
        <div className="note red" role="alert">This invitation link is not complete. Ask the person who invited you to send it again.</div>
      )}
    </SignInShell>
  );
}
