import { JobView } from '@/features/jobs/JobView';

export const metadata = { title: 'Job' };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  return <JobView id={(await params).id} />;
}
