import { RequestsView } from '@/features/requests/RequestsView';

export const metadata = { title: 'Worker requests' };

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string; page?: string }> }) {
  return <RequestsView params={await searchParams} />;
}
