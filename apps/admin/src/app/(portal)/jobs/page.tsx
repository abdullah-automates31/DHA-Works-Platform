import { JobsView } from '@/features/jobs/JobsView';

export const metadata = { title: 'Jobs' };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; phase?: string; cat?: string; today?: string; q?: string; page?: string }> }) {
  return <JobsView params={await searchParams} />;
}
