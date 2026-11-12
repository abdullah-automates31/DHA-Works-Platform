import { ReportCase } from '@/features/reports/ReportCase';

export const metadata = { title: 'Report case' };

export default async function ReportCasePage({ params }: { params: Promise<{ id: string }> }) {
  return <ReportCase id={(await params).id} />;
}
