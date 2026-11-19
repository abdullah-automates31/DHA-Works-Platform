import { SettingsView } from '@/features/settings/SettingsView';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; admin?: string; action?: string; from?: string; to?: string; page?: string }> }) {
  const p = await searchParams;
  return <SettingsView tab={p.tab} params={p} />;
}
