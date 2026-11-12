import { QueueView } from '@/features/verification/QueueView';

export const metadata = { title: 'Residents' };

export default async function ResidentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <QueueView role="resident" params={await searchParams} />;
}
