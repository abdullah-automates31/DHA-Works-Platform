import { ReviewView } from '@/features/verification/ReviewView';

export const metadata = { title: 'Resident review' };

export default async function ResidentReviewPage({ params }: { params: Promise<{ id: string }> }) {
  return <ReviewView role="resident" id={(await params).id} />;
}
