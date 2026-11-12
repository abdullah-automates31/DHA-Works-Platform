import { Suspense, type ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { loadReportCounts } from '@/features/reports/queries';
import { loadCounts } from '@/features/verification/queries';
import { requireAdmin } from '@/lib/auth';

/** The sidebar numbers load on their own so they never hold up the page. The layout stays mounted between pages. */
async function SidebarWithCounts() {
  const { supabase, user } = await requireAdmin();
  const [profile, workers, residents, reports] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    loadCounts(supabase, 'worker'),
    loadCounts(supabase, 'resident'),
    loadReportCounts(supabase),
  ]);
  return <Sidebar name={profile.data?.full_name ?? null} workers={workers.pending ?? 0} residents={residents.pending ?? 0} reports={reports.open} />;
}

export default async function PortalLayout({ children }: { children: ReactNode }) {
  // Redirects before anything is shown when the session is not a verified admin (the pages load their data meanwhile).
  await requireAdmin();
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <Suspense fallback={<aside className="nav" />}>
        <SidebarWithCounts />
      </Suspense>
      <main id="main" tabIndex={-1} className="main">{children}</main>
    </div>
  );
}
