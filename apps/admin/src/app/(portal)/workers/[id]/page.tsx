import { ReviewView } from '@/features/verification/ReviewView';

export const metadata = { title: 'Worker review' };

export default async function WorkerReviewPage({ params }: { params: Promise<{ id: string }> }) {
  return <ReviewView role="worker" id={(await params).id} />;
}
