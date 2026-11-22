import { DuesView } from '@/features/dues/DuesView';

export const metadata = { title: 'Dues' };

export default async function DuesPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string }> }) {
  return <DuesView params={await searchParams} />;
}
