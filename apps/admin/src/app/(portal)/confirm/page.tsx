import { requireAdmin } from '@/lib/auth';
import { safeNext } from '@/lib/stepup';
import { ConfirmForm } from './ConfirmForm';

/** Asked for before a sensitive action when the last code is older than 15 minutes (migration 0048). */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireAdmin();
  const { next } = await searchParams;
  return (
    <div style={{ maxWidth: 460, padding: '40px 32px' }}>
      <h1 className="h2" style={{ marginBottom: 8 }}>Confirm it is you</h1>
      <p style={{ marginBottom: 16, color: '#4B5563' }}>
        This action changes things for other people, so we ask for a new code first. Press &ldquo;Send me a code&rdquo;, then enter the six digits from the email. Your answer works for 15 minutes.
      </p>
      <ConfirmForm next={safeNext(next)} />
    </div>
  );
}
