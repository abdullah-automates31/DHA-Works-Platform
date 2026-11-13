import { requireAdmin } from '@/lib/auth';
import { safeNext } from '@/lib/stepup';
import { ConfirmForm } from './ConfirmForm';

/** Asked for before a sensitive action when the last authenticator code is older than 15 minutes (migrations 0048 and 0052). */
export const metadata = { title: 'Confirm it is you' };

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireAdmin();
  const { next } = await searchParams;
  return (
    <div style={{ maxWidth: 460, padding: '40px 32px' }}>
      <h1 className="h2" style={{ marginBottom: 8 }}>Confirm it is you</h1>
      <p style={{ marginBottom: 16, color: '#4B5563' }}>
        This action changes things for other people, so we ask for a fresh code from your authenticator app first. Your answer works for 15 minutes.
      </p>
      <ConfirmForm next={safeNext(next)} />
    </div>
  );
}
