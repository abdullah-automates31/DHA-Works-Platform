import { CancellationsView } from '@/features/jobs/CancellationsView';

export const metadata = { title: 'Cancellation requests' };

export default async function CancellationsPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  return <CancellationsView params={await searchParams} />;
}
