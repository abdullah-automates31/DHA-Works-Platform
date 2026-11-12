import { ReportsView } from '@/features/reports/ReportsView';

export const metadata = { title: 'Reports' };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; kind?: string; q?: string; page?: string }> }) {
  return <ReportsView params={await searchParams} />;
}
